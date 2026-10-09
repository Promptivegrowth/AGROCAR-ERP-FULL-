-- Un cobro solo se aplica a comprobantes de su propio cliente.
--
-- Daniel, 09/10/2026: la app de cobros no borraba lo marcado al cambiar de
-- cliente, y una boleta de otro cliente (S/ 356) se sumaba oculta al cobro
-- siguiente ("la suma de aplicaciones S/ 1,869 excede S/ 1,513"). La app ya lo
-- corrige; la base ahora además ignora cualquier aplicación a un comprobante
-- que no sea del cliente del cobro (queda para sus propios pendientes o a
-- cuenta). Ninguna aplicación cruzada llegó a guardarse.

CREATE OR REPLACE FUNCTION public.registrar_cobro_atomico(p_cobro jsonb, p_aplicaciones jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cobro_id UUID;
  v_cliente_id UUID;
  v_aplic JSONB;
  v_comp_id UUID;
  v_pedido NUMERIC;
  v_saldo NUMERIC;
  v_aplicar NUMERIC;
  v_total_aplicado NUMERIC := 0;
  v_total_cobro NUMERIC;
  v_restante NUMERIC;
  v_doc RECORD;
BEGIN
  v_total_cobro := COALESCE((p_cobro->>'total')::NUMERIC, 0);
  IF v_total_cobro <= 0 THEN
    RAISE EXCEPTION 'El total del cobro debe ser mayor a 0';
  END IF;

  -- Insertar el cobro (el trigger trg_cobros_numero asigna el correlativo y
  -- trg_aplicar_cobro_auto aplica FIFO).
  INSERT INTO cobros (
    cliente_id, cobrador_id, tipo, fecha,
    efectivo, yape, plin, transferencia, total,
    voucher_url, nro_operacion, notas,
    cliente_externo_nombre, cliente_externo_doc
  ) VALUES (
    NULLIF(p_cobro->>'cliente_id', '')::UUID,
    NULLIF(p_cobro->>'cobrador_id', '')::UUID,
    COALESCE(p_cobro->>'tipo', 'cobranza')::tipo_cobro,
    (p_cobro->>'fecha')::DATE,
    COALESCE((p_cobro->>'efectivo')::NUMERIC, 0),
    COALESCE((p_cobro->>'yape')::NUMERIC, 0),
    COALESCE((p_cobro->>'plin')::NUMERIC, 0),
    COALESCE((p_cobro->>'transferencia')::NUMERIC, 0),
    v_total_cobro,
    p_cobro->>'voucher_url',
    p_cobro->>'nro_operacion',
    p_cobro->>'notas',
    p_cobro->>'cliente_externo_nombre',
    p_cobro->>'cliente_externo_doc'
  )
  RETURNING id, cliente_id INTO v_cobro_id, v_cliente_id;

  -- Aplicaciones elegidas a mano: reemplazan lo que hizo el FIFO automático.
  IF p_aplicaciones IS NOT NULL AND jsonb_array_length(p_aplicaciones) > 0 THEN
    DELETE FROM cobros_aplicaciones WHERE cobro_id = v_cobro_id;

    SELECT COALESCE(SUM((a->>'monto_aplicado')::NUMERIC), 0) INTO v_pedido
      FROM jsonb_array_elements(p_aplicaciones) a;
    IF v_pedido > v_total_cobro + 0.001 THEN
      RAISE EXCEPTION 'Suma de aplicaciones (%) excede el total del cobro (%)', v_pedido, v_total_cobro;
    END IF;

    -- Cada una, hasta el saldo real del comprobante (total menos lo ya aplicado).
    FOR v_aplic IN SELECT * FROM jsonb_array_elements(p_aplicaciones)
    LOOP
      v_comp_id := NULLIF(v_aplic->>'comprobante_id', '')::UUID;
      CONTINUE WHEN v_comp_id IS NULL;
      SELECT c.total - COALESCE((SELECT SUM(a.monto_aplicado) FROM cobros_aplicaciones a WHERE a.comprobante_id = c.id), 0)
        INTO v_saldo
        FROM comprobantes c
       WHERE c.id = v_comp_id AND c.estado <> 'anulado'
         AND c.cliente_id IS NOT DISTINCT FROM v_cliente_id;
      v_aplicar := LEAST(COALESCE((v_aplic->>'monto_aplicado')::NUMERIC, 0), GREATEST(COALESCE(v_saldo, 0), 0),
                         v_total_cobro - v_total_aplicado);
      IF v_aplicar > 0.001 THEN
        INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
        VALUES (v_cobro_id, v_comp_id, v_aplicar, FALSE);
        v_total_aplicado := v_total_aplicado + v_aplicar;
      END IF;
    END LOOP;

    -- Lo que sobró: a los demás comprobantes pendientes del cliente, del más
    -- antiguo al más nuevo.
    v_restante := v_total_cobro - v_total_aplicado;
    IF v_restante > 0.001 AND v_cliente_id IS NOT NULL THEN
      FOR v_doc IN
        SELECT c.id, c.total - COALESCE((SELECT SUM(a.monto_aplicado) FROM cobros_aplicaciones a WHERE a.comprobante_id = c.id), 0) AS saldo
          FROM comprobantes c
         WHERE c.cliente_id = v_cliente_id AND c.estado <> 'anulado' AND c.tipo::text <> 'nota_credito'
         ORDER BY c.fecha_emision, c.created_at
      LOOP
        EXIT WHEN v_restante <= 0.001;
        CONTINUE WHEN v_doc.saldo <= 0.001;
        v_aplicar := LEAST(v_restante, v_doc.saldo);
        INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
        VALUES (v_cobro_id, v_doc.id, v_aplicar, FALSE);
        v_total_aplicado := v_total_aplicado + v_aplicar;
        v_restante := v_restante - v_aplicar;
      END LOOP;
    END IF;

    -- Si todavía sobra, queda a cuenta del cliente.
    IF v_total_cobro - v_total_aplicado > 0.001 THEN
      INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
      VALUES (v_cobro_id, NULL, v_total_cobro - v_total_aplicado, TRUE);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_cobro_id,
    'numero', (SELECT numero FROM cobros WHERE id = v_cobro_id),
    'total', v_total_cobro,
    'modo_aplicacion', CASE
      WHEN p_aplicaciones IS NOT NULL AND jsonb_array_length(p_aplicaciones) > 0
      THEN 'manual'
      ELSE 'fifo'
    END
  );
END;
$function$;
