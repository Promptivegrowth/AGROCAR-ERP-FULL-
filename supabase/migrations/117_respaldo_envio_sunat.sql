-- Un segundo programador para el envío a SUNAT, independiente de Vercel.
--
-- El envío automático corre con Vercel Cron a las 6:00. Si un día no corre
-- —una caída, un cambio de plan, un despliegue que lo deja afuera—, nadie se
-- entera hasta que el plazo de tres días se vence. Este respaldo vive en la
-- propia base (pg_cron + pg_net) y llama al mismo proceso dos veces más al
-- día, a las 13:00 y a las 21:00 de Lima.
--
-- Que corran los dos no duplica nada: cada comprobante se reserva antes de
-- enviarse (`reservar_envio_sunat`) y lo ya declarado se saltea.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- La clave del respaldo. Vive solo acá: la tabla no tiene políticas, así que
-- ni usuarios ni anónimos la leen; solo el servidor (service role) y el
-- programador.
CREATE TABLE IF NOT EXISTS public.sunat_respaldo_token (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token TEXT NOT NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.sunat_respaldo_token ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sunat_respaldo_token FROM anon, authenticated;

INSERT INTO public.sunat_respaldo_token (id, token)
VALUES (1, encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- La llamada: la misma dirección que usa Vercel Cron, con la clave del respaldo.
CREATE OR REPLACE FUNCTION public.disparar_respaldo_sunat()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT net.http_get(
    url := 'https://agrocar-erp-full.vercel.app/api/sunat/enviar-programados',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT token FROM public.sunat_respaldo_token WHERE id = 1)),
    timeout_milliseconds := 300000
  );
$function$;
REVOKE ALL ON FUNCTION public.disparar_respaldo_sunat() FROM PUBLIC, anon, authenticated;

-- 13:00 y 21:00 de Lima (18:00 y 02:00 UTC).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('sunat-respaldo-tarde', 'sunat-respaldo-noche');
SELECT cron.schedule('sunat-respaldo-tarde', '0 18 * * *', 'SELECT public.disparar_respaldo_sunat()');
SELECT cron.schedule('sunat-respaldo-noche', '0 2 * * *', 'SELECT public.disparar_respaldo_sunat()');
