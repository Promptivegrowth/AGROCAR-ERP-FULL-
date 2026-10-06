-- Las 24 facturas del 01 y 02/10/2026 pasan a fecha de emisión 03/10/2026.
--
-- Por indicación de SUNAT a Daniel (llamada del 06/10/2026): para que puedan
-- recibirse sin rechazo por fuera de plazo, se envían con fecha 03/10, cuyo
-- plazo de tres días vence el 06/10. Quedaron fuera de plazo porque SUNAT
-- recién activó el certificado el 06/10 a las 06:00 (error 2325 del 03 al
-- 05/10; ver migraciones 124 y 131).
--
-- Se respalda la fecha original de cada una antes de cambiarla. El XML se
-- vuelve a armar y firmar al enviarlas, con la fecha nueva.

BEGIN;

CREATE TABLE IF NOT EXISTS public._respaldo_fecha_facturas_20261006 AS
SELECT id, serie, numero, fecha_emision, fecha_vencimiento, sunat_xml, sunat_intentos, NOW() AS respaldado_at
  FROM public.comprobantes
 WHERE tipo = 'factura' AND sunat_retenido AND fecha_emision BETWEEN '2026-10-01' AND '2026-10-02';

UPDATE public.comprobantes c
   SET fecha_vencimiento = CASE WHEN c.fecha_vencimiento IS NULL THEN NULL
                                ELSE c.fecha_vencimiento + ('2026-10-03'::date - c.fecha_emision) END,
       fecha_emision = '2026-10-03',
       sunat_retenido = FALSE,
       sunat_retenido_motivo = 'Fecha de emisión cambiada de ' || to_char(c.fecha_emision, 'DD/MM/YYYY')
         || ' a 03/10/2026 por indicación de SUNAT (06/10/2026): fuera de plazo por el certificado sin activar (2325).'
 WHERE c.tipo = 'factura' AND c.sunat_retenido AND c.fecha_emision BETWEEN '2026-10-01' AND '2026-10-02';

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public._respaldo_fecha_facturas_20261006;
  IF n <> 24 THEN RAISE EXCEPTION 'Se esperaban 24 facturas y hay %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.comprobantes WHERE tipo = 'factura' AND sunat_retenido) THEN
    RAISE EXCEPTION 'Quedaron facturas retenidas';
  END IF;
END $$;

ALTER TABLE public._respaldo_fecha_facturas_20261006 ENABLE ROW LEVEL SECURITY;

COMMIT;
