-- Migración 007: columnas de ubigeo peruano en zonas, clientes, solicitudes_cliente y proveedores
-- Formato ubigeo: 6 dígitos (dep + prov + dist), según INEI.

ALTER TABLE zonas              ADD COLUMN IF NOT EXISTS ubigeo       TEXT;
ALTER TABLE zonas              ADD COLUMN IF NOT EXISTS departamento TEXT;
ALTER TABLE zonas              ADD COLUMN IF NOT EXISTS provincia    TEXT;
ALTER TABLE zonas              ADD COLUMN IF NOT EXISTS distrito     TEXT;

ALTER TABLE clientes           ADD COLUMN IF NOT EXISTS ubigeo       TEXT;
ALTER TABLE clientes           ADD COLUMN IF NOT EXISTS departamento TEXT;
ALTER TABLE clientes           ADD COLUMN IF NOT EXISTS provincia    TEXT;
ALTER TABLE clientes           ADD COLUMN IF NOT EXISTS distrito     TEXT;

ALTER TABLE solicitudes_cliente ADD COLUMN IF NOT EXISTS ubigeo       TEXT;
ALTER TABLE solicitudes_cliente ADD COLUMN IF NOT EXISTS departamento TEXT;
ALTER TABLE solicitudes_cliente ADD COLUMN IF NOT EXISTS provincia    TEXT;
ALTER TABLE solicitudes_cliente ADD COLUMN IF NOT EXISTS distrito     TEXT;

ALTER TABLE proveedores        ADD COLUMN IF NOT EXISTS ubigeo       TEXT;
ALTER TABLE proveedores        ADD COLUMN IF NOT EXISTS departamento TEXT;
ALTER TABLE proveedores        ADD COLUMN IF NOT EXISTS provincia    TEXT;
ALTER TABLE proveedores        ADD COLUMN IF NOT EXISTS distrito     TEXT;

CREATE INDEX IF NOT EXISTS idx_zonas_ubigeo       ON zonas(ubigeo);
CREATE INDEX IF NOT EXISTS idx_clientes_ubigeo    ON clientes(ubigeo);
CREATE INDEX IF NOT EXISTS idx_solicitudes_ubigeo ON solicitudes_cliente(ubigeo);
