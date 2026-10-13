-- Cambiar contado / crédito de un pedido ya guardado.
--
-- Daniel, 13/10/2026: "habilitar en editar pedidos el método de pago crédito o
-- contado". pedidos.tipo_pago se lee en vivo en todos lados: la impresión del
-- comprobante (condición y cuotas), la impresión por lote, el XML a SUNAT
-- (condicion-pago), la hoja de ruta del repartidor, la rendición, el registro
-- de ventas y la app de reparto. Por eso se cambia solo mientras nada de eso se
-- imprimió ni se declaró, con las mismas reglas que la fecha de despacho:
--
--   * antes de facturar (borrador, enviado o validado)
--   * sin comprobante emitido (por si quedó alguno no anulado)
--   * fuera de toda hoja de ruta (el repartidor ya tendría impresa la condición)
CREATE OR REPLACE FUNCTION public.cambiar_tipo_pago_pedido(p_pedido_id uuid, p_tipo_pago text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_rol TEXT;
  v_pedido RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role INTO v_rol FROM profiles WHERE id = v_user AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'facturador', 'vendedor') THEN
    RAISE EXCEPTION 'Sin permisos para cambiar la condición de pago';
  END IF;

  IF p_tipo_pago IS NULL OR p_tipo_pago NOT IN ('contado', 'credito') THEN
    RAISE EXCEPTION 'La condición de pago debe ser contado o crédito';
  END IF;

  SELECT id, numero, estado::TEXT AS estado, tipo_pago INTO v_pedido
    FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no existe'; END IF;

  IF v_pedido.tipo_pago = p_tipo_pago THEN
    RETURN jsonb_build_object('pedido', v_pedido.numero, 'anterior', v_pedido.tipo_pago, 'nueva', p_tipo_pago, 'sin_cambio', true);
  END IF;

  IF v_pedido.estado NOT IN ('borrador', 'enviado', 'validado') THEN
    RAISE EXCEPTION 'El pedido % ya está %: la condición de pago no se puede cambiar después de facturar',
      v_pedido.numero, v_pedido.estado;
  END IF;

  IF EXISTS (SELECT 1 FROM comprobantes WHERE pedido_id = p_pedido_id AND estado::TEXT <> 'anulado') THEN
    RAISE EXCEPTION 'El pedido % ya tiene comprobante emitido: la condición de pago no se puede cambiar',
      v_pedido.numero;
  END IF;

  IF EXISTS (SELECT 1 FROM despachos_items WHERE pedido_id = p_pedido_id) THEN
    RAISE EXCEPTION 'El pedido % ya está en una hoja de ruta. Sácalo del despacho antes de cambiar la condición de pago',
      v_pedido.numero;
  END IF;

  UPDATE pedidos SET tipo_pago = p_tipo_pago, updated_at = NOW() WHERE id = p_pedido_id;

  RETURN jsonb_build_object('pedido', v_pedido.numero, 'anterior', v_pedido.tipo_pago, 'nueva', p_tipo_pago);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cambiar_tipo_pago_pedido(uuid, text) TO authenticated;
