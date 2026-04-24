-- =============================================================================
-- Migración 013: tipos de cliente CRUD, direcciones múltiples,
-- cliente-proveedor (FK limpia), toggle IGV en pedidos/compras/OC
-- =============================================================================

-- 1. Tabla tipos_cliente (reemplaza ENUM tipo_cliente)
CREATE TABLE IF NOT EXISTS tipos_cliente (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO tipos_cliente (nombre, descripcion) VALUES
  ('Consumidor Final', 'Persona natural que consume producto final'),
  ('Tienda',           'Bodega, minimarket o tienda de barrio'),
  ('Mayorista',        'Cliente que compra en grandes volúmenes para reventa'),
  ('Distribuidor',     'Cliente que distribuye en otras zonas geográficas')
ON CONFLICT (nombre) DO NOTHING;

-- Agregar FK en clientes y backfill desde ENUM actual
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_cliente_id UUID REFERENCES tipos_cliente(id) ON DELETE RESTRICT;

UPDATE clientes SET tipo_cliente_id = (
  SELECT id FROM tipos_cliente WHERE nombre = CASE clientes.tipo_cliente::text
    WHEN 'consumidor_final' THEN 'Consumidor Final'
    WHEN 'tienda'           THEN 'Tienda'
    ELSE 'Tienda'
  END
) WHERE tipo_cliente_id IS NULL;

-- Lo mismo para solicitudes_cliente
ALTER TABLE solicitudes_cliente ADD COLUMN IF NOT EXISTS tipo_cliente_id UUID REFERENCES tipos_cliente(id) ON DELETE RESTRICT;

UPDATE solicitudes_cliente SET tipo_cliente_id = (
  SELECT id FROM tipos_cliente WHERE nombre = CASE solicitudes_cliente.tipo_cliente::text
    WHEN 'consumidor_final' THEN 'Consumidor Final'
    WHEN 'tienda'           THEN 'Tienda'
    ELSE 'Tienda'
  END
) WHERE tipo_cliente_id IS NULL;

-- Ahora tipo_cliente_id obligatorio
ALTER TABLE clientes ALTER COLUMN tipo_cliente_id SET NOT NULL;

-- 2. Tabla cliente_direcciones (múltiples direcciones por cliente)
CREATE TABLE IF NOT EXISTS cliente_direcciones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id    UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL DEFAULT 'Principal',
  direccion     TEXT,
  ubigeo        TEXT,
  departamento  TEXT,
  provincia     TEXT,
  distrito      TEXT,
  latitud       DOUBLE PRECISION,
  longitud      DOUBLE PRECISION,
  es_principal  BOOLEAN NOT NULL DEFAULT FALSE,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  notas         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo una dirección principal por cliente
CREATE UNIQUE INDEX IF NOT EXISTS idx_cliente_direcciones_principal
  ON cliente_direcciones(cliente_id) WHERE es_principal = TRUE;

CREATE INDEX IF NOT EXISTS idx_cliente_direcciones_cliente ON cliente_direcciones(cliente_id);

-- Backfill: migrar clientes.direccion como dirección principal
INSERT INTO cliente_direcciones (cliente_id, nombre, direccion, ubigeo, departamento, provincia, distrito, latitud, longitud, es_principal)
SELECT id, 'Principal', direccion, ubigeo, departamento, provincia, distrito, latitud, longitud, TRUE
FROM clientes
WHERE NOT EXISTS (
  SELECT 1 FROM cliente_direcciones cd WHERE cd.cliente_id = clientes.id AND cd.es_principal = TRUE
);

-- 3. Proveedores: FK opcional a clientes (dual role)
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_cliente_unique
  ON proveedores(cliente_id) WHERE cliente_id IS NOT NULL;

-- Columnas adicionales solo relevantes al rol de proveedor
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS banco          TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cuenta_bancaria TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cci            TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS condiciones_pago TEXT;

-- 4. Toggle IGV en pedidos / compras / ordenes_compra
ALTER TABLE pedidos         ADD COLUMN IF NOT EXISTS incluir_igv BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE pedidos         ADD COLUMN IF NOT EXISTS igv         NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE compras         ADD COLUMN IF NOT EXISTS incluir_igv BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ordenes_compra  ADD COLUMN IF NOT EXISTS incluir_igv BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN pedidos.incluir_igv IS 'Si TRUE: total = subtotal × 1.18. Si FALSE: total = subtotal (sin IGV)';
COMMENT ON COLUMN compras.incluir_igv IS 'Si TRUE: total = subtotal × 1.18. Si FALSE: total = subtotal (sin IGV)';
COMMENT ON COLUMN ordenes_compra.incluir_igv IS 'Si TRUE: total = subtotal × 1.18. Si FALSE: total = subtotal (sin IGV)';

-- Backfill igv para pedidos existentes (asumir incluyen IGV calculado)
UPDATE pedidos SET igv = ROUND((total - subtotal)::numeric, 2) WHERE igv = 0 AND total > subtotal;

-- 5. RLS policies para nuevas tablas
ALTER TABLE tipos_cliente        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_direcciones  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tipos_cliente_select_all" ON tipos_cliente;
CREATE POLICY "tipos_cliente_select_all" ON tipos_cliente
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "tipos_cliente_write_admin" ON tipos_cliente;
CREATE POLICY "tipos_cliente_write_admin" ON tipos_cliente
  FOR ALL USING (has_role('gerente', 'administrador'));

DROP POLICY IF EXISTS "cliente_direcciones_select" ON cliente_direcciones;
CREATE POLICY "cliente_direcciones_select" ON cliente_direcciones
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "cliente_direcciones_write" ON cliente_direcciones;
CREATE POLICY "cliente_direcciones_write" ON cliente_direcciones
  FOR ALL USING (
    has_role('gerente', 'administrador')
    OR EXISTS (
      SELECT 1 FROM clientes c WHERE c.id = cliente_direcciones.cliente_id
      AND (has_role('vendedor') AND c.vendedor_id = auth.uid())
    )
  );

CREATE TRIGGER set_tipos_cliente_updated_at
  BEFORE UPDATE ON tipos_cliente
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_cliente_direcciones_updated_at
  BEFORE UPDATE ON cliente_direcciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
