-- Todo lo que el ERP declara a SUNAT va en series 002.
--
-- 01/10/2026: al declarar la primera guía, SUNAT respondió 1033 ("registrado
-- previamente con otros datos"): AGROCAR ya tiene guías T001 emitidas con el
-- sistema que usaba antes. Las series 001 son de ese sistema. Decisión de
-- Luigi: el ERP usa las 002 en todo —facturas F002 y boletas B002 ya lo
-- hacían—, así que las guías pasan a T002 y las notas de crédito a FC02.

BEGIN;

-- ── 1. Guías: las que no se declararon pasan de T001 a T002, mismo número ──
-- T001-1 quedó con el rechazo 1033 anotado: era otro documento para SUNAT.
-- Como T002-1 es una guía nueva, se limpia el rastro del envío fallido.
UPDATE guias_remision g
   SET serie = 'T002',
       sunat_ticket = NULL, sunat_estado = NULL, sunat_codigo = NULL,
       sunat_mensaje = NULL, sunat_xml = NULL, sunat_cdr = NULL,
       sunat_enviado_at = NULL, sunat_intentos = 0
 WHERE g.serie = 'T001'
   AND COALESCE(g.enviado_sunat, FALSE) = FALSE
   AND NOT EXISTS (SELECT 1 FROM guias_remision o WHERE o.serie = 'T002' AND o.numero = g.numero);

ALTER TABLE guias_remision ALTER COLUMN serie SET DEFAULT 'T002';

CREATE OR REPLACE FUNCTION public.siguiente_numero_guia(p_serie TEXT DEFAULT 'T002')
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('guia_' || p_serie));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_max
    FROM guias_remision WHERE serie = p_serie;
  RETURN v_max;
END;
$$;

-- La serie dentro de la función que emite la guía.
DO $cambio$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef('public.emitir_guia_desde_comprobante'::regproc) INTO v_src;
  IF position('c_serie CONSTANT TEXT := ''T001''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'emitir_guia_desde_comprobante no tiene la serie donde se esperaba: revisar a mano';
  END IF;
  EXECUTE replace(v_src, 'c_serie CONSTANT TEXT := ''T001''', 'c_serie CONSTANT TEXT := ''T002''');
END
$cambio$;

COMMENT ON COLUMN guias_remision.serie IS
  'Serie de la guía. SUNAT exige cuatro caracteres empezando con T. El ERP usa T002: la T001 es del sistema anterior de AGROCAR.';

-- ── 2. Notas de crédito: FC01 se retira, FC02 arranca en 0 ────────────────
-- No hay ninguna emitida desde que el sistema arrancó.
UPDATE series_correlativos SET activo = FALSE, updated_at = NOW()
 WHERE tipo_comprobante = 'nota_credito' AND serie = 'FC01';
UPDATE series_correlativos SET activo = TRUE, correlativo_actual = 0, updated_at = NOW()
 WHERE tipo_comprobante = 'nota_credito' AND serie = 'FC02';

COMMIT;
