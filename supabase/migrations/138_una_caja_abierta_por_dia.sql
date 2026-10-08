-- Una caja abierta por día, no una sola en total.
--
-- Daniel, 08/10/2026: con la caja del 06/10 abierta (pendiente de su arqueo),
-- la pantalla de Caja solo mostraba ese día y no dejaba abrir la de hoy: no
-- podían ver ni imprimir la liquidación del 08/10. Ahora cada día puede tener
-- su caja abierta a la vez que otras; lo que no se puede es abrir dos cajas del
-- mismo día. Los cobros nuevos ya entraban solo a la caja de su día (137).

CREATE OR REPLACE FUNCTION public.abrir_caja_con_huerfanos(
  p_saldo_inicial numeric, p_cargar_huerfanos boolean DEFAULT false, p_notas text DEFAULT NULL::text,
  p_fecha date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_sesion_id UUID;
  v_hoy DATE := (NOW() AT TIME ZONE 'America/Lima')::date;
  v_dia DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
  v_migrados INT := 0;
  v_total NUMERIC := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF EXISTS (SELECT 1 FROM caja_sesiones WHERE estado = 'abierta' AND fecha_caja = v_dia) THEN
    RAISE EXCEPTION 'La caja del % ya está abierta', to_char(v_dia, 'DD/MM/YYYY');
  END IF;
  IF p_saldo_inicial < 0 THEN RAISE EXCEPTION 'El saldo inicial no puede ser negativo'; END IF;
  IF v_dia > v_hoy THEN RAISE EXCEPTION 'No se puede abrir la caja de un día futuro'; END IF;
  IF v_dia < v_hoy AND NOT EXISTS (
       SELECT 1 FROM cobros c WHERE c.fecha = v_dia AND COALESCE(c.total, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id)) THEN
    RAISE EXCEPTION 'El % no tiene cobros pendientes de liquidar', to_char(v_dia, 'DD/MM/YYYY');
  END IF;

  INSERT INTO caja_sesiones (cajero_id, fecha_apertura, fecha_caja, saldo_inicial, estado)
  VALUES (v_user_id, NOW(), v_dia, p_saldo_inicial, 'abierta')
  RETURNING id INTO v_sesion_id;

  -- Los cobros de ESTE día que todavía no entraron a ninguna caja. Un día
  -- pasado siempre los carga: es para lo que se abre.
  IF p_cargar_huerfanos OR v_dia < v_hoy THEN
    INSERT INTO caja_movimientos (sesion_id, tipo, categoria, descripcion, monto, cobro_id, cobrador_id, created_at)
    SELECT v_sesion_id, 'ingreso', 'cobro_retroactivo'::categoria_caja_movimiento,
           'Cobro previo · ' || COALESCE(c.numero, 'R-?') || ' · ' || COALESCE(cl.razon_social, c.cliente_externo_nombre, 'CF'),
           c.total, c.id, c.cobrador_id, c.created_at
      FROM cobros c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
     WHERE c.fecha = v_dia AND COALESCE(c.total, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id);
    GET DIAGNOSTICS v_migrados = ROW_COUNT;
    SELECT COALESCE(SUM(monto), 0) INTO v_total FROM caja_movimientos
     WHERE sesion_id = v_sesion_id AND categoria = 'cobro_retroactivo';
  END IF;

  UPDATE caja_sesiones SET notas = NULLIF(CONCAT_WS(' · ',
      NULLIF(TRIM(p_notas), ''),
      CASE WHEN v_dia < v_hoy THEN 'Caja del ' || to_char(v_dia, 'DD/MM/YYYY') || ' abierta el ' || to_char(v_hoy, 'DD/MM/YYYY') END,
      CASE WHEN v_migrados > 0 THEN 'Cargados ' || v_migrados || ' cobros pendientes por S/' || v_total END), '')
   WHERE id = v_sesion_id;

  RETURN jsonb_build_object('sesion_id', v_sesion_id, 'fecha_caja', v_dia,
                            'huerfanos_migrados', v_migrados, 'total_migrado', v_total);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.abrir_caja_con_huerfanos(numeric, boolean, text, date) TO authenticated;
