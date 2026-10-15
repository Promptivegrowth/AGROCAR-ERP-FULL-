-- Cobro automático: primero lo vendido al contado, después el crédito.
--
-- Daniel, 14/10/2026: un cliente que compra a crédito pide a veces algo
-- pequeño al contado. El repartidor cobra ese contado, pero el modo
-- "Automático" de la app aplicaba el pago al documento más antiguo —una
-- factura a crédito— y la del contado quedaba impaga (FLORES JAHUIRA AGAPITO:
-- F002-110 al contado, S/ 41, detrás de F002-77 y F002-95 a crédito).
--
-- Ahora el reparto automático (aplicar_cobro_fifo, y el sobrante de una
-- aplicación manual en registrar_cobro_atomico) va primero a los comprobantes
-- de pedidos al contado y después a los de crédito, cada grupo del más antiguo
-- al más nuevo. Las notas de crédito nunca reciben pagos.
--
-- Lo usan el disparador de cobros, corregir_cobro y aplicar_anticipos_cliente.
-- La venta directa no: aplica su cobro a su propio comprobante.

CREATE OR REPLACE FUNCTION public.aplicar_cobro_fifo(p_cobro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cobro RECORD;
  v_comp RECORD;
  v_saldo_comp NUMERIC;
  v_restante NUMERIC;
  v_aplicar NUMERIC;
  v_resultado JSONB := '[]'::JSONB;
  v_aplicado_total NUMERIC := 0;
BEGIN
  SELECT id, cliente_id, total INTO v_cobro FROM cobros WHERE id = p_cobro_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobro % no existe', p_cobro_id; END IF;

  -- Limpiar aplicaciones previas de este cobro (idempotente)
  DELETE FROM cobros_aplicaciones WHERE cobro_id = p_cobro_id;

  v_restante := v_cobro.total;

  -- Si no hay cliente registrado (consumidor final), no se puede aplicar a facturas
  IF v_cobro.cliente_id IS NULL THEN
    INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
    VALUES (p_cobro_id, NULL, v_restante, TRUE);
    RETURN jsonb_build_object('aplicaciones', '[]'::JSONB, 'a_cuenta', v_restante, 'total', v_cobro.total);
  END IF;

  -- Primero lo vendido al contado, después el crédito; cada grupo del más
  -- antiguo al más nuevo.
  FOR v_comp IN
    SELECT c.id, c.serie, c.numero, c.total, c.fecha_emision,
      (c.total - COALESCE((
        SELECT SUM(ca.monto_aplicado) FROM cobros_aplicaciones ca
        WHERE ca.comprobante_id = c.id
      ), 0)) AS saldo
    FROM comprobantes c
    LEFT JOIN pedidos p ON p.id = c.pedido_id
    WHERE c.cliente_id = v_cobro.cliente_id
      AND c.estado <> 'anulado'
      AND c.tipo::text <> 'nota_credito'
    ORDER BY (COALESCE(p.tipo_pago, 'credito') <> 'contado'), c.fecha_emision ASC, c.created_at ASC
  LOOP
    EXIT WHEN v_restante <= 0;
    v_saldo_comp := v_comp.saldo;
    IF v_saldo_comp <= 0 THEN CONTINUE; END IF;

    v_aplicar := LEAST(v_restante, v_saldo_comp);

    INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
    VALUES (p_cobro_id, v_comp.id, v_aplicar, FALSE);

    v_resultado := v_resultado || jsonb_build_object(
      'comprobante_id', v_comp.id,
      'serie', v_comp.serie,
      'numero', v_comp.numero,
      'monto_aplicado', v_aplicar,
      'saldo_anterior', v_saldo_comp,
      'saldo_despues', v_saldo_comp - v_aplicar
    );

    v_aplicado_total := v_aplicado_total + v_aplicar;
    v_restante := v_restante - v_aplicar;
  END LOOP;

  -- Si sobra, registrar saldo a cuenta
  IF v_restante > 0 THEN
    INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
    VALUES (p_cobro_id, NULL, v_restante, TRUE);
  END IF;

  RETURN jsonb_build_object(
    'aplicaciones', v_resultado,
    'aplicado', v_aplicado_total,
    'a_cuenta', v_restante,
    'total', v_cobro.total
  );
END;
$function$;

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
          LEFT JOIN pedidos p ON p.id = c.pedido_id
         WHERE c.cliente_id = v_cliente_id AND c.estado <> 'anulado' AND c.tipo::text <> 'nota_credito'
         -- Lo vendido al contado primero (se paga contra entrega), luego el crédito.
         ORDER BY (COALESCE(p.tipo_pago, 'credito') <> 'contado'), c.fecha_emision, c.created_at
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
