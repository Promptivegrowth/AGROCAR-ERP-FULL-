-- Migración 029: Direcciones en zonas distintas
--
-- Permite que un cliente tenga sucursales en zonas geográficas/comerciales
-- distintas. La zona principal sigue en clientes.zona_id (visible en la
-- vista de cliente y filtros default). Cada dirección adicional puede
-- overridear con su propia zona_id.

ALTER TABLE cliente_direcciones
  ADD COLUMN IF NOT EXISTS zona_id UUID REFERENCES zonas(id) ON DELETE SET NULL;

COMMENT ON COLUMN cliente_direcciones.zona_id IS
  'Zona específica de esta dirección. Si NULL, hereda la zona del cliente principal (clientes.zona_id).';
