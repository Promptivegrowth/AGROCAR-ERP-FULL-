-- ============================================================================
-- Venta directa en campo: mercadería, comprobante y cobro en un solo acto
-- ============================================================================
--
-- El repartidor vende del camión y recibe el dinero en el momento. Hasta
-- ahora el sistema no tenía cómo registrar eso: lo más parecido era tomar un
-- pedido —que se factura recién en la oficina, horas después— y aparte anotar
-- el cobro. Medido sobre los movimientos reales: los repartidores no crearon
-- ni un solo pedido, y entraron S/ 9.801,72 sin ninguna factura que los
-- respalde. Es decir, esa venta hoy pasa por fuera del sistema.
--
-- Dos cosas hacían falta y esta función las resuelve juntas:
--
-- 1. Que el comprobante salga en el momento. Una venta al contado tiene que
--    entregarse con su comprobante; emitirlo horas después, en otro lugar, no
--    es lo mismo ni para el cliente ni para SUNAT.
--
-- 2. Que el dinero quede pegado a ESA venta. Si el cobro se registra suelto,
--    se aplica a las facturas más viejas del cliente y la venta del día queda
--    figurando impaga. Acá el cobro nace aplicado al comprobante que se acaba
--    de emitir.
--
-- Va todo en una sola llamada a propósito: esto corre en un celular, en la
-- calle, con la señal que haya. Partido en cinco pasos, una caída a mitad de
-- camino deja mercadería descontada sin comprobante, o un comprobante sin
-- cobro. Acá o entra todo o no entra nada.
-- ============================================================================

-- Si quedó una versión anterior con otra lista de argumentos, se va: dos
-- versiones con el mismo nombre dejan la llamada ambigua y falla el permiso.
DO $limpieza$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT oid::regprocedure AS firma FROM pg_proc
    WHERE proname = 'registrar_venta_directa'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || f.firma;
  END LOOP;
END
$limpieza$;

CREATE FUNCTION registrar_venta_directa(
  p_cliente_id UUID,
  p_items JSONB,                    -- [{producto_id, cantidad, precio_unitario, subtotal, lote_id?}]
  p_tipo_comprobante TEXT,          -- 'boleta' | 'factura'
  p_pagos JSONB,                    -- {efectivo, yape, plin, transferencia, nro_operacion?}
  p_subtotal NUMERIC,
  p_igv NUMERIC,
  p_total NUMERIC,
  p_incluir_igv BOOLEAN DEFAULT TRUE,
  p_notas TEXT DEFAULT NULL,
  p_permitir_sin_stock BOOLEAN DEFAULT FALSE,
  p_motivo_reposicion TEXT DEFAULT NULL,
  p_descuento_porcentaje NUMERIC DEFAULT 0,
  p_descuento_monto NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario UUID := auth.uid();
  v_rol TEXT;
  v_pedido JSONB;
  v_pedido_res JSONB;
  v_pedido_id UUID;
  v_serie TEXT;
  v_numero TEXT;
  v_comp JSONB;
  v_comp_id UUID;
  v_cobro_id UUID;
  v_cobro_numero TEXT;
  v_pagado NUMERIC;
  v_electronico NUMERIC;
  v_efectivo_entregado NUMERIC;
  v_efectivo_queda NUMERIC;
  v_vuelto NUMERIC;
  v_cliente RECORD;
BEGIN
  -- ── Quién puede vender en campo
  SELECT role INTO v_rol FROM profiles WHERE id = v_usuario;
  IF v_rol IS NULL OR v_rol NOT IN (
    'repartidor', 'chofer', 'vendedor', 'administrador', 'gerente', 'facturador'
  ) THEN
    RAISE EXCEPTION 'Tu usuario no tiene permiso para registrar ventas directas';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta no tiene productos';
  END IF;
  IF p_total IS NULL OR p_total <= 0 THEN
    RAISE EXCEPTION 'El total de la venta debe ser mayor que cero';
  END IF;

  /*
   * El pago tiene que cubrir la venta, y lo que sobra es vuelto — no ingreso.
   *
   * Si el cliente paga con S/ 50 una venta de S/ 42,72, el repartidor le
   * devuelve S/ 7,28: esa plata nunca entró al negocio. Registrar los S/ 50
   * dejaría a Caja esperando un dinero que no existe, y al cliente con un
   * saldo a favor que nadie le prometió. Se registra lo que efectivamente
   * queda, y el vuelto se devuelve nada más como dato para la pantalla.
   *
   * El vuelto sale siempre del efectivo: Yape, Plin y una transferencia se
   * mandan por el monto exacto, no se puede dar cambio de eso.
   */
  v_efectivo_entregado := COALESCE((p_pagos->>'efectivo')::NUMERIC, 0);
  v_electronico := COALESCE((p_pagos->>'yape')::NUMERIC, 0)
                 + COALESCE((p_pagos->>'plin')::NUMERIC, 0)
                 + COALESCE((p_pagos->>'transferencia')::NUMERIC, 0);
  v_pagado := v_efectivo_entregado + v_electronico;

  IF v_pagado + 0.005 < p_total THEN
    RAISE EXCEPTION 'El pago (S/ %) no cubre el total de la venta (S/ %)',
      ROUND(v_pagado, 2), ROUND(p_total, 2);
  END IF;
  IF v_electronico > p_total + 0.005 THEN
    RAISE EXCEPTION 'Los pagos electronicos (S/ %) superan el total (S/ %): no se puede dar vuelto de un Yape o una transferencia',
      ROUND(v_electronico, 2), ROUND(p_total, 2);
  END IF;

  v_efectivo_queda := ROUND(p_total - v_electronico, 2);
  v_vuelto := ROUND(v_efectivo_entregado - v_efectivo_queda, 2);

  -- ── La factura necesita RUC; sin RUC solo se puede emitir boleta
  SELECT id, ruc, dni, razon_social, estado INTO v_cliente
    FROM clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente no existe';
  END IF;
  IF v_cliente.estado <> 'activo' THEN
    RAISE EXCEPTION 'El cliente % está inactivo', v_cliente.razon_social;
  END IF;
  IF p_tipo_comprobante = 'factura' AND COALESCE(v_cliente.ruc, '') = '' THEN
    RAISE EXCEPTION 'No se puede emitir factura a % porque no tiene RUC registrado',
      v_cliente.razon_social;
  END IF;

  -- ── 1. El pedido, que es lo que sostiene el detalle y mueve el stock
  v_pedido := jsonb_build_object(
    'numero', 'VD-' || TO_CHAR(now() AT TIME ZONE 'America/Lima', 'YYYYMMDD') || '-'
              || LPAD((FLOOR(RANDOM() * 100000))::TEXT, 5, '0'),
    'cliente_id', p_cliente_id,
    'vendedor_id', v_usuario,
    'fecha_pedido', (now() AT TIME ZONE 'America/Lima')::DATE,
    'fecha_despacho', (now() AT TIME ZONE 'America/Lima')::DATE,
    'estado', 'enviado',
    'tipo_pago', 'contado',
    'descuento_porcentaje', COALESCE(p_descuento_porcentaje, 0),
    'descuento_monto', COALESCE(p_descuento_monto, 0),
    'subtotal', p_subtotal,
    'igv', p_igv,
    'incluir_igv', p_incluir_igv,
    'total', p_total,
    'notas', COALESCE(p_notas, 'Venta directa en campo')
  );

  -- Sin stock solo si quien vende lo decidió a conciencia: ese mismo dato
  -- deja el pedido marcado para reposición, que es lo que mira almacén.
  v_pedido_res := crear_pedido_atomico(
    v_pedido, p_items, COALESCE(p_permitir_sin_stock, FALSE), p_motivo_reposicion
  );
  v_pedido_id := (v_pedido_res->>'id')::UUID;

  -- ── 2. Entregado: la mercadería ya se la llevó el cliente.
  -- El descuento de stock cuelga de este cambio de estado, no del alta, así
  -- que el pedido nace 'enviado' y recién acá sale del inventario.
  UPDATE pedidos SET estado = 'entregado', updated_at = now() WHERE id = v_pedido_id;

  -- ── 3. Comprobante, en el momento
  SELECT serie, numero INTO v_serie, v_numero
    FROM siguiente_correlativo(p_tipo_comprobante::tipo_comprobante);
  IF v_serie IS NULL THEN
    RAISE EXCEPTION 'No hay serie activa para %', p_tipo_comprobante;
  END IF;

  v_comp := emitir_comprobante_atomico(
    v_pedido_id, p_tipo_comprobante, v_serie, v_numero,
    (now() AT TIME ZONE 'America/Lima')::DATE,
    p_subtotal, p_igv, p_total, v_usuario
  );
  v_comp_id := (v_comp->>'id')::UUID;

  -- ── 4. El cobro, aplicado a ESTE comprobante y no al más viejo del cliente
  -- El correlativo lo pone un disparador al insertar; no se manda a mano
  -- para no adelantar la numeración si algo falla más adelante.
  INSERT INTO cobros (
    cliente_id, cobrador_id, tipo, referencia_id, fecha,
    efectivo, yape, plin, transferencia, total, nro_operacion, notas
  ) VALUES (
    p_cliente_id, v_usuario, 'cobranza', v_pedido_id,
    (now() AT TIME ZONE 'America/Lima')::DATE,
    v_efectivo_queda,
    COALESCE((p_pagos->>'yape')::NUMERIC, 0),
    COALESCE((p_pagos->>'plin')::NUMERIC, 0),
    COALESCE((p_pagos->>'transferencia')::NUMERIC, 0),
    p_total,
    NULLIF(p_pagos->>'nro_operacion', ''),
    'Venta directa ' || v_serie || '-' || v_numero
  ) RETURNING id, numero INTO v_cobro_id, v_cobro_numero;

  -- Al insertar el cobro, un disparador ya repartió la plata entre las
  -- facturas más viejas del cliente. Eso es lo correcto para una cobranza,
  -- pero no acá: este dinero es de ESTA venta. Se borra ese reparto y se
  -- escribe el que corresponde, por el total exacto de la venta.
  DELETE FROM cobros_aplicaciones WHERE cobro_id = v_cobro_id;

  INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
  VALUES (v_cobro_id, v_comp_id, p_total, FALSE);

  RETURN jsonb_build_object(
    'pedido_id', v_pedido_id,
    'comprobante_id', v_comp_id,
    'serie', v_serie,
    'numero', v_numero,
    'tipo', p_tipo_comprobante,
    'total', p_total,
    'recibido', v_efectivo_entregado + v_electronico,
    'efectivo_registrado', v_efectivo_queda,
    'vuelto', GREATEST(0, v_vuelto),
    'cobro_id', v_cobro_id,
    'cobro_numero', v_cobro_numero,
    'cliente', v_cliente.razon_social
  );
END;
$$;

COMMENT ON FUNCTION registrar_venta_directa IS
  'Venta directa en campo: crea el pedido, descuenta el stock, emite el comprobante y registra el cobro aplicado a ese comprobante, todo en una sola transacción. Pensada para el PWA del repartidor, donde una caída de señal a mitad de camino dejaría la venta a medio registrar.';

GRANT EXECUTE ON FUNCTION registrar_venta_directa TO authenticated;
