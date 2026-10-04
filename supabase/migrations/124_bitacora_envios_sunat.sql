-- Migración 124: bitácora de cada intento de envío a SUNAT.
--
-- Hasta acá el comprobante guardaba solo el ÚLTIMO intento: sunat_mensaje y
-- sunat_enviado_at se pisaban en cada reintento. Del 03 al 04/10/2026 SUNAT
-- rechazó todo con 2325 ("certificado no comunicado") mientras activaba el
-- certificado nuevo, y cada rechazo traía un ticket de SUNAT. Esos tickets, con
-- su fecha y hora, son el sustento de que la empresa intentó declarar dentro
-- del plazo y que la demora fue de SUNAT. Se guardan todos, para siempre.
--
-- Va por disparador y no en el código que envía: así queda registrado venga el
-- envío de donde venga (Vercel, el respaldo de pg_cron, un script, a mano).

CREATE TABLE IF NOT EXISTS public.sunat_bitacora (
  id            BIGSERIAL PRIMARY KEY,
  comprobante_id UUID NOT NULL REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  comprobante   TEXT NOT NULL,             -- F002-00000005, para leerla sin cruzar
  fecha_emision DATE,
  intento       INT,
  enviado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modo          TEXT,
  aceptado      BOOLEAN NOT NULL DEFAULT false,
  codigo        TEXT,
  mensaje       TEXT,
  ticket        TEXT                       -- el que devuelve SUNAT en el mensaje
);

CREATE INDEX IF NOT EXISTS sunat_bitacora_comprobante_idx ON public.sunat_bitacora (comprobante_id, enviado_at);
CREATE INDEX IF NOT EXISTS sunat_bitacora_fecha_idx ON public.sunat_bitacora (enviado_at);

COMMENT ON TABLE public.sunat_bitacora IS
  'Cada intento de envío a SUNAT con su respuesta y ticket. Sustento ante SUNAT; no se borra.';

-- Solo lectura para el personal del ERP; escribe únicamente el disparador.
ALTER TABLE public.sunat_bitacora ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sunat_bitacora_lectura ON public.sunat_bitacora;
CREATE POLICY sunat_bitacora_lectura ON public.sunat_bitacora FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
    AND p.role IN ('gerente', 'administrador', 'facturador', 'contador', 'caja')));

-- SECURITY DEFINER: el que actualiza el comprobante no necesita permiso de
-- escritura en la bitácora. Y nunca hace fallar al comprobante: si anotar
-- falla, se avisa y el envío sigue.
CREATE OR REPLACE FUNCTION public.anotar_intento_sunat()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sunat_intentos IS DISTINCT FROM OLD.sunat_intentos
     OR (NEW.enviado_sunat AND NOT COALESCE(OLD.enviado_sunat, false)) THEN
    BEGIN
      INSERT INTO public.sunat_bitacora
        (comprobante_id, comprobante, fecha_emision, intento, enviado_at, modo, aceptado, codigo, mensaje, ticket)
      VALUES (
        NEW.id, NEW.serie || '-' || NEW.numero, NEW.fecha_emision, NEW.sunat_intentos,
        COALESCE(NEW.sunat_enviado_at, now()), NEW.sunat_modo, COALESCE(NEW.enviado_sunat, false),
        NEW.sunat_codigo, NEW.sunat_mensaje,
        substring(NEW.sunat_mensaje FROM 'ticket: ([0-9a-fA-F-]{36})')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bitácora SUNAT: no se pudo anotar %-%: %', NEW.serie, NEW.numero, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_anotar_intento_sunat ON public.comprobantes;
CREATE TRIGGER trg_anotar_intento_sunat
  AFTER UPDATE ON public.comprobantes
  FOR EACH ROW EXECUTE FUNCTION public.anotar_intento_sunat();

-- Lo que ya hay: el último intento de cada comprobante en producción. Los
-- anteriores se pisaron antes de que existiera esta tabla.
INSERT INTO public.sunat_bitacora
  (comprobante_id, comprobante, fecha_emision, intento, enviado_at, modo, aceptado, codigo, mensaje, ticket)
SELECT c.id, c.serie || '-' || c.numero, c.fecha_emision, c.sunat_intentos, c.sunat_enviado_at, c.sunat_modo,
  COALESCE(c.enviado_sunat, false), c.sunat_codigo, c.sunat_mensaje,
  substring(c.sunat_mensaje FROM 'ticket: ([0-9a-fA-F-]{36})')
FROM public.comprobantes c
WHERE c.sunat_enviado_at IS NOT NULL AND c.sunat_modo = 'produccion' AND COALESCE(c.sunat_intentos, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.sunat_bitacora b WHERE b.comprobante_id = c.id);
