-- ─────────────────────────────────────────────────────────────────────────────
-- 041: Fix crítico — bug del IGV duplicado al editar comprobantes
--       + agregar fecha_despacho a comprobantes
--
-- BUG 1: La RPC editar_comprobante_item de la migración 036 calculaba el
-- IGV con la fórmula INVERTIDA:
--
--   v_nuevo_igv_compr := ROUND(v_nuevo_subtotal_compr * 0.18, 2);
--   v_nuevo_total := v_nuevo_subtotal_compr + v_nuevo_igv_compr;
--
-- Esto multiplica por 18% el monto que YA INCLUYE IGV (porque
-- comprobantes_items.subtotal = cantidad × precio, donde el precio
-- venía con IGV incluido del pedido).
--
-- Resultado real: 663.40 × 0.18 = 119.41 → total 782.81 (cliente reportó).
-- Resultado esperado: 663.40 ya es el total con IGV. IGV se DESAGREGA:
--   igv = total - (total / 1.18)
--
-- BUG 2: Los comprobantes mostraban fecha_emision (cuando se facturó)
-- pero el cliente espera ver fecha_despacho (cuando se entrega).
-- Agregamos esa columna a la tabla comprobantes y la heredamos del pedido.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────────────────── FIX BUG 1: editar_comprobante_item
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
  v_user_id UUID;
  v_profile RECORD;
  v_nuevo_subtotal NUMERIC;
  v_suma_items NUMERIC;
  v_nuevo_total NUMERIC;
  v_nuevo_igv NUMERIC;
  v_nuevo_subtotal_compr NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permisos para editar comprobantes (requiere administrador/gerente/facturador)';
  END IF;

  SELECT ci.*, c.id AS comp_id, c.estado, c.enviado_sunat,
         c.serie, c.numero, c.igv AS igv_compr
    INTO v_item
  FROM comprobantes_items ci
  JOIN comprobantes c ON c.id = ci.comprobante_id
  WHERE ci.id = p_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item % no existe', p_item_id; END IF;
  IF v_item.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede editar: el comprobante ya fue enviado a SUNAT';
  END IF;
  IF v_item.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede editar un comprobante anulado';
  END IF;

  v_nuevo_subtotal := ROUND(p_cantidad * p_precio_unitario, 2);

  -- Audit log (uno por campo modificado)
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

  -- Suma de subtotales de items (estos vienen CON IGV incluido,
  -- igual que los precios de lista en AGROCAR).
  SELECT COALESCE(SUM(subtotal), 0) INTO v_suma_items
    FROM comprobantes_items WHERE comprobante_id = v_item.comp_id;

  -- FIX: desagregar IGV en lugar de sumarlo otra vez
  IF v_item.igv_compr > 0 THEN
    v_nuevo_total := v_suma_items;
    v_nuevo_igv := ROUND(v_nuevo_total - (v_nuevo_total / 1.18), 2);
    v_nuevo_subtotal_compr := v_nuevo_total - v_nuevo_igv;
    UPDATE comprobantes
      SET subtotal = v_nuevo_subtotal_compr,
          igv = v_nuevo_igv,
          total = v_nuevo_total,
          editado = TRUE,
          editado_at = NOW()
    WHERE id = v_item.comp_id;
  ELSE
    UPDATE comprobantes
      SET subtotal = v_suma_items,
          igv = 0,
          total = v_suma_items,
          editado = TRUE,
          editado_at = NOW()
    WHERE id = v_item.comp_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'comprobante_id', v_item.comp_id,
    'subtotal', COALESCE(v_nuevo_subtotal_compr, v_suma_items),
    'igv', COALESCE(v_nuevo_igv, 0),
    'total', COALESCE(v_nuevo_total, v_suma_items)
  );
END;
$$;

COMMENT ON FUNCTION editar_comprobante_item IS
  'Edita un item del comprobante. Items se guardan con subtotal CON IGV; la función desagrega el IGV correctamente al recalcular totales (no suma de nuevo).';

-- ───────────────────────── FIX BUG 1.5: Reparar comprobantes editados con bug
-- Para comprobantes que ya fueron editados con la fórmula incorrecta,
-- recalculamos sus totales correctamente.
DO $$
DECLARE
  v_comp RECORD;
  v_suma NUMERIC;
  v_total NUMERIC;
  v_igv NUMERIC;
  v_subtotal NUMERIC;
  v_count INT := 0;
BEGIN
  FOR v_comp IN
    SELECT c.id, c.igv
    FROM comprobantes c
    WHERE c.editado = TRUE
      AND c.estado <> 'anulado'
      AND NOT c.enviado_sunat
  LOOP
    SELECT COALESCE(SUM(subtotal), 0) INTO v_suma FROM comprobantes_items WHERE comprobante_id = v_comp.id;
    IF v_suma = 0 THEN CONTINUE; END IF;

    IF v_comp.igv > 0 THEN
      v_total := v_suma;
      v_igv := ROUND(v_total - (v_total / 1.18), 2);
      v_subtotal := v_total - v_igv;
    ELSE
      v_total := v_suma;
      v_igv := 0;
      v_subtotal := v_suma;
    END IF;

    UPDATE comprobantes
      SET subtotal = v_subtotal, igv = v_igv, total = v_total
      WHERE id = v_comp.id;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Reparados % comprobantes editados con bug del IGV duplicado', v_count;
END
$$;

-- ───────────────────────── FIX BUG 2: agregar fecha_despacho a comprobantes
ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS fecha_despacho DATE;

COMMENT ON COLUMN comprobantes.fecha_despacho IS
  'Fecha en que se entregará la mercadería. Se copia desde pedidos.fecha_despacho al emitir. Útil para que el comprobante muestre la fecha relevante para el cliente.';

-- Backfill: copiar la fecha_despacho del pedido asociado para comprobantes existentes
UPDATE comprobantes c
SET fecha_despacho = p.fecha_despacho
FROM pedidos p
WHERE c.pedido_id = p.id
  AND c.fecha_despacho IS NULL;

-- Actualizar la RPC de emisión para copiar fecha_despacho automáticamente
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
  SELECT p.id, p.cliente_id, p.incluir_igv, p.estado, p.fecha_despacho
    INTO v_pedido FROM pedidos p WHERE p.id = p_pedido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;

  SELECT COUNT(*) INTO v_items_count FROM pedidos_items WHERE pedido_id = p_pedido_id;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'No se puede emitir comprobante: el pedido % no tiene productos', p_pedido_id;
  END IF;

  INSERT INTO comprobantes (
    pedido_id, cliente_id, tipo, serie, numero,
    fecha_emision, fecha_despacho,
    subtotal, igv, total, moneda, estado,
    facturador_id
  ) VALUES (
    p_pedido_id, v_pedido.cliente_id,
    p_tipo::tipo_comprobante,
    p_serie, p_numero,
    p_fecha_emision, v_pedido.fecha_despacho,
    p_subtotal, p_igv, p_total,
    'PEN'::moneda,
    'emitido'::estado_comprobante,
    p_facturador_id
  )
  RETURNING id INTO v_comp_id;

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

  GET DIAGNOSTICS v_items_count = ROW_COUNT;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'Error al copiar items del pedido al comprobante. Rollback.';
  END IF;

  UPDATE pedidos SET estado = 'facturado'::estado_pedido, updated_at = NOW() WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'id', v_comp_id,
    'serie', p_serie,
    'numero', p_numero,
    'items_count', v_items_count
  );
END;
$$;
