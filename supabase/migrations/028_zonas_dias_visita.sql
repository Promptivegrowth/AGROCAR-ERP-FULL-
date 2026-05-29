-- Migración 028: Redefinir Zonas — días de visita por zona
--
-- Decisión del cliente: la zona deja de ser un polígono geográfico
-- y se vuelve una agrupación lógica de clientes con un calendario de
-- visitas compartido. Los puntos físicos siguen viviendo en
-- cliente_direcciones.
--
-- Cambios:
-- - zonas.dias_visita: nuevo arreglo de días default para los
--   clientes de la zona. ('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom')
-- - clientes.dias_visita: mantener, pero ahora es OVERRIDE opcional.
--   Si null, el cliente hereda los días de su zona.
-- - zonas.centro_lat/lng/radio_km: mantenemos por compatibilidad
--   con el despacho actual, pero quedan deprecated.

ALTER TABLE zonas
  ADD COLUMN IF NOT EXISTS dias_visita TEXT[] DEFAULT '{}';

COMMENT ON COLUMN zonas.dias_visita IS
  'Días default de visita de la zona (lun/mar/mie/jue/vie/sab/dom). Heredado por los clientes que no tengan días personalizados.';

COMMENT ON COLUMN clientes.dias_visita IS
  'Días personalizados de visita del cliente. Si vacío/null, hereda los de la zona asignada.';

COMMENT ON COLUMN zonas.centro_lat IS '(deprecated) Coordenada legacy, sin uso en el modelo actual.';
COMMENT ON COLUMN zonas.centro_lng IS '(deprecated) Coordenada legacy, sin uso en el modelo actual.';
COMMENT ON COLUMN zonas.radio_km IS '(deprecated) Radio legacy, sin uso en el modelo actual.';
