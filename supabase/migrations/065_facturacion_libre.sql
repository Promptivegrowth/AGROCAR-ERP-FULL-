-- ─────────────────────────────────────────────────────────────────────────────
-- 065: Facturación libre — ítems sin producto del catálogo
--
-- Requerimiento Vaneza (R1):
-- "hemos vendido vehículos y no han estado en la facturación este del sistema
--  porque el sistema está enlazado a productos, entonces hemos tenido que usar
--  el facturador sunat"
--
-- Cambios:
-- 1) pedidos_items.producto_id → nullable + columna descripcion_libre
-- 2) Trigger de stock ignora ítems sin producto (no hay nada que descontar)
-- 3) emitir_comprobante_atomico usa descripcion_libre cuando no hay producto
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. producto_id nullable + descripción libre
ALTER TABLE pedidos_items
  ALTER COLUMN producto_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS descripcion_libre TEXT;

-- Al menos uno de los dos debe existir
ALTER TABLE pedidos_items DROP CONSTRAINT IF EXISTS chk_item_producto_o_libre;
ALTER TABLE pedidos_items ADD CONSTRAINT chk_item_producto_o_libre CHECK (
  producto_id IS NOT NULL OR (descripcion_libre IS NOT NULL AND LENGTH(TRIM(descripcion_libre)) > 0)
);

COMMENT ON COLUMN pedidos_items.descripcion_libre IS
  'Descripción manual para ítems que NO son productos del catálogo (venta de vehículos, activos, servicios puntuales).';

-- ── 2. Trigger de stock: saltar ítems sin producto
CREATE OR REPLACE FUNCTION descontar_stock_al_despachar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item RECORD;
  ya_descontado BOOLEAN;
BEGIN
  IF NEW.estado NOT IN ('despachado', 'entregado') THEN RETURN NEW; END IF;
  IF OLD.estado = NEW.estado THEN RETURN NEW; END IF;
  IF OLD.estado IN ('despachado', 'entregado') THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM movimientos_stock
    WHERE referencia_tipo = 'pedido' AND referencia_id = NEW.id AND tipo = 'salida'
  ) INTO ya_descontado;
  IF ya_descontado THEN RETURN NEW; END IF;

  FOR item IN
    SELECT pi.id, pi.producto_id, pi.cantidad, pi.lote_id, pi.precio_unitario
    FROM pedidos_items pi
    WHERE pi.pedido_id = NEW.id
      AND pi.producto_id IS NOT NULL  -- ítems libres no descuentan stock
  LOOP
    IF item.lote_id IS NOT NULL THEN
      UPDATE lotes SET cantidad_actual = GREATEST(0, cantidad_actual - item.cantidad), updated_at = NOW()
      WHERE id = item.lote_id;
    END IF;
    UPDATE stock SET cantidad = GREATEST(0, cantidad - item.cantidad),
                     cantidad_reservada = GREATEST(0, cantidad_reservada - item.cantidad),
                     updated_at = NOW()
    WHERE producto_id = item.producto_id;
    INSERT INTO movimientos_stock (producto_id, lote_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id, notas, created_at)
    VALUES (item.producto_id, item.lote_id, 'salida', item.cantidad, item.precio_unitario, 'pedido', NEW.id,
            'Salida automatica por despacho de pedido ' || NEW.numero, NOW());
  END LOOP;
  RETURN NEW;
END;
$$;

-- ── 3. emitir_comprobante_atomico: usar descripcion_libre para ítems sin producto
CREATE OR REPLACE FUNCTION emitir_comprobante_atomico(
  p_pedido_id uuid, p_tipo text, p_serie text, p_numero text,
  p_fecha_emision date, p_subtotal numeric, p_igv numeric, p_total numeric,
  p_facturador_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
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
    COALESCE(NULLIF(TRIM(pi.descripcion_libre), ''), TRIM(p.descripcion), p.nombre, '—'),
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

GRANT EXECUTE ON FUNCTION emitir_comprobante_atomico TO authenticated;
