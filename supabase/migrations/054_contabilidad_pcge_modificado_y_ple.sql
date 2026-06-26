-- ─────────────────────────────────────────────────────────────────────────────
-- 054: Adecuación a normativa peruana actualizada
--
-- Aplica el PCGE Modificado vigente (Resolución CNC N° 002-2019-EF/30,
-- vigente desde 01/01/2020) + estructura para PLE (Programa de Libros
-- Electrónicos) que SUNAT exige a través de SIRE/PLE.
--
-- Cambios:
-- 1) Campos adicionales en cuentas_contables:
--    - codigo_ple: código requerido por SUNAT para reportes PLE
--    - moneda: M (multimoneda) por default; S (solo soles)
-- 2) Tabla periodos_contables: cierres mensuales (SUNAT exige cierre)
-- 3) Tabla detracciones: para servicios y bienes afectos al SPOT
-- 4) Cuentas adicionales del PCGE Modificado faltantes
-- 5) Tipo de operación SUNAT para los asientos (compatible con SIRE)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Ampliar cuentas_contables con campos PLE y normativa
ALTER TABLE cuentas_contables
  ADD COLUMN IF NOT EXISTS codigo_ple TEXT, -- formato SUNAT para PLE
  ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'M' CHECK (moneda IN ('S', 'M')), -- S=Soles, M=Multimoneda
  ADD COLUMN IF NOT EXISTS afecta_renta BOOLEAN DEFAULT FALSE, -- ¿afecta determinación de renta?
  ADD COLUMN IF NOT EXISTS clase TEXT; -- 1-9, calculado del codigo[0]

UPDATE cuentas_contables SET clase = LEFT(codigo, 1) WHERE clase IS NULL;
UPDATE cuentas_contables SET codigo_ple = codigo WHERE codigo_ple IS NULL;

COMMENT ON COLUMN cuentas_contables.codigo_ple IS
  'Código según formato PLE de SUNAT. Generalmente coincide con el código del PCGE pero puede diferir en casos puntuales.';

-- ── Períodos contables (cierre mensual requerido por SUNAT)
CREATE TABLE IF NOT EXISTS periodos_contables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio INT NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado', 'archivado')),
  -- Cuando se cierra, congela los asientos del período (no se pueden editar)
  cerrado_por UUID REFERENCES profiles(id),
  cerrado_at TIMESTAMPTZ,
  -- Datos de cierre
  total_debe NUMERIC(14, 2) DEFAULT 0,
  total_haber NUMERIC(14, 2) DEFAULT 0,
  utilidad_periodo NUMERIC(14, 2) DEFAULT 0,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_periodo_anio_mes UNIQUE (anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_periodos_estado ON periodos_contables (estado);

COMMENT ON TABLE periodos_contables IS
  'Períodos contables mensuales. SUNAT exige cierre mensual de libros. Una vez cerrado, los asientos del período no se pueden modificar — solo correcciones via asiento de ajuste.';

-- ── Detracciones SPOT (Sistema de Pago de Obligaciones Tributarias)
-- Aplica a giros como Daniel maneja: distribuidor de carnes (tasa 4%)
CREATE TABLE IF NOT EXISTS detracciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Vínculo al documento que origina (factura/comprobante)
  comprobante_id UUID REFERENCES comprobantes(id) ON DELETE SET NULL,
  -- O a una compra
  compra_id UUID REFERENCES compras(id) ON DELETE SET NULL,
  -- Datos detracción
  fecha DATE NOT NULL,
  monto_base NUMERIC(12, 2) NOT NULL, -- importe sin IGV o total según corresponda
  porcentaje NUMERIC(5, 2) NOT NULL, -- 4% carnes, 10% intermediación, etc.
  monto_detraccion NUMERIC(12, 2) NOT NULL,
  numero_constancia TEXT, -- N° constancia de detracción del Banco de la Nación
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'depositada', 'anulada')),
  fecha_deposito DATE,
  asiento_id UUID REFERENCES asientos_contables(id) ON DELETE SET NULL,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detracciones_comprobante ON detracciones (comprobante_id);
CREATE INDEX IF NOT EXISTS idx_detracciones_estado ON detracciones (estado);

COMMENT ON TABLE detracciones IS
  'Detracciones SPOT (RS 183-2004/SUNAT y modificatorias). Para giros afectos: distribución carnes 4%, intermediación 10%, etc. Cuenta corriente del Banco de la Nación.';

-- ── Tipo de operación SUNAT para asientos
-- Permite mapear cada asiento a un tipo SUNAT (necesario para SIRE/PLE)
ALTER TABLE asientos_contables
  ADD COLUMN IF NOT EXISTS tipo_operacion_sunat TEXT,
  ADD COLUMN IF NOT EXISTS periodo_id UUID REFERENCES periodos_contables(id);

COMMENT ON COLUMN asientos_contables.tipo_operacion_sunat IS
  'Código SUNAT del tipo de operación (catálogo 17). Ej: 01=Compra interna, 02=Venta interna gravada, 03=Anticipos.';

-- ── Trigger: vincular asiento al período contable correspondiente
CREATE OR REPLACE FUNCTION asiento_set_periodo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_per_id UUID;
BEGIN
  -- Buscar o crear el período del mes/año del asiento
  SELECT id INTO v_per_id FROM periodos_contables
    WHERE anio = EXTRACT(YEAR FROM NEW.fecha)::int
      AND mes = EXTRACT(MONTH FROM NEW.fecha)::int;
  IF v_per_id IS NULL THEN
    INSERT INTO periodos_contables (anio, mes, estado)
    VALUES (EXTRACT(YEAR FROM NEW.fecha)::int, EXTRACT(MONTH FROM NEW.fecha)::int, 'abierto')
    RETURNING id INTO v_per_id;
  END IF;
  NEW.periodo_id := v_per_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asiento_set_periodo ON asientos_contables;
CREATE TRIGGER trg_asiento_set_periodo BEFORE INSERT OR UPDATE OF fecha ON asientos_contables
  FOR EACH ROW EXECUTE FUNCTION asiento_set_periodo();

-- ── Bloquear modificación de asientos en períodos cerrados
CREATE OR REPLACE FUNCTION bloquear_periodo_cerrado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_estado TEXT;
BEGIN
  SELECT p.estado INTO v_estado FROM periodos_contables p WHERE p.id = COALESCE(NEW.periodo_id, OLD.periodo_id);
  IF v_estado = 'cerrado' OR v_estado = 'archivado' THEN
    RAISE EXCEPTION 'No se puede modificar asientos del período %-% (estado: %). Genera un asiento de ajuste en el período abierto.',
      (SELECT anio FROM periodos_contables WHERE id = COALESCE(NEW.periodo_id, OLD.periodo_id)),
      (SELECT mes FROM periodos_contables WHERE id = COALESCE(NEW.periodo_id, OLD.periodo_id)),
      v_estado;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_periodo_cerrado ON asientos_contables;
CREATE TRIGGER trg_bloquear_periodo_cerrado BEFORE UPDATE OR DELETE ON asientos_contables
  FOR EACH ROW EXECUTE FUNCTION bloquear_periodo_cerrado();

-- ── RPC: cerrar período contable
CREATE OR REPLACE FUNCTION cerrar_periodo_contable(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_per RECORD;
  v_debe NUMERIC;
  v_haber NUMERIC;
  v_ingresos NUMERIC := 0;
  v_gastos NUMERIC := 0;
  v_utilidad NUMERIC;
  v_borradores INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT id, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Solo admin/gerente/contador pueden cerrar períodos';
  END IF;

  SELECT * INTO v_per FROM periodos_contables WHERE anio = p_anio AND mes = p_mes;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período %-% no existe', p_anio, p_mes; END IF;
  IF v_per.estado <> 'abierto' THEN
    RAISE EXCEPTION 'Período ya está %', v_per.estado;
  END IF;

  -- No cerrar si hay asientos en borrador
  SELECT COUNT(*) INTO v_borradores FROM asientos_contables
    WHERE periodo_id = v_per.id AND estado = 'borrador';
  IF v_borradores > 0 THEN
    RAISE EXCEPTION 'No se puede cerrar: hay % asiento(s) en borrador. Asiéntalos o anúlalos primero.', v_borradores;
  END IF;

  -- Calcular totales del período (solo asientos asentados)
  SELECT COALESCE(SUM(p.debe), 0), COALESCE(SUM(p.haber), 0)
  INTO v_debe, v_haber
  FROM asientos_partidas p
  JOIN asientos_contables a ON a.id = p.asiento_id
  WHERE a.periodo_id = v_per.id AND a.estado = 'asentado';

  -- Calcular utilidad: Ingresos − Gastos
  SELECT COALESCE(SUM(p.haber - p.debe), 0) INTO v_ingresos
  FROM asientos_partidas p
  JOIN cuentas_contables c ON c.id = p.cuenta_id
  JOIN asientos_contables a ON a.id = p.asiento_id
  WHERE a.periodo_id = v_per.id AND a.estado = 'asentado' AND c.naturaleza = 'INGRESO';

  SELECT COALESCE(SUM(p.debe - p.haber), 0) INTO v_gastos
  FROM asientos_partidas p
  JOIN cuentas_contables c ON c.id = p.cuenta_id
  JOIN asientos_contables a ON a.id = p.asiento_id
  WHERE a.periodo_id = v_per.id AND a.estado = 'asentado' AND c.naturaleza IN ('GASTO', 'COSTO');

  v_utilidad := v_ingresos - v_gastos;

  UPDATE periodos_contables
    SET estado = 'cerrado',
        cerrado_por = v_user_id,
        cerrado_at = NOW(),
        total_debe = v_debe,
        total_haber = v_haber,
        utilidad_periodo = v_utilidad
    WHERE id = v_per.id;

  RETURN jsonb_build_object(
    'periodo', p_anio || '-' || LPAD(p_mes::text, 2, '0'),
    'total_debe', v_debe,
    'total_haber', v_haber,
    'ingresos', v_ingresos,
    'gastos', v_gastos,
    'utilidad', v_utilidad
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cerrar_periodo_contable TO authenticated;

-- ── RPC: reabrir período (solo admin, requiere motivo)
CREATE OR REPLACE FUNCTION reabrir_periodo_contable(p_anio INT, p_mes INT, p_motivo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
BEGIN
  SELECT id, role::text INTO v_profile FROM profiles WHERE id = auth.uid();
  IF v_profile.role <> 'administrador' THEN
    RAISE EXCEPTION 'Solo administrador puede reabrir períodos cerrados';
  END IF;
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'Motivo de reapertura requerido (mín 10 caracteres)';
  END IF;

  UPDATE periodos_contables
    SET estado = 'abierto',
        notas = COALESCE(notas, '') || E'\n[Reapertura ' || NOW()::text || '] ' || p_motivo,
        cerrado_at = NULL,
        cerrado_por = NULL
    WHERE anio = p_anio AND mes = p_mes AND estado = 'cerrado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Período no cerrado o no existe'; END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION reabrir_periodo_contable TO authenticated;

-- RLS para tablas nuevas
ALTER TABLE periodos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE detracciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY periodos_select ON periodos_contables FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);
CREATE POLICY periodos_write ON periodos_contables FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);

CREATE POLICY detracciones_select ON detracciones FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador','facturador'])
);
CREATE POLICY detracciones_write ON detracciones FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — Cuentas adicionales del PCGE Modificado 2019 que faltaban
-- (vigente desde 01-01-2020 por Resolución CNC N° 002-2019-EF/30)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO cuentas_contables (codigo, nombre, naturaleza, nivel, es_movimiento, saldo_natural, clase) VALUES
  -- Más cuentas Clase 1 (Activo)
  ('11', 'INVERSIONES FINANCIERAS', 'ACTIVO', 2, FALSE, 'D', '1'),
  ('14', 'CUENTAS POR COBRAR AL PERSONAL, A LOS ACCIONISTAS', 'ACTIVO', 2, FALSE, 'D', '1'),
  ('141', 'Personal', 'ACTIVO', 3, FALSE, 'D', '1'),
  ('1411', 'Préstamos', 'ACTIVO', 4, TRUE, 'D', '1'),
  ('1412', 'Adelantos', 'ACTIVO', 4, TRUE, 'D', '1'),
  ('16', 'CUENTAS POR COBRAR DIVERSAS - TERCEROS', 'ACTIVO', 2, FALSE, 'D', '1'),
  ('161', 'Préstamos', 'ACTIVO', 3, TRUE, 'D', '1'),
  ('168', 'Otras cuentas por cobrar diversas', 'ACTIVO', 3, TRUE, 'D', '1'),
  ('18', 'SERVICIOS Y OTROS CONTRATADOS POR ANTICIPADO', 'ACTIVO', 2, FALSE, 'D', '1'),
  ('181', 'Costos financieros', 'ACTIVO', 3, TRUE, 'D', '1'),

  -- Clase 2 (Activo realizable)
  ('2', 'ACTIVO REALIZABLE', 'ACTIVO', 1, FALSE, 'D', '2'),
  ('21', 'PRODUCTOS TERMINADOS', 'ACTIVO', 2, FALSE, 'D', '2'),
  ('211', 'Productos manufacturados', 'ACTIVO', 3, TRUE, 'D', '2'),
  ('24', 'MATERIAS PRIMAS', 'ACTIVO', 2, FALSE, 'D', '2'),
  ('241', 'Materias primas para productos manufacturados', 'ACTIVO', 3, TRUE, 'D', '2'),
  ('25', 'MATERIALES AUXILIARES, SUMINISTROS Y REPUESTOS', 'ACTIVO', 2, FALSE, 'D', '2'),
  ('251', 'Materiales auxiliares', 'ACTIVO', 3, TRUE, 'D', '2'),
  ('252', 'Suministros', 'ACTIVO', 3, TRUE, 'D', '2'),

  -- Clase 3 (Activo inmovilizado)
  ('3', 'ACTIVO INMOVILIZADO', 'ACTIVO', 1, FALSE, 'D', '3'),
  ('33', 'INMUEBLES, MAQUINARIA Y EQUIPO', 'ACTIVO', 2, FALSE, 'D', '3'),
  ('334', 'Unidades de transporte', 'ACTIVO', 3, TRUE, 'D', '3'),
  ('335', 'Muebles y enseres', 'ACTIVO', 3, TRUE, 'D', '3'),
  ('336', 'Equipos diversos', 'ACTIVO', 3, FALSE, 'D', '3'),
  ('3361', 'Equipos para procesamiento de información (cómputo)', 'ACTIVO', 4, TRUE, 'D', '3'),
  ('39', 'DEPRECIACIÓN, AMORTIZACIÓN Y AGOTAMIENTO ACUMULADOS', 'ACTIVO', 2, FALSE, 'A', '3'),
  ('391', 'Depreciación acumulada', 'ACTIVO', 3, TRUE, 'A', '3'),

  -- Más cuentas Clase 4 (Pasivo)
  ('41', 'REMUNERACIONES Y PARTICIPACIONES POR PAGAR', 'PASIVO', 2, FALSE, 'A', '4'),
  ('411', 'Remuneraciones por pagar', 'PASIVO', 3, TRUE, 'A', '4'),
  ('413', 'Participaciones de los trabajadores por pagar', 'PASIVO', 3, TRUE, 'A', '4'),
  ('45', 'OBLIGACIONES FINANCIERAS', 'PASIVO', 2, FALSE, 'A', '4'),
  ('451', 'Préstamos de instituciones financieras y otras', 'PASIVO', 3, TRUE, 'A', '4'),
  ('46', 'CUENTAS POR PAGAR DIVERSAS - TERCEROS', 'PASIVO', 2, FALSE, 'A', '4'),
  ('469', 'Otras cuentas por pagar diversas', 'PASIVO', 3, TRUE, 'A', '4'),

  -- Subcuentas IGV detalladas (importante para PLE)
  ('40113', 'IGV - Régimen de retenciones', 'PASIVO', 5, TRUE, 'A', '4'),
  ('40114', 'IGV - Régimen de percepciones', 'PASIVO', 5, TRUE, 'A', '4'),

  -- Detracciones (SPOT)
  ('40115', 'IGV - Detracciones cuenta del Banco de la Nación', 'ACTIVO', 5, TRUE, 'D', '4'),

  -- Más cuentas Clase 6
  ('60', 'COMPRAS', 'GASTO', 2, FALSE, 'D', '6'),
  ('602', 'Materias primas', 'GASTO', 3, FALSE, 'D', '6'),
  ('6021', 'Materias primas para productos manufacturados', 'GASTO', 4, TRUE, 'D', '6'),
  ('603', 'Materiales auxiliares, suministros y repuestos', 'GASTO', 3, TRUE, 'D', '6'),
  ('61', 'VARIACIÓN DE EXISTENCIAS', 'GASTO', 2, FALSE, 'A', '6'),
  ('611', 'Mercaderías', 'GASTO', 3, TRUE, 'A', '6'),

  ('622', 'Otras remuneraciones', 'GASTO', 3, TRUE, 'D', '6'),
  ('627', 'Seguridad, previsión social y otras contribuciones', 'GASTO', 3, FALSE, 'D', '6'),
  ('6271', 'Régimen de prestaciones de salud (EsSalud)', 'GASTO', 4, TRUE, 'D', '6'),
  ('6273', 'AFP', 'GASTO', 4, TRUE, 'D', '6'),

  ('632', 'Asesoría y consultoría', 'GASTO', 3, TRUE, 'D', '6'),
  ('633', 'Producción encargada a terceros', 'GASTO', 3, TRUE, 'D', '6'),
  ('634', 'Mantenimiento y reparaciones', 'GASTO', 3, TRUE, 'D', '6'),
  ('635', 'Alquileres', 'GASTO', 3, TRUE, 'D', '6'),
  ('637', 'Publicidad, publicaciones, relaciones públicas', 'GASTO', 3, TRUE, 'D', '6'),
  ('638', 'Servicios de contratistas', 'GASTO', 3, TRUE, 'D', '6'),
  ('639', 'Otros servicios prestados por terceros', 'GASTO', 3, TRUE, 'D', '6'),

  ('643', 'Gobierno regional', 'GASTO', 3, TRUE, 'D', '6'),
  ('644', 'Otros gastos por tributos', 'GASTO', 3, TRUE, 'D', '6'),

  ('651', 'Seguros', 'GASTO', 3, TRUE, 'D', '6'),
  ('652', 'Regalías', 'GASTO', 3, TRUE, 'D', '6'),
  ('655', 'Costo neto de enajenación de activos inmovilizados', 'GASTO', 3, TRUE, 'D', '6'),

  -- Cuenta 67: Gastos financieros
  ('67', 'GASTOS FINANCIEROS', 'GASTO', 2, FALSE, 'D', '6'),
  ('671', 'Gastos en operaciones de endeudamiento y otros', 'GASTO', 3, FALSE, 'D', '6'),
  ('6711', 'Intereses por préstamos', 'GASTO', 4, TRUE, 'D', '6'),
  ('673', 'Intereses por préstamos y otras obligaciones', 'GASTO', 3, TRUE, 'D', '6'),
  ('676', 'Pérdida por medición de activos no financieros al valor razonable', 'GASTO', 3, TRUE, 'D', '6'),
  ('678', 'Participación en resultados de subsidiarias y asociadas bajo el método del valor patrimonial', 'GASTO', 3, TRUE, 'D', '6'),

  -- Cuenta 68: Valuación y deterioro
  ('68', 'VALUACIÓN Y DETERIORO DE ACTIVOS Y PROVISIONES', 'GASTO', 2, FALSE, 'D', '6'),
  ('681', 'Depreciación', 'GASTO', 3, FALSE, 'D', '6'),
  ('6814', 'Depreciación de inmuebles, maquinaria y equipo - Costo', 'GASTO', 4, TRUE, 'D', '6'),

  -- Más cuentas Clase 7
  ('702', 'Productos terminados', 'INGRESO', 3, FALSE, 'A', '7'),
  ('7021', 'Productos manufacturados', 'INGRESO', 4, TRUE, 'A', '7'),

  ('75', 'OTROS INGRESOS DE GESTIÓN', 'INGRESO', 2, FALSE, 'A', '7'),
  ('756', 'Enajenación de activos inmovilizados', 'INGRESO', 3, TRUE, 'A', '7'),
  ('759', 'Otros ingresos de gestión', 'INGRESO', 3, TRUE, 'A', '7'),

  ('77', 'INGRESOS FINANCIEROS', 'INGRESO', 2, FALSE, 'A', '7'),
  ('772', 'Rendimientos ganados', 'INGRESO', 3, FALSE, 'A', '7'),
  ('7721', 'Depósitos en instituciones financieras', 'INGRESO', 4, TRUE, 'A', '7'),

  -- Cuenta 79: Cargas imputables a cuenta de costos
  ('79', 'CARGAS IMPUTABLES A CUENTA DE COSTOS Y GASTOS', 'GASTO', 2, FALSE, 'A', '7'),
  ('791', 'Cargas imputables a cuenta de costos y gastos', 'GASTO', 3, TRUE, 'A', '7'),

  -- Más cuentas Clase 9
  ('92', 'COSTO DE PRODUCCIÓN', 'COSTO', 2, TRUE, 'D', '9'),
  ('93', 'GASTOS POR FUNCIÓN', 'COSTO', 2, FALSE, 'D', '9'),
  ('96', 'GASTOS DE INVESTIGACIÓN Y DESARROLLO', 'COSTO', 2, TRUE, 'D', '9'),
  ('97', 'GASTOS FINANCIEROS', 'COSTO', 2, TRUE, 'D', '9')
ON CONFLICT (codigo) DO NOTHING;

-- Re-asignar cuenta_padre por jerarquía de códigos
UPDATE cuentas_contables c1 SET cuenta_padre_id = c2.id
FROM cuentas_contables c2
WHERE c1.cuenta_padre_id IS NULL
  AND LENGTH(c1.codigo) > 1
  AND c2.codigo = LEFT(c1.codigo, LENGTH(c1.codigo) - 1)
  AND c1.id <> c2.id;

-- Actualizar clase para todas las cuentas
UPDATE cuentas_contables SET clase = LEFT(codigo, 1) WHERE clase IS NULL OR clase = '';

-- Crear período del mes actual (necesario para que los asientos puedan vincularse)
INSERT INTO periodos_contables (anio, mes, estado)
VALUES (
  EXTRACT(YEAR FROM CURRENT_DATE)::int,
  EXTRACT(MONTH FROM CURRENT_DATE)::int,
  'abierto'
)
ON CONFLICT (anio, mes) DO NOTHING;
