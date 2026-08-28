-- ═══════════════════════════════════════════════════════════════════════════
-- 104 · Guardar lo que pasa con cada envío a SUNAT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ya existían `enviado_sunat`, `sunat_estado` y `sunat_cdr`, pero con eso no
-- alcanza para operar: cuando un comprobante rebota hay que saber cuándo se
-- intentó, con qué código exacto, cuántas veces y qué dijo SUNAT, o el que
-- mira la pantalla no tiene nada que hacer más que volver a apretar el botón.
--
-- También se guarda el XML firmado. Es el documento que tiene valor legal —el
-- que SUNAT selló—, no el PDF ni el ticket impreso, y hay que poder
-- entregárselo al cliente o al contador cuatro años después.
--
-- Y las dos llaves que impiden un envío accidental a producción, explicadas
-- abajo.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS sunat_codigo        TEXT,
  ADD COLUMN IF NOT EXISTS sunat_mensaje       TEXT,
  ADD COLUMN IF NOT EXISTS sunat_observaciones TEXT[],
  ADD COLUMN IF NOT EXISTS sunat_enviado_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sunat_intentos      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sunat_modo          TEXT,
  ADD COLUMN IF NOT EXISTS sunat_xml           TEXT,
  ADD COLUMN IF NOT EXISTS sunat_ticket        TEXT;

COMMENT ON COLUMN comprobantes.sunat_codigo IS
  'Codigo del CDR: 0 aceptado, 2000-3999 rechazado, 4000+ aceptado con observaciones.';
COMMENT ON COLUMN comprobantes.sunat_modo IS
  'Contra que servicio se envio: beta o produccion. Un comprobante enviado a beta NO esta declarado.';
COMMENT ON COLUMN comprobantes.sunat_xml IS
  'El XML firmado tal cual se envio. Es el documento con valor legal.';
COMMENT ON COLUMN comprobantes.sunat_ticket IS
  'Ticket devuelto por sendSummary, para los documentos que SUNAT procesa aparte.';

-- Buscar lo que falta enviar o lo que rebotó tiene que ser barato: es la
-- consulta que va a correr la pantalla de facturación todo el día.
CREATE INDEX IF NOT EXISTS comprobantes_pendientes_sunat
  ON comprobantes (fecha_emision DESC)
  WHERE NOT enviado_sunat AND estado <> 'anulado';


-- ── Las dos llaves ────────────────────────────────────────────────────────
--
-- Enviar a producción registra el comprobante ante SUNAT y no se deshace. Por
-- eso hacen falta DOS condiciones simultáneas, y ninguna alcanza sola:
--
--   1. `sunat_modo` en 'produccion'  — se cambia acá, a conciencia
--   2. las credenciales SOL de producción cargadas en el servidor
--
-- Si falta cualquiera de las dos, el sistema envía a beta o no envía. Un
-- descuido en un solo lugar no puede emitir nada real.
--
-- `sunat_envio_automatico` es aparte a propósito: una cosa es poder enviar y
-- otra que salga solo al emitir. Arranca apagado, para que los primeros envíos
-- sean uno por uno y mirando la respuesta.
INSERT INTO configuracion (clave, valor, descripcion)
VALUES
  ('sunat_envio_automatico', 'false',
   'Si al emitir un comprobante se envia solo a SUNAT. Apagado: se envia a mano, de a uno.')
ON CONFLICT (clave) DO NOTHING;

UPDATE configuracion
   SET descripcion = 'Modo SUNAT: beta o produccion. En beta NADA queda declarado ante SUNAT.'
 WHERE clave = 'sunat_modo';
