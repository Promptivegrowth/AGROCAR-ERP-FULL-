-- ─────────────────────────────────────────────────────────────────────────────
-- 071: Planillas Fase 1 — trabajadores, contratos, conceptos, parámetros
--
-- Requerimiento Vaneza (R1):
-- "Ingresar a los trabajadores, ingreso salida hasta reingresos...
--  los conceptos remunerativos, cada concepto está enlazado a cuentas
--  contables, también a un centro de costos... una tabla donde podamos
--  alimentar EsSalud, ONP, AFP, la UIT"
--
-- Fase 1 de 4 del módulo Planillas (HITO 13).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trabajadores
CREATE TABLE IF NOT EXISTS trabajadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,             -- TR-001
  -- Datos personales
  tipo_doc TEXT NOT NULL DEFAULT 'DNI' CHECK (tipo_doc IN ('DNI', 'CE', 'PASAPORTE')),
  numero_doc TEXT NOT NULL,
  nombres TEXT NOT NULL,
  apellido_paterno TEXT NOT NULL,
  apellido_materno TEXT,
  fecha_nacimiento DATE,
  sexo TEXT CHECK (sexo IN ('M', 'F')),
  direccion TEXT,
  telefono TEXT,
  email TEXT,
  -- Datos laborales vigentes
  cargo TEXT,
  area TEXT,                               -- texto libre: Administración, Ventas, Almacén, Reparto
  centro_costo_id UUID REFERENCES centros_costo(id),
  fecha_ingreso DATE NOT NULL,
  sueldo_base NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- Régimen pensionario
  regimen_pension TEXT NOT NULL DEFAULT 'onp' CHECK (regimen_pension IN ('onp', 'afp')),
  afp_nombre TEXT,                         -- Prima / Integra / Habitat / Profuturo
  afp_cuspp TEXT,                          -- código único AFP
  afp_tipo_comision TEXT CHECK (afp_tipo_comision IN ('flujo', 'mixta')),
  -- Otros
  tiene_hijos BOOLEAN DEFAULT FALSE,       -- asignación familiar (10% RMV)
  cuenta_bancaria TEXT,
  banco TEXT,
  -- Estado
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cesado', 'suspendido')),
  fecha_cese DATE,
  motivo_cese TEXT,
  -- Vínculo opcional con usuario del sistema (vendedores que también son trabajadores)
  profile_id UUID REFERENCES profiles(id),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  CONSTRAINT uniq_trabajador_doc UNIQUE (tipo_doc, numero_doc)
);

CREATE INDEX IF NOT EXISTS idx_trab_estado ON trabajadores(estado);

-- FK pendiente de HITO 1: asientos_partidas.trabajador_id
ALTER TABLE asientos_partidas
  DROP CONSTRAINT IF EXISTS fk_partida_trabajador;
ALTER TABLE asientos_partidas
  ADD CONSTRAINT fk_partida_trabajador FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id);

-- ── 2. Historial de contratos (ingresos, salidas, reingresos)
CREATE TABLE IF NOT EXISTS trabajadores_contratos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id UUID NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
  tipo_contrato TEXT NOT NULL DEFAULT 'plazo_indeterminado' CHECK (tipo_contrato IN (
    'plazo_indeterminado', 'necesidad_mercado', 'tiempo_parcial', 'obra_o_servicio', 'suplencia', 'otro'
  )),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,                          -- NULL = indeterminado
  sueldo NUMERIC(12, 2) NOT NULL,
  jornada_horas_semana INT DEFAULT 48,
  cargo TEXT,
  estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'terminado', 'renovado')),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contratos_trab ON trabajadores_contratos(trabajador_id);

-- ── 3. Conceptos remunerativos
CREATE TABLE IF NOT EXISTS conceptos_remunerativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'descuento', 'aporte_empleador')),
  -- Cálculo
  metodo TEXT NOT NULL DEFAULT 'manual' CHECK (metodo IN ('manual', 'porcentaje_sueldo', 'formula_sistema')),
  porcentaje NUMERIC(7, 4),                -- para porcentaje_sueldo o tasas (ej: 9 = 9%)
  -- Afectaciones (sobre qué base tributa)
  afecta_essalud BOOLEAN DEFAULT TRUE,
  afecta_pension BOOLEAN DEFAULT TRUE,     -- ONP/AFP
  afecta_renta5ta BOOLEAN DEFAULT TRUE,
  afecta_cts BOOLEAN DEFAULT TRUE,
  afecta_grati BOOLEAN DEFAULT TRUE,
  -- Contabilidad
  cuenta_contable TEXT,                    -- código PCGE (62x para gasto, 41x por pagar)
  cuenta_contrapartida TEXT,               -- 41x
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  orden INT DEFAULT 0,
  es_sistema BOOLEAN DEFAULT FALSE,        -- conceptos base que no se borran
  notas TEXT
);

-- Seed de conceptos estándar peruanos
INSERT INTO conceptos_remunerativos (codigo, nombre, tipo, metodo, porcentaje, afecta_essalud, afecta_pension, afecta_renta5ta, afecta_cts, afecta_grati, cuenta_contable, cuenta_contrapartida, orden, es_sistema) VALUES
  -- INGRESOS
  ('SUELDO',      'Sueldo básico',                    'ingreso',   'formula_sistema', NULL,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  '6211', '411', 10, TRUE),
  ('ASIG_FAM',    'Asignación familiar (10% RMV)',    'ingreso',   'formula_sistema', NULL,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  '6211', '411', 20, TRUE),
  ('HE_25',       'Horas extras 25%',                 'ingreso',   'manual',          NULL,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  '6211', '411', 30, TRUE),
  ('HE_35',       'Horas extras 35% (dom/feriado)',   'ingreso',   'manual',          NULL,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  '6211', '411', 40, TRUE),
  ('BONO',        'Bonificación extraordinaria',      'ingreso',   'manual',          NULL,  FALSE, FALSE, TRUE,  FALSE, FALSE, '622',  '411', 50, TRUE),
  ('COMISIONES',  'Comisiones de ventas',             'ingreso',   'manual',          NULL,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  '6211', '411', 60, TRUE),
  ('MOVILIDAD',   'Movilidad (no remunerativa)',      'ingreso',   'manual',          NULL,  FALSE, FALSE, FALSE, FALSE, FALSE, '622',  '411', 70, TRUE),
  -- DESCUENTOS
  ('ONP',         'ONP 13%',                          'descuento', 'formula_sistema', 13,    FALSE, FALSE, FALSE, FALSE, FALSE, NULL,  '4031', 100, TRUE),
  ('AFP_FONDO',   'AFP Aporte obligatorio 10%',       'descuento', 'formula_sistema', 10,    FALSE, FALSE, FALSE, FALSE, FALSE, NULL,  '4032', 110, TRUE),
  ('AFP_SEGURO',  'AFP Prima de seguro',              'descuento', 'formula_sistema', 1.74,  FALSE, FALSE, FALSE, FALSE, FALSE, NULL,  '4032', 120, TRUE),
  ('AFP_COMISION','AFP Comisión',                     'descuento', 'formula_sistema', 1.60,  FALSE, FALSE, FALSE, FALSE, FALSE, NULL,  '4032', 130, TRUE),
  ('RENTA_5TA',   'Renta de 5ta categoría',           'descuento', 'formula_sistema', NULL,  FALSE, FALSE, FALSE, FALSE, FALSE, NULL,  '40173', 140, TRUE),
  ('ADELANTO',    'Adelanto de sueldo',               'descuento', 'manual',          NULL,  FALSE, FALSE, FALSE, FALSE, FALSE, NULL,  '1411', 150, TRUE),
  ('PRESTAMO',    'Descuento por préstamo',           'descuento', 'manual',          NULL,  FALSE, FALSE, FALSE, FALSE, FALSE, NULL,  '1411', 160, TRUE),
  -- APORTES DEL EMPLEADOR
  ('ESSALUD',     'EsSalud 9%',                       'aporte_empleador', 'formula_sistema', 9, FALSE, FALSE, FALSE, FALSE, FALSE, '6271', '4031', 200, TRUE)
ON CONFLICT (codigo) DO NOTHING;

-- ── 4. Parámetros de planilla (con vigencia anual)
CREATE TABLE IF NOT EXISTS parametros_planilla (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio INT NOT NULL,
  clave TEXT NOT NULL,
  valor NUMERIC(12, 4) NOT NULL,
  descripcion TEXT,
  CONSTRAINT uniq_param_anio UNIQUE (anio, clave)
);

-- Valores 2026 (verificar anualmente)
INSERT INTO parametros_planilla (anio, clave, valor, descripcion) VALUES
  (2026, 'uit', 5350, 'UIT 2026 (DS aprobado dic-2025)'),
  (2026, 'rmv', 1130, 'Remuneración Mínima Vital vigente'),
  (2026, 'essalud_tasa', 9, 'Tasa EsSalud %'),
  (2026, 'onp_tasa', 13, 'Tasa ONP %'),
  (2026, 'asignacion_familiar_pct', 10, '% de la RMV por asignación familiar'),
  (2026, 'he_25_recargo', 25, 'Recargo primeras 2 horas extras %'),
  (2026, 'he_35_recargo', 35, 'Recargo horas extras adicionales/domingos %')
ON CONFLICT (anio, clave) DO NOTHING;

-- Cuentas contables de planilla que faltan en el plan
INSERT INTO cuentas_contables (codigo, nombre, naturaleza, nivel, es_movimiento, saldo_natural, clase, anexo_tipo) VALUES
  ('6211', 'Sueldos y salarios', 'GASTO', 4, TRUE, 'D', '6', 'trabajador'),
  ('4031', 'EsSalud', 'PASIVO', 4, TRUE, 'A', '4', 'ninguno'),
  ('4032', 'ONP / AFP por pagar', 'PASIVO', 4, TRUE, 'A', '4', 'ninguno'),
  ('40173', 'Renta de quinta categoría', 'PASIVO', 5, TRUE, 'A', '4', 'ninguno'),
  ('4114', 'Gratificaciones por pagar', 'PASIVO', 4, TRUE, 'A', '4', 'trabajador'),
  ('4115', 'Vacaciones por pagar', 'PASIVO', 4, TRUE, 'A', '4', 'trabajador'),
  ('4151', 'CTS por pagar', 'PASIVO', 4, TRUE, 'A', '4', 'trabajador'),
  ('6214', 'Gratificaciones', 'GASTO', 4, TRUE, 'D', '6', 'ninguno'),
  ('6215', 'Vacaciones', 'GASTO', 4, TRUE, 'D', '6', 'ninguno'),
  ('6291', 'Compensación por tiempo de servicio (CTS)', 'GASTO', 4, TRUE, 'D', '6', 'ninguno')
ON CONFLICT (codigo) DO NOTHING;

-- ── 5. RLS
ALTER TABLE trabajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE trabajadores_contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE conceptos_remunerativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_planilla ENABLE ROW LEVEL SECURITY;

CREATE POLICY trab_read ON trabajadores FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY trab_write ON trabajadores FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY contr_read ON trabajadores_contratos FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY contr_write ON trabajadores_contratos FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY concep_read ON conceptos_remunerativos FOR SELECT USING (TRUE);
CREATE POLICY concep_write ON conceptos_remunerativos FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY param_read ON parametros_planilla FOR SELECT USING (TRUE);
CREATE POLICY param_write ON parametros_planilla FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
