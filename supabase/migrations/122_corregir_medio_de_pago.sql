-- Corregir el medio de pago de un cobro, con registro de quién y por qué.
--
-- Daniel, 01/10: Víctor hizo una venta directa desde el aplicativo, cobró por
-- Yape y lo registró como efectivo. No había forma de corregirlo: el cobro
-- queda con el desglose equivocado y la caja del día no cuadra con lo que hay
-- en la gaveta.
--
-- Se corrige solo el reparto entre efectivo, Yape, Plin y transferencia; el
-- total no cambia (si cambió el importe, es otro problema: anular y volver a
-- cobrar). Y solo mientras el cobro no esté en una caja ya cerrada: lo cerrado
-- quedó cuadrado con lo contado ese día.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cobros_correcciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES profiles(id),
  usuario_nombre TEXT,
  antes JSONB NOT NULL,
  despues JSONB NOT NULL,
  motivo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.cobros_correcciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobros_correcciones_select ON public.cobros_correcciones;
CREATE POLICY cobros_correcciones_select ON public.cobros_correcciones
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('administrador', 'gerente', 'caja', 'contador', 'facturador')));

CREATE OR REPLACE FUNCTION public.corregir_medio_pago_cobro(
  p_cobro_id uuid, p_efectivo numeric, p_yape numeric, p_plin numeric, p_transferencia numeric,
  p_nro_operacion text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_perfil RECORD;
  v_c RECORD;
  v_suma NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT full_name, role::text AS role INTO v_perfil FROM profiles WHERE id = v_user;
  IF NOT FOUND OR v_perfil.role NOT IN ('administrador', 'gerente', 'caja') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o caja pueden corregir el medio de pago de un cobro';
  END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Indicá el motivo de la corrección';
  END IF;

  SELECT * INTO v_c FROM cobros WHERE id = p_cobro_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cobro no existe'; END IF;

  IF LEAST(COALESCE(p_efectivo, 0), COALESCE(p_yape, 0), COALESCE(p_plin, 0), COALESCE(p_transferencia, 0)) < 0 THEN
    RAISE EXCEPTION 'Ningún monto puede ser negativo';
  END IF;
  v_suma := COALESCE(p_efectivo, 0) + COALESCE(p_yape, 0) + COALESCE(p_plin, 0) + COALESCE(p_transferencia, 0);
  IF ABS(v_suma - v_c.total) > 0.005 THEN
    RAISE EXCEPTION 'La suma (S/ %) tiene que ser igual al total del cobro (S/ %). Solo se corrige cómo se pagó, no cuánto.',
      to_char(v_suma, 'FM999990.00'), to_char(v_c.total, 'FM999990.00');
  END IF;

  IF EXISTS (SELECT 1 FROM caja_movimientos m JOIN caja_sesiones s ON s.id = m.sesion_id
              WHERE m.cobro_id = p_cobro_id AND s.estado::text <> 'abierta') THEN
    RAISE EXCEPTION 'Este cobro ya está en una caja cerrada: esa caja quedó cuadrada con lo contado ese día y no se modifica';
  END IF;
  IF COALESCE(v_c.conciliado, FALSE) THEN
    RAISE EXCEPTION 'Este cobro ya está conciliado con el banco y no se puede modificar';
  END IF;

  INSERT INTO cobros_correcciones (cobro_id, usuario_id, usuario_nombre, antes, despues, motivo)
  VALUES (p_cobro_id, v_user, v_perfil.full_name,
    jsonb_build_object('efectivo', v_c.efectivo, 'yape', v_c.yape, 'plin', v_c.plin,
                       'transferencia', v_c.transferencia, 'nro_operacion', v_c.nro_operacion),
    jsonb_build_object('efectivo', COALESCE(p_efectivo, 0), 'yape', COALESCE(p_yape, 0), 'plin', COALESCE(p_plin, 0),
                       'transferencia', COALESCE(p_transferencia, 0), 'nro_operacion', NULLIF(TRIM(p_nro_operacion), '')),
    TRIM(p_motivo));

  UPDATE cobros
     SET efectivo = COALESCE(p_efectivo, 0),
         yape = COALESCE(p_yape, 0),
         plin = COALESCE(p_plin, 0),
         transferencia = COALESCE(p_transferencia, 0),
         nro_operacion = COALESCE(NULLIF(TRIM(p_nro_operacion), ''), nro_operacion),
         notas = TRIM(BOTH ' ·' FROM COALESCE(notas, '') || ' · Medio de pago corregido: ' || TRIM(p_motivo))
   WHERE id = p_cobro_id;

  RETURN jsonb_build_object('ok', true, 'cobro', v_c.numero);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.corregir_medio_pago_cobro(uuid, numeric, numeric, numeric, numeric, text, text) TO authenticated;

COMMIT;
