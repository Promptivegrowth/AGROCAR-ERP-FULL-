-- =============================================================================
-- Migración: solicitudes_cliente
-- Los vendedores crean solicitudes desde la PWA; los admin/gerentes las aprueban
-- =============================================================================

CREATE TABLE IF NOT EXISTS solicitudes_cliente (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  razon_social   TEXT NOT NULL,
  ruc            TEXT,
  dni            TEXT,
  tipo_cliente   tipo_cliente NOT NULL DEFAULT 'tienda',
  direccion      TEXT,
  telefono       TEXT,
  email          TEXT,
  contacto       TEXT,
  zona_id        UUID REFERENCES zonas(id) ON DELETE SET NULL,
  latitud        DOUBLE PRECISION,
  longitud       DOUBLE PRECISION,
  notas          TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','aprobada','rechazada')),
  razon_rechazo  TEXT,
  cliente_id     UUID REFERENCES clientes(id) ON DELETE SET NULL,
  reviewed_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_cliente_estado   ON solicitudes_cliente(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_cliente_vendedor ON solicitudes_cliente(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_cliente_created  ON solicitudes_cliente(created_at DESC);

ALTER TABLE solicitudes_cliente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solicitudes_insert_vendedor" ON solicitudes_cliente;
CREATE POLICY "solicitudes_insert_vendedor" ON solicitudes_cliente
  FOR INSERT TO authenticated
  WITH CHECK (vendedor_id = auth.uid());

DROP POLICY IF EXISTS "solicitudes_select_own_or_admin" ON solicitudes_cliente;
CREATE POLICY "solicitudes_select_own_or_admin" ON solicitudes_cliente
  FOR SELECT TO authenticated
  USING (
    vendedor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('gerente','administrador')
    )
  );

DROP POLICY IF EXISTS "solicitudes_update_admin" ON solicitudes_cliente;
CREATE POLICY "solicitudes_update_admin" ON solicitudes_cliente
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('gerente','administrador')
    )
  );

CREATE OR REPLACE FUNCTION set_solicitudes_cliente_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_solicitudes_cliente_updated_at ON solicitudes_cliente;
CREATE TRIGGER trg_solicitudes_cliente_updated_at
  BEFORE UPDATE ON solicitudes_cliente
  FOR EACH ROW EXECUTE FUNCTION set_solicitudes_cliente_updated_at();

COMMENT ON TABLE solicitudes_cliente IS 'Solicitudes de registro de nuevos clientes enviadas por vendedores desde la PWA';
