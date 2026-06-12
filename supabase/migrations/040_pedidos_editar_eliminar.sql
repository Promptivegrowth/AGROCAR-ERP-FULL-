-- ─────────────────────────────────────────────────────────────────────────────
-- 040: Edición y eliminación de pedidos (solo en estado 'enviado')
--
-- Solicitud del cliente: permitir eliminar pedidos, agregar productos y
-- editar/quitar items, mientras el pedido aún no haya sido facturado.
--
-- Diseño:
-- - Trigger BEFORE DELETE en pedidos_items: libera automáticamente la
--   reserva de stock al borrar el item. Sin esto, borrar un item dejaría
--   stock comprometido sin razón.
-- - RPC eliminar_pedido: solo permite si estado='enviado'. Borra items
--   (trigger libera reserva) y cabecera.
-- - RPC agregar_item_pedido: solo si estado='enviado'. Inserta item
--   (trigger reserva stock), recalcula totales del pedido.
-- - RPC editar_item_pedido: solo si estado='enviado'. Libera reserva
--   vieja, reserva nueva, actualiza item y recalcula totales.
-- - RPC eliminar_item_pedido: solo si estado='enviado'. Borra item
--   (trigger libera reserva), recalcula totales. Si queda 0 items,
--   elimina también el pedido.
-- ─────────────────────────────────────────────────────────────────────────────

-- ───────────────────────── Trigger BEFORE DELETE en pedidos_items
-- Libera la cantidad reservada del stock cuando se borra un item.
-- Solo aplica si el pedido NO fue despachado/entregado (en esos casos
-- ya se descontó el stock real y no hay reserva que liberar).
CREATE OR REPLACE FUNCTION liberar_reserva_al_borrar_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado TEXT;
BEGIN
  SELECT estado::text INTO v_estado FROM pedidos WHERE id = OLD.pedido_id;
  -- Solo liberar reserva si el pedido NO está en estados donde ya se descontó stock real
  IF v_estado IS NULL OR v_estado IN ('despachado', 'entregado') THEN
    RETURN OLD;
  END IF;
  UPDATE stock
    SET cantidad_reservada = GREATEST(0, cantidad_reservada - OLD.cantidad),
        updated_at = NOW()
  WHERE producto_id = OLD.producto_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_liberar_reserva_borrar_item ON pedidos_items;
CREATE TRIGGER trg_liberar_reserva_borrar_item
  BEFORE DELETE ON pedidos_items
  FOR EACH ROW
  EXECUTE FUNCTION liberar_reserva_al_borrar_item();

COMMENT ON FUNCTION liberar_reserva_al_borrar_item IS
  'Libera la reserva de stock cuando se borra un pedidos_item. No actúa si el pedido ya fue despachado/entregado (esos descuentos son contra stock físico, no reserva).';

-- ───────────────────────── Helper: recalcular totales del pedido
CREATE OR REPLACE FUNCTION recalcular_totales_pedido(p_pedido_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal NUMERIC;
  v_incluir_igv BOOLEAN;
  v_descuento_pct NUMERIC;
  v_descuento_monto NUMERIC;
  v_igv NUMERIC;
  v_total NUMERIC;
BEGIN
  -- Sumar subtotales de items
  SELECT COALESCE(SUM(subtotal), 0) INTO v_subtotal
  FROM pedidos_items WHERE pedido_id = p_pedido_id;

  -- Leer config del pedido
  SELECT incluir_igv, COALESCE(descuento_porcentaje, 0) INTO v_incluir_igv, v_descuento_pct
  FROM pedidos WHERE id = p_pedido_id;

  -- Aplicar descuento
  v_descuento_monto := ROUND(v_subtotal * v_descuento_pct / 100, 2);
  v_subtotal := v_subtotal - v_descuento_monto;

  -- IGV
  IF v_incluir_igv THEN
    -- Si el subtotal venía con IGV incluido, separarlo
    -- En nuestro modelo, items.subtotal es el monto FINAL (con IGV si aplica)
    v_total := v_subtotal;
    v_igv := ROUND(v_total - (v_total / 1.18), 2);
    v_subtotal := v_total - v_igv;
  ELSE
    v_igv := 0;
    v_total := v_subtotal;
  END IF;

  UPDATE pedidos
  SET subtotal = v_subtotal,
      igv = v_igv,
      descuento_monto = v_descuento_monto,
      total = v_total,
      updated_at = NOW()
  WHERE id = p_pedido_id;
END;
$$;

-- ───────────────────────── RPC: eliminar pedido completo
CREATE OR REPLACE FUNCTION eliminar_pedido(p_pedido_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado TEXT;
  v_numero TEXT;
BEGIN
  SELECT estado::text, numero INTO v_estado, v_numero
  FROM pedidos WHERE id = p_pedido_id;

  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Pedido no existe';
  END IF;
  IF v_estado NOT IN ('enviado', 'pendiente') THEN
    RAISE EXCEPTION 'Solo se pueden eliminar pedidos en estado "enviado" (estado actual: %)', v_estado;
  END IF;

  -- Verificar que no haya comprobantes asociados (defensa extra)
  IF EXISTS (SELECT 1 FROM comprobantes WHERE pedido_id = p_pedido_id AND estado <> 'anulado') THEN
    RAISE EXCEPTION 'No se puede eliminar: el pedido tiene comprobantes emitidos';
  END IF;

  -- Borrar items (el trigger libera reserva)
  DELETE FROM pedidos_items WHERE pedido_id = p_pedido_id;
  -- Borrar pedido
  DELETE FROM pedidos WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true, 'numero', v_numero);
END;
$$;

GRANT EXECUTE ON FUNCTION eliminar_pedido TO authenticated;

-- ───────────────────────── RPC: agregar producto al pedido
CREATE OR REPLACE FUNCTION agregar_item_pedido(
  p_pedido_id UUID,
  p_producto_id UUID,
  p_cantidad NUMERIC,
  p_precio_unitario NUMERIC,
  p_descuento_porcentaje NUMERIC DEFAULT 0,
  p_force_reserva BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado TEXT;
  v_subtotal NUMERIC;
  v_item_id UUID;
BEGIN
  SELECT estado::text INTO v_estado FROM pedidos WHERE id = p_pedido_id;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Pedido no existe';
  END IF;
  IF v_estado NOT IN ('enviado', 'pendiente') THEN
    RAISE EXCEPTION 'Solo se puede modificar pedidos en estado "enviado" (estado actual: %)', v_estado;
  END IF;
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF p_precio_unitario < 0 THEN
    RAISE EXCEPTION 'El precio no puede ser negativo';
  END IF;

  v_subtotal := ROUND(p_cantidad * p_precio_unitario, 2);

  INSERT INTO pedidos_items (
    pedido_id, producto_id, cantidad, precio_unitario,
    descuento_porcentaje, subtotal, force_reserva
  ) VALUES (
    p_pedido_id, p_producto_id, p_cantidad, p_precio_unitario,
    p_descuento_porcentaje, v_subtotal, p_force_reserva
  )
  RETURNING id INTO v_item_id;

  -- Marcar pedido como requiere_reposicion si fue con override
  IF p_force_reserva THEN
    UPDATE pedidos SET requiere_reposicion = TRUE WHERE id = p_pedido_id;
  END IF;

  PERFORM recalcular_totales_pedido(p_pedido_id);

  RETURN jsonb_build_object('ok', true, 'item_id', v_item_id);
END;
$$;

GRANT EXECUTE ON FUNCTION agregar_item_pedido TO authenticated;

-- ───────────────────────── RPC: editar item (cantidad o precio)
CREATE OR REPLACE FUNCTION editar_item_pedido(
  p_item_id UUID,
  p_cantidad NUMERIC,
  p_precio_unitario NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_estado TEXT;
  v_diff NUMERIC;
  v_nuevo_subtotal NUMERIC;
BEGIN
  SELECT pi.*, p.estado::text AS estado_pedido
    INTO v_item
  FROM pedidos_items pi
  JOIN pedidos p ON p.id = pi.pedido_id
  WHERE pi.id = p_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item no existe'; END IF;
  IF v_item.estado_pedido NOT IN ('enviado', 'pendiente') THEN
    RAISE EXCEPTION 'Solo se puede modificar pedidos en estado "enviado" (actual: %)', v_item.estado_pedido;
  END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  IF p_precio_unitario < 0 THEN RAISE EXCEPTION 'Precio inválido'; END IF;

  -- Ajustar reserva: si cantidad sube, reservar diferencia (validando stock).
  -- Si baja, liberar la diferencia.
  v_diff := p_cantidad - v_item.cantidad;
  IF v_diff > 0 AND NOT v_item.force_reserva THEN
    -- Reserva atómica de la diferencia
    UPDATE stock
      SET cantidad_reservada = cantidad_reservada + v_diff,
          updated_at = NOW()
    WHERE producto_id = v_item.producto_id
      AND (cantidad - cantidad_reservada) >= v_diff;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock insuficiente para aumentar la cantidad';
    END IF;
  ELSIF v_diff > 0 AND v_item.force_reserva THEN
    -- Override: reservar sin validar
    UPDATE stock
      SET cantidad_reservada = cantidad_reservada + v_diff,
          updated_at = NOW()
    WHERE producto_id = v_item.producto_id;
  ELSIF v_diff < 0 THEN
    -- Liberar
    UPDATE stock
      SET cantidad_reservada = GREATEST(0, cantidad_reservada + v_diff),
          updated_at = NOW()
    WHERE producto_id = v_item.producto_id;
  END IF;

  v_nuevo_subtotal := ROUND(p_cantidad * p_precio_unitario, 2);

  UPDATE pedidos_items
  SET cantidad = p_cantidad,
      precio_unitario = p_precio_unitario,
      subtotal = v_nuevo_subtotal
  WHERE id = p_item_id;

  PERFORM recalcular_totales_pedido(v_item.pedido_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION editar_item_pedido TO authenticated;

-- ───────────────────────── RPC: eliminar item del pedido
CREATE OR REPLACE FUNCTION eliminar_item_pedido(p_item_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id UUID;
  v_estado TEXT;
  v_items_restantes INT;
BEGIN
  SELECT pi.pedido_id, p.estado::text INTO v_pedido_id, v_estado
  FROM pedidos_items pi
  JOIN pedidos p ON p.id = pi.pedido_id
  WHERE pi.id = p_item_id;

  IF v_pedido_id IS NULL THEN RAISE EXCEPTION 'Item no existe'; END IF;
  IF v_estado NOT IN ('enviado', 'pendiente') THEN
    RAISE EXCEPTION 'Solo se puede modificar pedidos en estado "enviado"';
  END IF;

  -- Borrar item (el trigger libera reserva)
  DELETE FROM pedidos_items WHERE id = p_item_id;

  -- Si fue el último item, borrar también el pedido completo
  SELECT COUNT(*) INTO v_items_restantes FROM pedidos_items WHERE pedido_id = v_pedido_id;
  IF v_items_restantes = 0 THEN
    DELETE FROM pedidos WHERE id = v_pedido_id;
    RETURN jsonb_build_object('ok', true, 'pedido_eliminado', true);
  ELSE
    PERFORM recalcular_totales_pedido(v_pedido_id);
    RETURN jsonb_build_object('ok', true, 'pedido_eliminado', false);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION eliminar_item_pedido TO authenticated;
