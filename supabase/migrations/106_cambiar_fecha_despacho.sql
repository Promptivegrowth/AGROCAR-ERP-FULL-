-- ═══════════════════════════════════════════════════════════════════════════
-- 106 · Cambiar la fecha de despacho de un pedido
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Daniel lo pidió: en Pedidos se puede entrar en modo edición y cambiar
-- productos, cantidades y precios, pero la fecha de despacho aparece como
-- texto y no hay forma de tocarla. Tampoco existía una función que lo hiciera:
-- ni desde la pantalla ni desde el servidor.
--
-- Es un dato que cambia seguido en la operación real —el cliente pide para el
-- lunes y después avisa que mejor el miércoles— y hasta ahora la única salida
-- era borrar el pedido y volver a cargarlo.
--
-- Hasta dónde se puede cambiar
-- ----------------------------
-- Solo mientras el pedido no se facturó. Después de facturar, la fecha ya
-- viajó al comprobante y el comprobante puede estar impreso, entregado o
-- declarado: moverla ahí dejaría al papel diciendo una cosa y al sistema otra.
--
-- Por eso 'facturado', 'despachado' y 'entregado' quedan afuera, igual que
-- 'cancelado'. Lo editable es 'borrador', 'enviado' y 'validado', que es
-- exactamente la misma ventana en la que ya se pueden editar los productos.
--
-- Un pedido que ya está en una hoja de ruta tampoco se toca: cambiarle la
-- fecha lo dejaría en el despacho de un día y con fecha de otro.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cambiar_fecha_despacho_pedido(
  p_pedido_id UUID,
  p_fecha_despacho DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_rol TEXT;
  v_pedido RECORD;
  v_en_despacho INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role INTO v_rol FROM profiles WHERE id = v_user;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'facturador', 'vendedor') THEN
    RAISE EXCEPTION 'Sin permisos para cambiar la fecha de despacho';
  END IF;

  IF p_fecha_despacho IS NULL THEN
    RAISE EXCEPTION 'Hay que indicar una fecha de despacho';
  END IF;

  SELECT id, numero, estado::TEXT AS estado, fecha_despacho, fecha_pedido
    INTO v_pedido
    FROM pedidos WHERE id = p_pedido_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no existe'; END IF;

  IF v_pedido.estado NOT IN ('borrador', 'enviado', 'validado') THEN
    RAISE EXCEPTION 'El pedido % ya está %: la fecha de despacho no se puede cambiar despues de facturar',
      v_pedido.numero, v_pedido.estado;
  END IF;

  -- Ya consolidado en una hoja de ruta: cambiarle la fecha lo dejaria en el
  -- despacho de un dia y fechado en otro.
  SELECT COUNT(*) INTO v_en_despacho FROM despachos_items WHERE pedido_id = p_pedido_id;
  IF v_en_despacho > 0 THEN
    RAISE EXCEPTION 'El pedido % ya está en una hoja de ruta. Sacalo del despacho antes de cambiarle la fecha',
      v_pedido.numero;
  END IF;

  -- La fecha de despacho no puede ser anterior a la del pedido: seria repartir
  -- antes de que el cliente lo pidiera.
  IF p_fecha_despacho < v_pedido.fecha_pedido THEN
    RAISE EXCEPTION 'La fecha de despacho (%) no puede ser anterior a la del pedido (%)',
      p_fecha_despacho, v_pedido.fecha_pedido;
  END IF;

  UPDATE pedidos
     SET fecha_despacho = p_fecha_despacho,
         updated_at = NOW()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'pedido', v_pedido.numero,
    'anterior', v_pedido.fecha_despacho,
    'nueva', p_fecha_despacho
  );
END;
$$;

COMMENT ON FUNCTION cambiar_fecha_despacho_pedido IS
  'Cambia la fecha de despacho de un pedido que todavia no se facturo ni entro a una hoja de ruta.';

GRANT EXECUTE ON FUNCTION cambiar_fecha_despacho_pedido TO authenticated;
