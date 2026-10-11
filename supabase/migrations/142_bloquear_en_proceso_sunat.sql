-- Un comprobante "en proceso" en SUNAT tampoco se edita ni se anula.
--
-- Auditoría del 11/10/2026: 'en_proceso' (141) es un comprobante que SUNAT
-- puede tener en su cola (0140, 0100 o sin respuesta). El bloqueo de la 116
-- solo cubría lo aceptado y lo que se está enviando en este minuto: uno en
-- proceso se podía editar o anular, y si después SUNAT aceptaba la versión
-- original, el ERP y SUNAT quedaban distintos. Se bloquea igual que uno
-- declarado: el siguiente barrido lo resuelve (aceptado, o rechazo real que lo
-- libera).
CREATE OR REPLACE FUNCTION public.comprobante_bloqueado_por_sunat(c comprobantes)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  -- COALESCE: un comprobante recién emitido tiene todo esto en NULL, y en
  -- SQL "NULL AND algo" no es falso sino NULL.
  SELECT COALESCE(c.enviado_sunat AND c.sunat_modo = 'produccion', false)
      OR COALESCE(c.sunat_estado = 'enviando' AND c.sunat_enviado_at > NOW() - INTERVAL '10 minutes', false)
      OR COALESCE(c.sunat_estado = 'en_proceso' AND c.sunat_modo = 'produccion', false)
$function$;
