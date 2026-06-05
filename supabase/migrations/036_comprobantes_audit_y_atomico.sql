-- ─────────────────────────────────────────────────────────────────────────────
-- 036: Comprobantes — atomicidad, backfill de huérfanos, edición con trazabilidad
--
-- Problemas reportados por Daniel:
-- 1) Boletas/facturas se imprimen sin el detalle del pedido, solo el monto.
--    Causa: el INSERT de comprobantes_items no era atómico ni se validaba;
--    si fallaba en silencio, quedaba el comprobante sin items.
-- 2) Falta edición con trazabilidad para documentos emitidos no enviados a SUNAT.
--
-- Fix:
-- - Backfill: copiar items_pedido a comprobantes_items para huérfanos.
-- - Columnas pedidos editado/editado_at en comprobantes para indicador visual.
-- - Tabla comprobantes_ediciones (audit log: quién, qué, cuándo).
-- - RPC emitir_comprobante_atomico: cabecera + items en una sola transacción,
--   con validación dura de items > 0.
-- - RPC editar_comprobante_item: edita una línea y registra el cambio.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────────────────── Columnas de auditoría
ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS editado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS editado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enviado_sunat BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN comprobantes.editado IS
  'TRUE si el comprobante fue modificado después de emitirse. El detalle del cambio queda en comprobantes_ediciones.';
COMMENT ON COLUMN comprobantes.enviado_sunat IS
  'TRUE cuando el comprobante ya se envió al OSE/SUNAT. Bloquea cualquier edición posterior.';

-- ───────────────────────── Tabla de auditoría
CREATE TABLE IF NOT EXISTS comprobantes_ediciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id UUID NOT NULL REFERENCES comprobantes(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  usuario_nombre TEXT NOT NULL,
  usuario_rol TEXT,
  campo TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  item_id UUID,
  item_descripcion TEXT,
  nota TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compr_edic_comprobante ON comprobantes_ediciones(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_compr_edic_fecha ON comprobantes_ediciones(created_at DESC);

ALTER TABLE comprobantes_ediciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compr_edic_select ON comprobantes_ediciones;
CREATE POLICY compr_edic_select ON comprobantes_ediciones
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS compr_edic_insert ON comprobantes_ediciones;
CREATE POLICY compr_edic_insert ON comprobantes_ediciones
  FOR INSERT TO authenticated WITH CHECK (true);

COMMENT ON TABLE comprobantes_ediciones IS
  'Audit log de modificaciones a comprobantes emitidos no enviados a SUNAT. Guarda quién, qué campo, valor anterior y nuevo.';

-- ───────────────────────── Backfill de comprobantes huérfanos
-- Para cada comprobante sin items pero con pedido_id que sí tiene items,
-- copiar los items del pedido como snapshot.
DO $$
DECLARE
  v_count INT := 0;
BEGIN
  INSERT INTO comprobantes_items (
    comprobante_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, igv_porcentaje
  )
  SELECT
    c.id,
    pi.producto_id,
    COALESCE(TRIM(p.descripcion), p.nombre, '—'),
    pi.cantidad,
    pi.precio_unitario,
    pi.subtotal,
    CASE WHEN c.igv > 0 THEN 18 ELSE 0 END
  FROM comprobantes c
  JOIN pedidos_items pi ON pi.pedido_id = c.pedido_id
  LEFT JOIN productos p ON p.id = pi.producto_id
  WHERE c.estado <> 'anulado'
    AND c.pedido_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM comprobantes_items ci WHERE ci.comprobante_id = c.id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Backfill: % items insertados en comprobantes huérfanos.', v_count;
END
$$;

-- ───────────────────────── RPC: emisión atómica
-- Recibe el pedido_id + tipo + serie + numero + totales. Hace TODO en una
-- transacción: si los items fallan, rollback completo (no quedan
-- comprobantes huérfanos).
CREATE OR REPLACE FUNCTION emitir_comprobante_atomico(
  p_pedido_id UUID,
  p_tipo TEXT,
  p_serie TEXT,
  p_numero TEXT,
  p_fecha_emision DATE,
  p_subtotal NUMERIC,
  p_igv NUMERIC,
  p_total NUMERIC,
  p_facturador_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido RECORD;
  v_comp_id UUID;
  v_items_count INT;
BEGIN
  -- Cargar pedido + validar
  SELECT p.id, p.cliente_id, p.incluir_igv, p.estado
    INTO v_pedido FROM pedidos p WHERE p.id = p_pedido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;

  -- Validar que el pedido tenga items (causa raíz del bug de Daniel)
  SELECT COUNT(*) INTO v_items_count FROM pedidos_items WHERE pedido_id = p_pedido_id;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'No se puede emitir comprobante: el pedido % no tiene productos', p_pedido_id;
  END IF;

  -- Insertar comprobante
  INSERT INTO comprobantes (
    pedido_id, cliente_id, tipo, serie, numero,
    fecha_emision, subtotal, igv, total, moneda, estado,
    facturador_id
  ) VALUES (
    p_pedido_id, v_pedido.cliente_id, p_tipo, p_serie, p_numero,
    p_fecha_emision, p_subtotal, p_igv, p_total, 'PEN', 'emitido',
    p_facturador_id
  )
  RETURNING id INTO v_comp_id;

  -- Snapshot de items en comprobantes_items
  INSERT INTO comprobantes_items (
    comprobante_id, producto_id, descripcion, cantidad,
    precio_unitario, subtotal, igv_porcentaje
  )
  SELECT
    v_comp_id,
    pi.producto_id,
    COALESCE(TRIM(p.descripcion), p.nombre, '—'),
    pi.cantidad,
    pi.precio_unitario,
    pi.subtotal,
    CASE WHEN v_pedido.incluir_igv THEN 18 ELSE 0 END
  FROM pedidos_items pi
  LEFT JOIN productos p ON p.id = pi.producto_id
  WHERE pi.pedido_id = p_pedido_id;

  -- Validar dura que sí se insertaron items (defensa contra fallo silencioso)
  GET DIAGNOSTICS v_items_count = ROW_COUNT;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'Error al copiar items del pedido al comprobante. Rollback.';
  END IF;

  -- Marcar pedido como facturado
  UPDATE pedidos SET estado = 'facturado', updated_at = NOW() WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'id', v_comp_id,
    'serie', p_serie,
    'numero', p_numero,
    'items_count', v_items_count
  );
END;
$$;

COMMENT ON FUNCTION emitir_comprobante_atomico IS
  'Emite un comprobante (factura/boleta/interno) + sus items en una sola transacción. Si falla cualquier paso, rollback completo. Valida que el pedido tenga items antes de emitir.';

GRANT EXECUTE ON FUNCTION emitir_comprobante_atomico TO authenticated;

-- ───────────────────────── RPC: editar item de comprobante (con audit)
-- Solo permite editar si el comprobante no está enviado a SUNAT.
-- Solo roles administrador/gerente/facturador pueden editar.
CREATE OR REPLACE FUNCTION editar_comprobante_item(
  p_item_id UUID,
  p_descripcion TEXT,
  p_cantidad NUMERIC,
  p_precio_unitario NUMERIC,
  p_nota TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_comp RECORD;
  v_user_id UUID;
  v_profile RECORD;
  v_nuevo_subtotal NUMERIC;
  v_nuevo_total NUMERIC;
  v_nuevo_subtotal_compr NUMERIC;
  v_nuevo_igv_compr NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Validar rol
  SELECT id, full_name, role::text INTO v_profile
    FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permisos para editar comprobantes (requiere administrador/gerente/facturador)';
  END IF;

  -- Cargar item + comprobante
  SELECT ci.*, c.id AS comp_id, c.estado, c.enviado_sunat,
         c.serie, c.numero, c.igv AS igv_compr
    INTO v_item
  FROM comprobantes_items ci
  JOIN comprobantes c ON c.id = ci.comprobante_id
  WHERE ci.id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % no existe', p_item_id;
  END IF;

  IF v_item.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede editar: el comprobante ya fue enviado a SUNAT';
  END IF;
  IF v_item.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede editar un comprobante anulado';
  END IF;

  v_nuevo_subtotal := ROUND(p_cantidad * p_precio_unitario, 2);

  -- Registrar cambios en audit log (uno por campo modificado)
  IF v_item.descripcion IS DISTINCT FROM p_descripcion THEN
    INSERT INTO comprobantes_ediciones (comprobante_id, usuario_id, usuario_nombre, usuario_rol,
      campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota)
    VALUES (v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
      'item.descripcion', v_item.descripcion, p_descripcion, p_item_id, p_descripcion, p_nota);
  END IF;
  IF v_item.cantidad IS DISTINCT FROM p_cantidad THEN
    INSERT INTO comprobantes_ediciones (comprobante_id, usuario_id, usuario_nombre, usuario_rol,
      campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota)
    VALUES (v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
      'item.cantidad', v_item.cantidad::text, p_cantidad::text, p_item_id, p_descripcion, p_nota);
  END IF;
  IF v_item.precio_unitario IS DISTINCT FROM p_precio_unitario THEN
    INSERT INTO comprobantes_ediciones (comprobante_id, usuario_id, usuario_nombre, usuario_rol,
      campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota)
    VALUES (v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
      'item.precio_unitario', v_item.precio_unitario::text, p_precio_unitario::text, p_item_id, p_descripcion, p_nota);
  END IF;

  -- Actualizar el item
  UPDATE comprobantes_items
    SET descripcion = p_descripcion,
        cantidad = p_cantidad,
        precio_unitario = p_precio_unitario,
        subtotal = v_nuevo_subtotal
  WHERE id = p_item_id;

  -- Recalcular totales del comprobante
  SELECT COALESCE(SUM(subtotal), 0) INTO v_nuevo_subtotal_compr
    FROM comprobantes_items WHERE comprobante_id = v_item.comp_id;

  -- Si tenía IGV, mantener proporción
  IF v_item.igv_compr > 0 THEN
    v_nuevo_igv_compr := ROUND(v_nuevo_subtotal_compr * 0.18, 2);
    v_nuevo_total := v_nuevo_subtotal_compr + v_nuevo_igv_compr;
    UPDATE comprobantes
      SET subtotal = v_nuevo_subtotal_compr - v_nuevo_igv_compr,
          igv = v_nuevo_igv_compr,
          total = v_nuevo_total,
          editado = TRUE,
          editado_at = NOW()
    WHERE id = v_item.comp_id;
  ELSE
    UPDATE comprobantes
      SET subtotal = v_nuevo_subtotal_compr,
          total = v_nuevo_subtotal_compr,
          editado = TRUE,
          editado_at = NOW()
    WHERE id = v_item.comp_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'comprobante_id', v_item.comp_id);
END;
$$;

COMMENT ON FUNCTION editar_comprobante_item IS
  'Edita un item del comprobante con audit log. Requiere rol administrador/gerente/facturador y que el comprobante no esté enviado a SUNAT. Recalcula totales del comprobante y lo marca como editado.';

GRANT EXECUTE ON FUNCTION editar_comprobante_item TO authenticated;
