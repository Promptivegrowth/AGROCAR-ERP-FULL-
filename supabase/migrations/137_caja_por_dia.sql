-- Una caja por día: cerrar cada día por separado aunque se acumulen días sin
-- cerrar.
--
-- Daniel, 07/10/2026: el 06/10 nadie abrió caja. El 07/10 a las 20:48 se abrió
-- la caja y la apertura cargó los 43 cobros del 06/10 (S/ 11,356.43) junto con
-- los del 07/10. Pero la pantalla calculaba el saldo teórico y la liquidación
-- solo con los cobros de "hoy": se cerró en S/ 18,142.58 (lo del 07/10) y lo
-- del 06/10 quedó dentro de esa caja sin cuadrarse en ningún arqueo. Daniel
-- pide cerrar por día, no acumulado.
--
--   * Cada caja pertenece a un día (fecha_caja). Al abrirla se cargan solo los
--     cobros pendientes de ese día.
--   * Un cobro nuevo entra a la caja abierta solo si es de su mismo día; si no,
--     espera a la caja de su día.
--   * Se puede abrir la caja de un día pasado que quedó con cobros pendientes,
--     hacer su arqueo y cerrarla. Sigue habiendo una sola caja abierta a la vez.
--   * El caso del 06/10: sus 43 cobros salen de la caja del 07/10 (que queda con
--     sus 77 cobros y sus S/ 18,142.58 exactos) y pasan a una caja del 06/10,
--     abierta, para que se haga su arqueo y se cierre.

BEGIN;

ALTER TABLE public.caja_sesiones ADD COLUMN IF NOT EXISTS fecha_caja DATE;
UPDATE public.caja_sesiones SET fecha_caja = (fecha_apertura AT TIME ZONE 'America/Lima')::date WHERE fecha_caja IS NULL;
ALTER TABLE public.caja_sesiones ALTER COLUMN fecha_caja SET DEFAULT ((NOW() AT TIME ZONE 'America/Lima')::date);
ALTER TABLE public.caja_sesiones ALTER COLUMN fecha_caja SET NOT NULL;
COMMENT ON COLUMN public.caja_sesiones.fecha_caja IS 'Día de operación que liquida esta caja: solo lleva cobros de ese día.';

-- Apertura: la caja de un día, con los cobros pendientes de ese día.
DROP FUNCTION IF EXISTS public.abrir_caja_con_huerfanos(numeric, boolean, text);
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
  IF EXISTS (SELECT 1 FROM caja_sesiones WHERE estado = 'abierta') THEN
    RAISE EXCEPTION 'Ya hay una caja abierta. Ciérrala antes de abrir otra.';
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

-- Los cobros pendientes de UN día (los que cargaría su caja al abrirse).
DROP FUNCTION IF EXISTS public.contar_cobros_huerfanos();
CREATE OR REPLACE FUNCTION public.contar_cobros_huerfanos(p_fecha date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dia DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
  v_resultado JSONB;
BEGIN
  SELECT jsonb_build_object(
    'count', COUNT(*),
    'total', COALESCE(SUM(c.total), 0),
    'efectivo_total', COALESCE(SUM(c.efectivo), 0),
    'fecha_minima', MIN(c.created_at),
    'fecha_maxima', MAX(c.created_at),
    'cobros', COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id, 'numero', c.numero, 'fecha', c.fecha, 'created_at', c.created_at,
      'total', c.total, 'efectivo', c.efectivo, 'cobrador', p.full_name, 'cliente', cl.razon_social
    ) ORDER BY c.created_at), '[]'::jsonb)
  ) INTO v_resultado
  FROM cobros c
  LEFT JOIN profiles p ON p.id = c.cobrador_id
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  WHERE c.fecha = v_dia AND COALESCE(c.total, 0) > 0
    AND NOT EXISTS (SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id);
  RETURN v_resultado;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.contar_cobros_huerfanos(date) TO authenticated;

-- Un cobro nuevo entra a la caja abierta solo si es de su día.
CREATE OR REPLACE FUNCTION public.sync_cobro_a_caja_movimiento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sesion_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_sesion_id FROM caja_sesiones
     WHERE estado = 'abierta' AND fecha_caja = NEW.fecha
     ORDER BY fecha_apertura DESC LIMIT 1;
    -- Sin caja abierta de su día, el cobro espera: lo carga la caja de su día.
    IF v_sesion_id IS NULL THEN RETURN NEW; END IF;
    INSERT INTO caja_movimientos (sesion_id, tipo, categoria, descripcion, monto, cobrador_id, cobro_id)
    VALUES (v_sesion_id, 'ingreso', 'cobro_cliente', 'Cobro #' || substr(NEW.id::text, 1, 8), NEW.total, NEW.cobrador_id, NEW.id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.total IS DISTINCT FROM OLD.total THEN
      UPDATE caja_movimientos SET monto = NEW.total WHERE cobro_id = NEW.id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM caja_movimientos WHERE cobro_id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- El caso del 06/10: separar sus 43 cobros de la caja del 07/10.
DO $$
DECLARE
  v_s07 RECORD;
  v_nueva UUID;
  v_n INT;
  v_tot NUMERIC;
BEGIN
  SELECT * INTO v_s07 FROM caja_sesiones WHERE fecha_caja = '2026-10-07' AND estado::text = 'cerrada'
   ORDER BY fecha_apertura DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM caja_sesiones WHERE estado = 'abierta') THEN
    RAISE NOTICE 'Hay una caja abierta: no se separa el 06/10 automáticamente';
    RETURN;
  END IF;
  SELECT COUNT(*), COALESCE(SUM(m.monto), 0) INTO v_n, v_tot
    FROM caja_movimientos m JOIN cobros c ON c.id = m.cobro_id
   WHERE m.sesion_id = v_s07.id AND c.fecha = '2026-10-06';
  IF v_n = 0 THEN RETURN; END IF;

  INSERT INTO caja_sesiones (cajero_id, fecha_apertura, fecha_caja, saldo_inicial, estado, notas)
  VALUES (v_s07.cajero_id, NOW(), '2026-10-06', 0, 'abierta',
          'Caja del 06/10/2026 separada de la del 07/10 (Daniel, 07/10): ' || v_n || ' cobros por S/' || v_tot
          || ' que se habían cargado en la caja del 07/10 sin cuadrarse. Falta su arqueo y cierre.')
  RETURNING id INTO v_nueva;

  UPDATE caja_movimientos m SET sesion_id = v_nueva
    FROM cobros c
   WHERE c.id = m.cobro_id AND m.sesion_id = v_s07.id AND c.fecha = '2026-10-06';

  UPDATE caja_sesiones SET notas = CONCAT_WS(' · ', NULLIF(notas, ''),
         'Se separaron ' || v_n || ' cobros del 06/10 (S/' || v_tot || ') a su propia caja')
   WHERE id = v_s07.id;
END $$;

COMMIT;
