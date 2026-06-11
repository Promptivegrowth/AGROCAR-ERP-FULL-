-- ─────────────────────────────────────────────────────────────────────────────
-- 039: Fix crítico — RPCs fallaban por cast de tipos enum
--
-- Continuación del bug encontrado en 038 (estado_pedido). Auditoría
-- end-to-end reveló el mismo problema en emitir_comprobante_atomico:
--
--   ERROR 42804: column "tipo" is of type tipo_comprobante but expression
--   is of type text
--
-- Esto provocaba que la emisión de comprobantes vía la RPC atómica
-- (introducida en migración 036) fallara siempre. El cliente notó
-- que después del flujo de pedidos también dejó de funcionar la
-- facturación.
--
-- Columnas afectadas en comprobantes (todos enums):
--   - tipo (tipo_comprobante)
--   - estado (estado_comprobante)
--   - moneda (moneda)
--
-- Fix: cast explícito a cada tipo enum.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Validar que el pedido tenga items (causa raíz del bug Daniel)
  SELECT COUNT(*) INTO v_items_count FROM pedidos_items WHERE pedido_id = p_pedido_id;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'No se puede emitir comprobante: el pedido % no tiene productos', p_pedido_id;
  END IF;

  -- Insertar comprobante (cast explícito a enums)
  INSERT INTO comprobantes (
    pedido_id, cliente_id, tipo, serie, numero,
    fecha_emision, subtotal, igv, total, moneda, estado,
    facturador_id
  ) VALUES (
    p_pedido_id, v_pedido.cliente_id,
    p_tipo::tipo_comprobante,
    p_serie, p_numero,
    p_fecha_emision, p_subtotal, p_igv, p_total,
    'PEN'::moneda,
    'emitido'::estado_comprobante,
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

  GET DIAGNOSTICS v_items_count = ROW_COUNT;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'Error al copiar items del pedido al comprobante. Rollback.';
  END IF;

  -- Marcar pedido como facturado (cast a estado_pedido)
  UPDATE pedidos SET estado = 'facturado'::estado_pedido, updated_at = NOW() WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'id', v_comp_id,
    'serie', p_serie,
    'numero', p_numero,
    'items_count', v_items_count
  );
END;
$$;
