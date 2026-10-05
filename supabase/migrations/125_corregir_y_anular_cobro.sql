-- Corregir un cobro mal ingresado (monto, medio de pago, cliente) y anular uno
-- que no debía existir. Daniel, 05/10/2026: "cómo puedo modificar una
-- cobranza que la ingresaron mal".
--
-- Hasta acá solo se podía corregir el medio de pago (migración 122) y, si el
-- error era el importe, la respuesta era "anular y volver a cobrar"; pero no
-- había cómo anular, y en el ERP no se registran cobros (solo en el
-- aplicativo).
--
-- Reglas, las mismas que la 122:
--   * solo administración, gerencia o caja, y siempre con motivo;
--   * no se toca un cobro que ya está en una caja cerrada (esa caja quedó
--     cuadrada con lo contado ese día) ni uno conciliado con el banco;
--   * queda registrado quién, cuándo, por qué, y cómo estaba antes.
--
-- Qué pasa con los comprobantes: el saldo de cada comprobante es su total
-- menos lo aplicado (cobros_aplicaciones). Al corregir se rearman las
-- aplicaciones de este cobro:
--   * mismo cliente: primero a los mismos comprobantes a los que estaba
--     aplicado (el cobrador eligió a qué factura pagaba), hasta su saldo;
--     lo que sobre, a los más antiguos; y si aún sobra, a cuenta;
--   * otro cliente: desde cero, a los más antiguos del cliente nuevo
--     (aplicar_cobro_fifo).
-- El movimiento de caja lo actualiza el disparador de cobros al cambiar el
-- total. Si el cobro ya tenía asiento contable, se anula para que se vuelva a
-- generar con los datos corregidos.

BEGIN;

-- Lo anulado se guarda entero acá: el cobro se borra (así deja de sumar en
-- caja, saldos y reportes sin tocar cada consulta) pero no se pierde.
CREATE TABLE IF NOT EXISTS public.cobros_anulados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id UUID NOT NULL,                 -- sin FK: el cobro ya no existe
  numero TEXT,
  cliente_id UUID,
  total NUMERIC,
  cobro JSONB NOT NULL,                   -- la fila completa
  aplicaciones JSONB,                     -- a qué comprobantes estaba aplicado
  correcciones JSONB,                     -- correcciones previas, si hubo
  usuario_id UUID REFERENCES profiles(id),
  usuario_nombre TEXT,
  motivo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.cobros_anulados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobros_anulados_select ON public.cobros_anulados;
CREATE POLICY cobros_anulados_select ON public.cobros_anulados
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('administrador', 'gerente', 'caja', 'contador', 'facturador')));

-- Las validaciones comunes, en un solo lugar.
CREATE OR REPLACE FUNCTION public._cobro_modificable(p_cobro_id uuid, p_motivo text, p_accion text,
  OUT uid uuid, OUT nombre text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_perfil RECORD;
  v_c RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT full_name, role::text AS role INTO v_perfil FROM profiles WHERE id = v_user;
  IF NOT FOUND OR v_perfil.role NOT IN ('administrador', 'gerente', 'caja') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o caja pueden % un cobro', p_accion;
  END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Indica el motivo';
  END IF;
  SELECT * INTO v_c FROM cobros WHERE id = p_cobro_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cobro no existe'; END IF;
  IF EXISTS (SELECT 1 FROM caja_movimientos m JOIN caja_sesiones s ON s.id = m.sesion_id
              WHERE m.cobro_id = p_cobro_id AND s.estado::text <> 'abierta') THEN
    RAISE EXCEPTION 'El cobro % ya está en una caja cerrada: esa caja quedó cuadrada con lo contado ese día y no se modifica', v_c.numero;
  END IF;
  IF COALESCE(v_c.conciliado, FALSE) THEN
    RAISE EXCEPTION 'El cobro % ya está conciliado con el banco y no se puede modificar', v_c.numero;
  END IF;
  uid := v_user;
  nombre := v_perfil.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.corregir_cobro(
  p_cobro_id uuid, p_cliente_id uuid,
  p_efectivo numeric, p_yape numeric, p_plin numeric, p_transferencia numeric,
  p_nro_operacion text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quien RECORD;
  v_c RECORD;
  v_total NUMERIC;
  v_resto NUMERIC;
  v_aplicar NUMERIC;
  v_destinos UUID[];
  v_comp RECORD;
  v_antes_aplic JSONB;
  v_cambio_cliente BOOLEAN;
BEGIN
  SELECT * INTO v_quien FROM _cobro_modificable(p_cobro_id, p_motivo, 'corregir');
  SELECT * INTO v_c FROM cobros WHERE id = p_cobro_id;

  IF LEAST(COALESCE(p_efectivo, 0), COALESCE(p_yape, 0), COALESCE(p_plin, 0), COALESCE(p_transferencia, 0)) < 0 THEN
    RAISE EXCEPTION 'Ningún monto puede ser negativo';
  END IF;
  v_total := ROUND(COALESCE(p_efectivo, 0) + COALESCE(p_yape, 0) + COALESCE(p_plin, 0) + COALESCE(p_transferencia, 0), 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total tiene que ser mayor a cero. Si el cobro no debía existir, anúlalo.';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'El cliente elegido no existe';
  END IF;
  v_cambio_cliente := p_cliente_id IS DISTINCT FROM v_c.cliente_id AND p_cliente_id IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('comprobante_id', comprobante_id, 'monto_aplicado', monto_aplicado,
           'es_a_cuenta', es_a_cuenta) ORDER BY id), '[]'::jsonb),
         array_agg(comprobante_id ORDER BY id) FILTER (WHERE NOT es_a_cuenta AND comprobante_id IS NOT NULL)
    INTO v_antes_aplic, v_destinos
    FROM cobros_aplicaciones WHERE cobro_id = p_cobro_id;

  INSERT INTO cobros_correcciones (cobro_id, usuario_id, usuario_nombre, antes, despues, motivo)
  VALUES (p_cobro_id, v_quien.uid, v_quien.nombre,
    jsonb_build_object('cliente_id', v_c.cliente_id, 'efectivo', v_c.efectivo, 'yape', v_c.yape, 'plin', v_c.plin,
                       'transferencia', v_c.transferencia, 'total', v_c.total, 'nro_operacion', v_c.nro_operacion,
                       'aplicaciones', v_antes_aplic),
    jsonb_build_object('cliente_id', COALESCE(p_cliente_id, v_c.cliente_id), 'efectivo', COALESCE(p_efectivo, 0),
                       'yape', COALESCE(p_yape, 0), 'plin', COALESCE(p_plin, 0),
                       'transferencia', COALESCE(p_transferencia, 0), 'total', v_total,
                       'nro_operacion', COALESCE(NULLIF(TRIM(p_nro_operacion), ''), v_c.nro_operacion)),
    TRIM(p_motivo));

  UPDATE cobros
     SET cliente_id = COALESCE(p_cliente_id, cliente_id),
         efectivo = COALESCE(p_efectivo, 0),
         yape = COALESCE(p_yape, 0),
         plin = COALESCE(p_plin, 0),
         transferencia = COALESCE(p_transferencia, 0),
         total = v_total,
         nro_operacion = COALESCE(NULLIF(TRIM(p_nro_operacion), ''), nro_operacion),
         notas = TRIM(BOTH ' ·' FROM COALESCE(notas, '') || ' · Corregido: ' || TRIM(p_motivo))
   WHERE id = p_cobro_id;

  -- Rearmar a qué comprobantes se aplica.
  IF v_cambio_cliente OR v_c.cliente_id IS NULL THEN
    PERFORM aplicar_cobro_fifo(p_cobro_id);
  ELSE
    DELETE FROM cobros_aplicaciones WHERE cobro_id = p_cobro_id;
    v_resto := v_total;
    -- 1) los mismos comprobantes de antes, en el mismo orden; 2) los más antiguos.
    FOR v_comp IN
      SELECT c.id,
             c.total - COALESCE((SELECT SUM(a.monto_aplicado) FROM cobros_aplicaciones a WHERE a.comprobante_id = c.id), 0) AS saldo,
             COALESCE(array_position(v_destinos, c.id), 2147483647) AS prioridad
        FROM comprobantes c
       WHERE c.cliente_id = v_c.cliente_id AND c.estado <> 'anulado'
       ORDER BY prioridad, c.fecha_emision, c.created_at
    LOOP
      EXIT WHEN v_resto <= 0;
      CONTINUE WHEN v_comp.saldo <= 0;
      v_aplicar := LEAST(v_resto, v_comp.saldo);
      INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
      VALUES (p_cobro_id, v_comp.id, v_aplicar, FALSE);
      v_resto := v_resto - v_aplicar;
    END LOOP;
    IF v_resto > 0.001 THEN
      INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
      VALUES (p_cobro_id, NULL, v_resto, TRUE);
    END IF;
  END IF;

  -- El asiento, si existía, se rehace con lo corregido.
  UPDATE asientos_contables SET estado = 'anulado'
   WHERE referencia_tabla = 'cobros' AND referencia_id = p_cobro_id AND estado <> 'anulado';

  RETURN jsonb_build_object('ok', true, 'cobro', v_c.numero, 'total_antes', v_c.total, 'total', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_cobro(p_cobro_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quien RECORD;
  v_c RECORD;
BEGIN
  SELECT * INTO v_quien FROM _cobro_modificable(p_cobro_id, p_motivo, 'anular');
  SELECT * INTO v_c FROM cobros WHERE id = p_cobro_id;

  INSERT INTO cobros_anulados (cobro_id, numero, cliente_id, total, cobro, aplicaciones, correcciones,
                               usuario_id, usuario_nombre, motivo)
  VALUES (v_c.id, v_c.numero, v_c.cliente_id, v_c.total, to_jsonb(v_c),
    (SELECT jsonb_agg(to_jsonb(a)) FROM cobros_aplicaciones a WHERE a.cobro_id = p_cobro_id),
    (SELECT jsonb_agg(to_jsonb(k)) FROM cobros_correcciones k WHERE k.cobro_id = p_cobro_id),
    v_quien.uid, v_quien.nombre, TRIM(p_motivo));

  UPDATE asientos_contables SET estado = 'anulado'
   WHERE referencia_tabla = 'cobros' AND referencia_id = p_cobro_id AND estado <> 'anulado';

  -- Borra también su movimiento de caja y sus aplicaciones (cascada y
  -- disparador): los comprobantes vuelven a quedar con ese saldo pendiente.
  DELETE FROM cobros WHERE id = p_cobro_id;

  RETURN jsonb_build_object('ok', true, 'cobro', v_c.numero, 'total', v_c.total);
END;
$function$;

REVOKE ALL ON FUNCTION public._cobro_modificable(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corregir_cobro(uuid, uuid, numeric, numeric, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_cobro(uuid, text) TO authenticated;

COMMIT;
