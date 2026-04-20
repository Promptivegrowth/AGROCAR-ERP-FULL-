-- =============================================================================
-- Migración 005: conductores, mantenimientos de vehículos, multas
-- =============================================================================

CREATE TABLE IF NOT EXISTS conductores (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dni             TEXT NOT NULL UNIQUE,
  nombres         TEXT NOT NULL,
  apellido_paterno TEXT,
  apellido_materno TEXT,
  nombre_completo TEXT NOT NULL,
  telefono        TEXT,
  email           TEXT,
  licencia_numero TEXT,
  licencia_clase  TEXT,
  licencia_vencimiento DATE,
  direccion       TEXT,
  fecha_nacimiento DATE,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conductores_dni ON conductores(dni);
CREATE INDEX IF NOT EXISTS idx_conductores_activo ON conductores(activo);

-- Relación muchos-a-muchos vehículos ↔ conductores
CREATE TABLE IF NOT EXISTS vehiculos_conductores (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehiculo_id   UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  conductor_id  UUID NOT NULL REFERENCES conductores(id) ON DELETE CASCADE,
  es_principal  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehiculo_id, conductor_id)
);

CREATE INDEX IF NOT EXISTS idx_vc_vehiculo ON vehiculos_conductores(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_vc_conductor ON vehiculos_conductores(conductor_id);

-- ENUM tipos de mantenimiento
DO $$ BEGIN
  CREATE TYPE tipo_mantenimiento_vehiculo AS ENUM (
    'soat', 'revision_tecnica', 'cambio_aceite', 'cambio_filtro',
    'cambio_llantas', 'mantenimiento_general', 'reparacion', 'otro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_alerta_vehiculo AS ENUM ('pendiente', 'vigente', 'vencido', 'cumplido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS mantenimientos_vehiculo (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehiculo_id     UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  tipo            tipo_mantenimiento_vehiculo NOT NULL,
  descripcion     TEXT,
  fecha_realizado DATE,
  fecha_vencimiento DATE,
  kilometraje     INTEGER,
  monto           NUMERIC(12,2) NOT NULL DEFAULT 0,
  proveedor       TEXT,
  observaciones   TEXT,
  documento_url   TEXT,
  estado          estado_alerta_vehiculo NOT NULL DEFAULT 'pendiente',
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mant_vehiculo ON mantenimientos_vehiculo(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_mant_vencimiento ON mantenimientos_vehiculo(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_mant_estado ON mantenimientos_vehiculo(estado);

-- ENUM estado multa
DO $$ BEGIN
  CREATE TYPE estado_multa AS ENUM ('pendiente', 'pagada', 'apelada', 'anulada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS multas_vehiculo (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehiculo_id       UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  conductor_id      UUID REFERENCES conductores(id) ON DELETE SET NULL,
  codigo_infraccion TEXT,
  tipo              TEXT NOT NULL,
  fecha_emision     DATE NOT NULL,
  fecha_vencimiento DATE,
  monto             NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento         NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_pagado      NUMERIC(12,2) NOT NULL DEFAULT 0,
  lugar             TEXT,
  observaciones     TEXT,
  estado            estado_multa NOT NULL DEFAULT 'pendiente',
  comprobante_url   TEXT,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_multa_vehiculo ON multas_vehiculo(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_multa_fecha ON multas_vehiculo(fecha_emision DESC);
CREATE INDEX IF NOT EXISTS idx_multa_estado ON multas_vehiculo(estado);

-- Triggers updated_at
CREATE OR REPLACE FUNCTION tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conductores_updated ON conductores;
CREATE TRIGGER trg_conductores_updated BEFORE UPDATE ON conductores
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_mant_updated ON mantenimientos_vehiculo;
CREATE TRIGGER trg_mant_updated BEFORE UPDATE ON mantenimientos_vehiculo
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_multa_updated ON multas_vehiculo;
CREATE TRIGGER trg_multa_updated BEFORE UPDATE ON multas_vehiculo
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- RLS
ALTER TABLE conductores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiculos_conductores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mantenimientos_vehiculo  ENABLE ROW LEVEL SECURITY;
ALTER TABLE multas_vehiculo          ENABLE ROW LEVEL SECURITY;

-- Policies: admin/gerente full, otros rol lectura
DO $$ BEGIN
  CREATE POLICY "conductores_select" ON conductores FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "conductores_write_admin" ON conductores FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "vc_select" ON vehiculos_conductores FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "vc_write_admin" ON vehiculos_conductores FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "mant_select" ON mantenimientos_vehiculo FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "mant_write_admin" ON mantenimientos_vehiculo FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "multa_select" ON multas_vehiculo FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "multa_write_admin" ON multas_vehiculo FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE conductores IS 'Conductores con datos RENIEC y licencia';
COMMENT ON TABLE mantenimientos_vehiculo IS 'Historial y alertas: SOAT, revisión técnica, cambio aceite, etc.';
COMMENT ON TABLE multas_vehiculo IS 'Multas de tránsito del vehículo';
