-- SUNAT "en proceso": ni rechazo ni olvido.
--
-- 10 y 11/10/2026: el servidor de SUNAT falló de madrugada (502). El envío de
-- las 06:00 a veces le llegaba igual, el reintento inmediato chocaba con él y
-- SUNAT respondía "0140 - Existe un documento igual en proceso" para todo el
-- día. Se veía como "Rechazado" y nadie lo reintentaba hasta la 1 p. m.
--
--   * El código ya no reintenta en el momento un 5xx y anota 0140/0100 o la
--     falta de respuesta como sunat_estado = 'en_proceso' (no 'rechazado').
--   * Lo que ya quedó marcado como rechazado por 0140/0100 pasa a 'en_proceso'.
--   * Un barrido más a las 10:00 de Lima (15:00 UTC), además del de las 06:00
--     (Vercel) y los de respaldo de las 13:00 y 21:00: SUNAT pide reintentar a
--     los 15 minutos, y esperar hasta la tarde era perder medio día de plazo.

UPDATE public.comprobantes
   SET sunat_estado = 'en_proceso',
       sunat_mensaje = 'En proceso en SUNAT, se reintenta solo: ' || COALESCE(sunat_mensaje, '')
 WHERE sunat_estado = 'rechazado'
   AND NOT COALESCE(enviado_sunat, false)
   AND sunat_codigo ~ '(^|\.)01[04]0$';

SELECT cron.unschedule('sunat-respaldo-manana')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sunat-respaldo-manana');
SELECT cron.schedule('sunat-respaldo-manana', '0 15 * * *', 'SELECT public.disparar_respaldo_sunat()');
