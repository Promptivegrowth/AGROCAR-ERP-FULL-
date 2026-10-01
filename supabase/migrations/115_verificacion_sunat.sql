-- Cuándo se confirmó con SUNAT que tiene cada comprobante, y qué contestó.
--
-- Lo que el ERP anota al enviar (enviado_sunat, sunat_estado) es lo que el ERP
-- cree. La verificación le pregunta a SUNAT por su servicio de consulta, que
-- solo lee, y deja acá la respuesta. Daniel pidió poder ver el estado de cada
-- comprobante y comprobar desde ahí que llegó y fue aceptado.

ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS sunat_verificado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sunat_verificacion TEXT;

COMMENT ON COLUMN comprobantes.sunat_verificado_at IS
  'Última vez que se consultó a SUNAT (billConsultService) por este comprobante.';
COMMENT ON COLUMN comprobantes.sunat_verificacion IS
  'Lo que respondió SUNAT en esa consulta: aceptado, rechazado, baja, no_existe, error.';
