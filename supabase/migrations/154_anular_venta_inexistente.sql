-- Anular un comprobante cuya venta NO existió (duplicada o no entregada).
--
-- Daniel, 06/11/2026: el 05/11 el repartidor Walter registró dos veces la venta
-- directa a Roberta Quispe (T001-170 en efectivo y T001-171 por transferencia;
-- solo valía la segunda). En oficina se anuló la T001-170, pero anular siempre
-- devolvía el pedido a "enviado" para re-facturarlo: el pedido VD-20261105-75765
-- entró a la facturación del día siguiente como B002-1760, con Walter de
-- vendedor. Y los 20 paquetes que "salieron" con la venta duplicada nunca
-- volvieron al stock.
--
-- Ahora quien anula dice qué pasa con la venta:
--   * Se vuelve a emitir (p_venta_existe = true, lo de siempre): el pedido
--     vuelve a "enviado" para facturarlo bien.
--   * La venta no existió (p_venta_existe = false): el pedido queda
--     "cancelado" y lo que salió del almacén con él vuelve al stock, con su
--     movimiento en el kárdex. No se permite si el pedido tiene otro
--     comprobante vigente o si el comprobante tiene cobros aplicados (primero
--     se anulan o se reasignan).

DROP FUNCTION IF EXISTS public.anular_comprobante(uuid, text);
CREATE OR REPLACE FUNCTION public.anular_comprobante(p_comprobante_id uuid, p_motivo text, p_venta_existe boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_comp RECORD;
  v_doc TEXT;
  v_otros TEXT;
  v_cobros TEXT;
  v_mov RECORD;
  v_costo NUMERIC;
  v_devuelto INT := 0;
  v_estado_pedido TEXT := NULL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administradores y gerentes pueden anular comprobantes';
  END IF;

  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de anulación (mínimo 5 caracteres)';
  END IF;

  SELECT * INTO v_comp FROM comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante % no existe', p_comprobante_id; END IF;
  v_doc := v_comp.serie || '-' || LPAD(v_comp.numero::text, 8, '0');

  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'El comprobante ya está anulado';
  END IF;

  IF v_comp.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede anular localmente: el comprobante fue enviado a SUNAT. Genera una NOTA DE CRÉDITO o usa la comunicación de baja en SUNAT.';
  END IF;

  IF NOT COALESCE(p_venta_existe, true) AND v_comp.pedido_id IS NOT NULL THEN
    SELECT string_agg(serie || '-' || LPAD(numero::text, 8, '0'), ', ') INTO v_otros
      FROM comprobantes
     WHERE pedido_id = v_comp.pedido_id AND id <> p_comprobante_id AND estado <> 'anulado';
    IF v_otros IS NOT NULL THEN
      RAISE EXCEPTION 'El pedido de % tiene otro comprobante vigente (%): la venta sí existe. Anula eligiendo "se vuelve a emitir".', v_doc, v_otros;
    END IF;
    SELECT string_agg(co.numero, ', ') INTO v_cobros
      FROM cobros_aplicaciones ca JOIN cobros co ON co.id = ca.cobro_id
     WHERE ca.comprobante_id = p_comprobante_id;
    IF v_cobros IS NOT NULL THEN
      RAISE EXCEPTION '% tiene cobros aplicados (%): anúlalos o reasígnalos antes de dar la venta por inexistente.', v_doc, v_cobros;
    END IF;
  END IF;

  UPDATE comprobantes
    SET estado = 'anulado'::estado_comprobante,
        anulado_at = NOW(),
        anulado_por = v_user_id,
        motivo_anulacion = p_motivo
    WHERE id = p_comprobante_id;

  INSERT INTO comprobantes_ediciones (
    comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, nota
  ) VALUES (
    p_comprobante_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
    'estado', v_comp.estado::text, 'anulado',
    'Anulación' || CASE WHEN COALESCE(p_venta_existe, true) THEN '' ELSE ' (la venta no existió)' END || ': ' || p_motivo
  );

  IF v_comp.pedido_id IS NOT NULL THEN
    IF COALESCE(p_venta_existe, true) THEN
      UPDATE pedidos SET estado = 'enviado'::estado_pedido, updated_at = NOW() WHERE id = v_comp.pedido_id;
      v_estado_pedido := 'enviado';
    ELSE
      -- Lo que salió del almacén con este pedido (y no volvió ya) regresa al stock.
      FOR v_mov IN
        SELECT m.producto_id, m.lote_id, SUM(m.cantidad) AS cantidad
          FROM movimientos_stock m
         WHERE m.referencia_tipo = 'pedido' AND m.referencia_id = v_comp.pedido_id AND m.tipo = 'salida'
           AND NOT EXISTS (SELECT 1 FROM movimientos_stock d
                            WHERE d.referencia_tipo = 'venta_anulada' AND d.referencia_id = v_comp.pedido_id)
         GROUP BY m.producto_id, m.lote_id
      LOOP
        SELECT costo_promedio INTO v_costo FROM stock WHERE producto_id = v_mov.producto_id;
        UPDATE stock SET cantidad = cantidad + v_mov.cantidad, updated_at = NOW() WHERE producto_id = v_mov.producto_id;
        IF v_mov.lote_id IS NOT NULL THEN
          UPDATE lotes SET cantidad_actual = cantidad_actual + v_mov.cantidad, updated_at = NOW() WHERE id = v_mov.lote_id;
        END IF;
        INSERT INTO movimientos_stock (producto_id, lote_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id, notas, created_by)
        VALUES (v_mov.producto_id, v_mov.lote_id, 'entrada', v_mov.cantidad, v_costo, 'venta_anulada', v_comp.pedido_id,
                'Vuelve al almacén: se anuló ' || v_doc || ' y la venta no existió · ' || TRIM(p_motivo), v_user_id);
        v_devuelto := v_devuelto + 1;
      END LOOP;
      -- Cancelado: ya no vuelve a la facturación. (Si no se había despachado,
      -- trg_liberar_stock_al_cancelar libera la reserva.)
      UPDATE pedidos SET estado = 'cancelado'::estado_pedido, updated_at = NOW() WHERE id = v_comp.pedido_id;
      v_estado_pedido := 'cancelado';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', p_comprobante_id,
    'numero', v_doc,
    'pedido_id', v_comp.pedido_id,
    'estado_pedido', v_estado_pedido,
    'productos_devueltos', v_devuelto
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.anular_comprobante(uuid, text, boolean) TO authenticated;
