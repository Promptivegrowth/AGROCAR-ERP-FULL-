-- Migración 009: metas periódicas por vendedor + liquidaciones de comisiones

-- Meta configurable por periodo (diaria / semanal / mensual)
DO $$ BEGIN
  CREATE TYPE periodo_meta AS ENUM ('diaria', 'semanal', 'mensual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS metas_vendedor (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  periodo       periodo_meta NOT NULL,
  anio          INTEGER NOT NULL,
  mes           INTEGER,  -- 1..12, obligatorio para mensual; semana/día derivan de aquí
  semana_iso    INTEGER,  -- 1..53, para semanal
  dia           DATE,     -- para diaria
  monto_meta    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas         TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT metas_vendedor_unique UNIQUE (vendedor_id, periodo, anio, mes, semana_iso, dia)
);

CREATE INDEX IF NOT EXISTS idx_metas_vendedor ON metas_vendedor(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_metas_periodo ON metas_vendedor(periodo, anio, mes);

-- Liquidación de comisiones: registro de lo que se paga a cada vendedor por periodo
DO $$ BEGIN
  CREATE TYPE estado_liquidacion AS ENUM ('pendiente', 'aprobada', 'pagada', 'anulada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS liquidaciones_comision (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  periodo_inicio    DATE NOT NULL,
  periodo_fin       DATE NOT NULL,
  total_ventas      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- suma comprobantes no anulados en periodo
  total_cobrado     NUMERIC(12,2) NOT NULL DEFAULT 0,  -- suma cobros del vendedor en periodo
  base_calculo      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- sobre qué se calculó (ventas o cobrado)
  porcentaje_aplicado NUMERIC(5,2),
  monto_fijo_aplicado NUMERIC(12,2),
  comision_calculada  NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_pagado      NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado            estado_liquidacion NOT NULL DEFAULT 'pendiente',
  fecha_aprobacion  TIMESTAMPTZ,
  fecha_pago        TIMESTAMPTZ,
  pagado_por        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  caja_movimiento_id UUID REFERENCES caja_movimientos(id) ON DELETE SET NULL,
  notas             TEXT,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liq_vendedor ON liquidaciones_comision(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_liq_estado ON liquidaciones_comision(estado);
CREATE INDEX IF NOT EXISTS idx_liq_periodo ON liquidaciones_comision(periodo_inicio, periodo_fin);

-- Triggers updated_at
DROP TRIGGER IF EXISTS trg_metas_updated ON metas_vendedor;
CREATE TRIGGER trg_metas_updated BEFORE UPDATE ON metas_vendedor
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_liq_updated ON liquidaciones_comision;
CREATE TRIGGER trg_liq_updated BEFORE UPDATE ON liquidaciones_comision
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- RLS
ALTER TABLE metas_vendedor         ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidaciones_comision ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$ BEGIN
  CREATE POLICY "metas_select" ON metas_vendedor FOR SELECT TO authenticated
    USING (
      vendedor_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador','contador'))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "metas_write_admin" ON metas_vendedor FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "liq_select" ON liquidaciones_comision FOR SELECT TO authenticated
    USING (
      vendedor_id = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador','contador'))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "liq_write_admin" ON liquidaciones_comision FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador','contador')))
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('gerente','administrador','contador')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE metas_vendedor IS 'Metas comerciales por vendedor y periodo (diaria/semanal/mensual)';
COMMENT ON TABLE liquidaciones_comision IS 'Liquidaciones de comisiones a pagar/pagadas por periodo';
