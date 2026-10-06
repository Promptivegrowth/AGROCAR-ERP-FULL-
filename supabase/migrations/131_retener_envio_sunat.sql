-- Retener comprobantes para que el envío automático no los mande a SUNAT.
--
-- 06/10/2026: SUNAT activó el certificado (los 95 del 03/10 salieron
-- aceptados a las 06:00), pero las 24 facturas del 01 y 02/10 ya pasaron su
-- plazo de tres días. Mandadas ahora, SUNAT las rechaza por fuera de plazo y
-- quedan registradas como rechazadas: ese número ya no se podría usar. SUNAT le
-- indicó a Daniel que las presente por Mesa de Partes Virtual para que amplíen
-- la fecha de envío. Hasta entonces no tienen que salir.
--
-- La retención va en reservar_envio_sunat, que es la puerta por la que pasa
-- todo envío (Vercel, el respaldo de pg_cron, el botón "Declarar"): no depende
-- de que se despliegue código.

BEGIN;

ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS sunat_retenido BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS sunat_retenido_motivo TEXT;
COMMENT ON COLUMN public.comprobantes.sunat_retenido IS
  'No se envía a SUNAT mientras esté en verdadero (p. ej. factura fuera de plazo esperando ampliación por Mesa de Partes).';

CREATE OR REPLACE FUNCTION public.reservar_envio_sunat(p_comprobante_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  UPDATE comprobantes
     SET sunat_estado = 'enviando', sunat_enviado_at = NOW()
   WHERE id = p_comprobante_id
     AND NOT sunat_retenido
     AND NOT COALESCE(enviado_sunat AND sunat_modo = 'produccion', false)
     AND NOT COALESCE(sunat_estado = 'enviando' AND sunat_enviado_at > NOW() - INTERVAL '10 minutes', false)
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$function$;

-- Las 24 facturas del 01 y 02/10.
UPDATE public.comprobantes
   SET sunat_retenido = TRUE,
       sunat_retenido_motivo = 'Fuera de plazo por el certificado sin activar (2325, 03-05/10). Se presenta por Mesa de Partes Virtual para ampliar la fecha de envío.'
 WHERE tipo = 'factura' AND estado <> 'anulado'
   AND fecha_emision BETWEEN '2026-10-01' AND '2026-10-02'
   AND NOT COALESCE(enviado_sunat, false);

COMMIT;
