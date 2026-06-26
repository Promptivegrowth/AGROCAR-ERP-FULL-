-- ─────────────────────────────────────────────────────────────────────────────
-- 053: Contabilidad — Plan de Cuentas (PCGE Perú) + Asientos + Libro Diario
--
-- Daniel pidió módulo contable para revisar con su contador. Esta es la
-- base fundacional: Plan de Cuentas, tabla de asientos contables con
-- partidas (debe/haber), validación de cuadre, libro diario.
--
-- Plan Contable General Empresarial (PCGE) vigente en Perú. Seed con las
-- cuentas más usadas para una distribuidora (clase 1, 4, 6, 7, 9).
-- Daniel + contador pueden agregar más cuentas desde la UI.
--
-- Próximos commits agregarán:
-- - 054: Asientos automáticos desde ventas/compras/cobros
-- - 055: Reportes (libro mayor, balance comprobación, estado resultados)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Plan de Cuentas
CREATE TABLE IF NOT EXISTS cuentas_contables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE, -- ej '1011', '4011', '701111'
  nombre TEXT NOT NULL,
  -- Naturaleza: ACTIVO, PASIVO, PATRIMONIO, INGRESO, GASTO, COSTO
  naturaleza TEXT NOT NULL CHECK (naturaleza IN ('ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO', 'ORDEN')),
  -- Nivel: 1 (Clase 1 dígito), 2 (Grupo 2), 3 (Subgrupo 3), 4 (Cuenta 4), 5+ (Subcuenta)
  nivel INT NOT NULL,
  cuenta_padre_id UUID REFERENCES cuentas_contables(id) ON DELETE RESTRICT,
  -- ¿Es cuenta de movimiento? (true = se pueden hacer asientos directamente
  -- a ella; false = es solo agrupadora, no se postean asientos)
  es_movimiento BOOLEAN NOT NULL DEFAULT TRUE,
  -- Saldo natural esperado: D para débito, A para crédito (informativo)
  saldo_natural TEXT CHECK (saldo_natural IN ('D', 'A')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuentas_codigo ON cuentas_contables (codigo);
CREATE INDEX IF NOT EXISTS idx_cuentas_padre ON cuentas_contables (cuenta_padre_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_naturaleza ON cuentas_contables (naturaleza) WHERE activo = TRUE;

COMMENT ON TABLE cuentas_contables IS
  'Plan Contable General Empresarial (PCGE) — Perú. Estructura jerárquica de 5 dígitos: clase > grupo > subgrupo > cuenta > subcuenta. Solo cuentas con es_movimiento=true admiten asientos directos.';

-- ── Asientos contables
CREATE TABLE IF NOT EXISTS asientos_contables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT NOT NULL, -- generado: A-YYYYMM-NNNNNN
  fecha DATE NOT NULL,
  glosa TEXT NOT NULL, -- descripción libre del asiento
  -- Origen del asiento: manual, venta, compra, cobro, pago, ajuste, etc.
  origen TEXT NOT NULL DEFAULT 'manual',
  -- Referencia opcional al documento que originó el asiento
  referencia_tabla TEXT, -- 'comprobantes', 'cobros', 'compras', etc.
  referencia_id UUID,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'asentado', 'anulado')),
  -- Totales pre-calculados (validación cuadre)
  total_debe NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_haber NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notas TEXT,
  -- Audit
  creado_por UUID REFERENCES profiles(id),
  asentado_por UUID REFERENCES profiles(id),
  asentado_at TIMESTAMPTZ,
  anulado_por UUID REFERENCES profiles(id),
  anulado_at TIMESTAMPTZ,
  motivo_anulacion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_asiento_numero UNIQUE (numero)
);

CREATE INDEX IF NOT EXISTS idx_asientos_fecha ON asientos_contables (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asientos_referencia ON asientos_contables (referencia_tabla, referencia_id);
CREATE INDEX IF NOT EXISTS idx_asientos_estado ON asientos_contables (estado);

-- ── Partidas (renglones del asiento)
CREATE TABLE IF NOT EXISTS asientos_partidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id UUID NOT NULL REFERENCES asientos_contables(id) ON DELETE CASCADE,
  cuenta_id UUID NOT NULL REFERENCES cuentas_contables(id) ON DELETE RESTRICT,
  -- Una partida es Debe O Haber, nunca ambas a la vez
  debe NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  glosa_partida TEXT, -- opcional, descripción específica de esta partida
  orden INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_partida_debe_o_haber CHECK (
    (debe > 0 AND haber = 0) OR (debe = 0 AND haber > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_partidas_asiento ON asientos_partidas (asiento_id);
CREATE INDEX IF NOT EXISTS idx_partidas_cuenta ON asientos_partidas (cuenta_id);

-- ── Función: siguiente correlativo de asiento
CREATE OR REPLACE FUNCTION siguiente_numero_asiento()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_yyyymm TEXT;
  v_seq INT;
BEGIN
  v_yyyymm := TO_CHAR(now() AT TIME ZONE 'America/Lima', 'YYYYMM');
  PERFORM pg_advisory_xact_lock(hashtext('asiento_' || v_yyyymm));
  SELECT COALESCE(MAX(CAST(SPLIT_PART(numero, '-', 3) AS INT)), 0) + 1
    INTO v_seq
    FROM asientos_contables
    WHERE numero LIKE 'A-' || v_yyyymm || '-%';
  RETURN 'A-' || v_yyyymm || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;

-- ── Trigger: recalcular totales del asiento al cambiar partidas
CREATE OR REPLACE FUNCTION recalcular_totales_asiento()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_aid UUID;
BEGIN
  v_aid := COALESCE(NEW.asiento_id, OLD.asiento_id);
  UPDATE asientos_contables
  SET total_debe = COALESCE((SELECT SUM(debe) FROM asientos_partidas WHERE asiento_id = v_aid), 0),
      total_haber = COALESCE((SELECT SUM(haber) FROM asientos_partidas WHERE asiento_id = v_aid), 0)
  WHERE id = v_aid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_asiento_ins ON asientos_partidas;
CREATE TRIGGER trg_recalc_asiento_ins AFTER INSERT OR UPDATE OR DELETE ON asientos_partidas
  FOR EACH ROW EXECUTE FUNCTION recalcular_totales_asiento();

-- ── RPC: crear asiento manual atómico
CREATE OR REPLACE FUNCTION crear_asiento_manual(
  p_fecha DATE,
  p_glosa TEXT,
  p_partidas JSONB,  -- [{cuenta_id, debe, haber, glosa_partida?}]
  p_notas TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_asiento_id UUID;
  v_numero TEXT;
  v_part JSONB;
  v_total_debe NUMERIC := 0;
  v_total_haber NUMERIC := 0;
  v_orden INT := 0;
  v_cuenta_movimiento BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Solo administrador, gerente o contador pueden crear asientos';
  END IF;

  IF p_partidas IS NULL OR jsonb_array_length(p_partidas) < 2 THEN
    RAISE EXCEPTION 'El asiento debe tener al menos 2 partidas (una debe y una haber)';
  END IF;

  -- Calcular totales y validar
  FOR v_part IN SELECT * FROM jsonb_array_elements(p_partidas)
  LOOP
    v_total_debe := v_total_debe + COALESCE((v_part->>'debe')::NUMERIC, 0);
    v_total_haber := v_total_haber + COALESCE((v_part->>'haber')::NUMERIC, 0);
    -- Verificar que la cuenta sea de movimiento
    SELECT es_movimiento INTO v_cuenta_movimiento FROM cuentas_contables WHERE id = (v_part->>'cuenta_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cuenta % no existe', v_part->>'cuenta_id';
    END IF;
    IF NOT v_cuenta_movimiento THEN
      RAISE EXCEPTION 'La cuenta % es agrupadora — no se permiten asientos directos. Usa una subcuenta.', v_part->>'cuenta_id';
    END IF;
  END LOOP;

  IF ROUND(v_total_debe, 2) <> ROUND(v_total_haber, 2) THEN
    RAISE EXCEPTION 'Asiento descuadrado: Debe = %, Haber = % (diferencia = %)',
      v_total_debe, v_total_haber, v_total_debe - v_total_haber;
  END IF;

  IF v_total_debe = 0 THEN
    RAISE EXCEPTION 'El asiento no puede tener montos en 0';
  END IF;

  v_numero := siguiente_numero_asiento();

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado, notas, creado_por
  ) VALUES (
    v_numero, p_fecha, p_glosa, 'manual', 'borrador', p_notas, v_user_id
  )
  RETURNING id INTO v_asiento_id;

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_partidas)
  LOOP
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (
      asiento_id, cuenta_id, debe, haber, glosa_partida, orden
    ) VALUES (
      v_asiento_id,
      (v_part->>'cuenta_id')::UUID,
      COALESCE((v_part->>'debe')::NUMERIC, 0),
      COALESCE((v_part->>'haber')::NUMERIC, 0),
      v_part->>'glosa_partida',
      v_orden
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_asiento_id,
    'numero', v_numero,
    'total_debe', v_total_debe,
    'total_haber', v_total_haber
  );
END;
$$;

GRANT EXECUTE ON FUNCTION crear_asiento_manual TO authenticated;

-- ── RPC: asentar (commit) asiento — pasa de borrador a asentado
CREATE OR REPLACE FUNCTION asentar_asiento(p_asiento_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_asiento RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Sin permisos para asentar';
  END IF;

  SELECT * INTO v_asiento FROM asientos_contables WHERE id = p_asiento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asiento no existe'; END IF;
  IF v_asiento.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se pueden asentar asientos en borrador (estado actual: %)', v_asiento.estado;
  END IF;
  IF ROUND(v_asiento.total_debe, 2) <> ROUND(v_asiento.total_haber, 2) THEN
    RAISE EXCEPTION 'Asiento descuadrado: Debe=% Haber=%', v_asiento.total_debe, v_asiento.total_haber;
  END IF;

  UPDATE asientos_contables
    SET estado = 'asentado', asentado_por = v_user_id, asentado_at = NOW()
    WHERE id = p_asiento_id;

  RETURN jsonb_build_object('ok', TRUE, 'numero', v_asiento.numero);
END;
$$;

GRANT EXECUTE ON FUNCTION asentar_asiento TO authenticated;

-- ── RPC: anular asiento
CREATE OR REPLACE FUNCTION anular_asiento(p_asiento_id UUID, p_motivo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo admin/gerente pueden anular asientos';
  END IF;

  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Motivo de anulación requerido (mín 5 caracteres)';
  END IF;

  UPDATE asientos_contables
    SET estado = 'anulado',
        anulado_por = v_user_id,
        anulado_at = NOW(),
        motivo_anulacion = p_motivo
    WHERE id = p_asiento_id AND estado <> 'anulado';

  IF NOT FOUND THEN RAISE EXCEPTION 'Asiento no existe o ya está anulado'; END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION anular_asiento TO authenticated;

-- ── RLS
ALTER TABLE cuentas_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE asientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE asientos_partidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY cuentas_select ON cuentas_contables FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador','facturador'])
);
CREATE POLICY cuentas_write ON cuentas_contables FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);

CREATE POLICY asientos_select ON asientos_contables FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);
CREATE POLICY asientos_write ON asientos_contables FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);

CREATE POLICY partidas_select ON asientos_partidas FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);
CREATE POLICY partidas_write ON asientos_partidas FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador','gerente','contador'])
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — Plan Contable General Empresarial (PCGE) simplificado
-- Cuentas más usadas para distribuidora cárnica. El contador puede agregar más.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO cuentas_contables (codigo, nombre, naturaleza, nivel, es_movimiento, saldo_natural) VALUES
  -- CLASE 1: ACTIVO CORRIENTE
  ('1', 'ACTIVO CORRIENTE', 'ACTIVO', 1, FALSE, 'D'),
  ('10', 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', 'ACTIVO', 2, FALSE, 'D'),
  ('101', 'Caja', 'ACTIVO', 3, FALSE, 'D'),
  ('1011', 'Caja MN (Soles)', 'ACTIVO', 4, TRUE, 'D'),
  ('1012', 'Caja Yape/Plin', 'ACTIVO', 4, TRUE, 'D'),
  ('104', 'Cuentas corrientes en instituciones financieras', 'ACTIVO', 3, FALSE, 'D'),
  ('1041', 'Cuentas corrientes operativas', 'ACTIVO', 4, TRUE, 'D'),

  ('12', 'CUENTAS POR COBRAR COMERCIALES - TERCEROS', 'ACTIVO', 2, FALSE, 'D'),
  ('121', 'Facturas, boletas y otros comprobantes por cobrar', 'ACTIVO', 3, FALSE, 'D'),
  ('1212', 'Emitidas en cartera', 'ACTIVO', 4, TRUE, 'D'),

  ('20', 'MERCADERÍAS', 'ACTIVO', 2, FALSE, 'D'),
  ('201', 'Mercaderías manufacturadas', 'ACTIVO', 3, FALSE, 'D'),
  ('2011', 'Mercaderías manufacturadas - Costo', 'ACTIVO', 4, TRUE, 'D'),

  -- CLASE 4: PASIVO CORRIENTE
  ('4', 'PASIVO CORRIENTE', 'PASIVO', 1, FALSE, 'A'),
  ('40', 'TRIBUTOS, CONTRAPRESTACIONES Y APORTES POR PAGAR', 'PASIVO', 2, FALSE, 'A'),
  ('401', 'Gobierno central', 'PASIVO', 3, FALSE, 'A'),
  ('4011', 'Impuesto General a las Ventas', 'PASIVO', 4, FALSE, 'A'),
  ('40111', 'IGV - Cuenta propia', 'PASIVO', 5, TRUE, 'A'),
  ('40112', 'IGV - Crédito fiscal (compras)', 'ACTIVO', 5, TRUE, 'D'),
  ('4017', 'Impuesto a la Renta', 'PASIVO', 4, FALSE, 'A'),
  ('40171', 'Renta de Tercera Categoría', 'PASIVO', 5, TRUE, 'A'),

  ('42', 'CUENTAS POR PAGAR COMERCIALES - TERCEROS', 'PASIVO', 2, FALSE, 'A'),
  ('421', 'Facturas, boletas y otros comprobantes por pagar', 'PASIVO', 3, FALSE, 'A'),
  ('4212', 'Emitidas', 'PASIVO', 4, TRUE, 'A'),

  -- CLASE 5: PATRIMONIO
  ('5', 'PATRIMONIO', 'PATRIMONIO', 1, FALSE, 'A'),
  ('50', 'CAPITAL', 'PATRIMONIO', 2, FALSE, 'A'),
  ('501', 'Capital social', 'PATRIMONIO', 3, FALSE, 'A'),
  ('5011', 'Capital suscrito', 'PATRIMONIO', 4, TRUE, 'A'),
  ('59', 'RESULTADOS ACUMULADOS', 'PATRIMONIO', 2, FALSE, 'A'),
  ('591', 'Utilidades no distribuidas', 'PATRIMONIO', 3, TRUE, 'A'),

  -- CLASE 6: GASTOS POR NATURALEZA
  ('6', 'GASTOS POR NATURALEZA', 'GASTO', 1, FALSE, 'D'),
  ('60', 'COMPRAS', 'GASTO', 2, FALSE, 'D'),
  ('601', 'Mercaderías', 'GASTO', 3, FALSE, 'D'),
  ('6011', 'Mercaderías manufacturadas', 'GASTO', 4, TRUE, 'D'),

  ('62', 'GASTOS DE PERSONAL, DIRECTORES Y GERENTES', 'GASTO', 2, FALSE, 'D'),
  ('621', 'Remuneraciones', 'GASTO', 3, FALSE, 'D'),
  ('6211', 'Sueldos y salarios', 'GASTO', 4, TRUE, 'D'),

  ('63', 'GASTOS DE SERVICIOS PRESTADOS POR TERCEROS', 'GASTO', 2, FALSE, 'D'),
  ('631', 'Transporte, correos y gastos de viaje', 'GASTO', 3, FALSE, 'D'),
  ('6311', 'Transporte de carga', 'GASTO', 4, TRUE, 'D'),
  ('636', 'Servicios básicos', 'GASTO', 3, FALSE, 'D'),
  ('6361', 'Energía eléctrica', 'GASTO', 4, TRUE, 'D'),
  ('6363', 'Agua', 'GASTO', 4, TRUE, 'D'),
  ('6364', 'Teléfono', 'GASTO', 4, TRUE, 'D'),

  ('64', 'GASTOS POR TRIBUTOS', 'GASTO', 2, FALSE, 'D'),
  ('641', 'Gobierno central', 'GASTO', 3, FALSE, 'D'),
  ('6411', 'Impuesto a las transacciones financieras', 'GASTO', 4, TRUE, 'D'),

  ('65', 'OTROS GASTOS DE GESTIÓN', 'GASTO', 2, FALSE, 'D'),
  ('656', 'Suministros', 'GASTO', 3, FALSE, 'D'),
  ('6561', 'Suministros de oficina', 'GASTO', 4, TRUE, 'D'),
  ('659', 'Otros gastos de gestión', 'GASTO', 3, TRUE, 'D'),

  -- CLASE 7: INGRESOS
  ('7', 'INGRESOS', 'INGRESO', 1, FALSE, 'A'),
  ('70', 'VENTAS', 'INGRESO', 2, FALSE, 'A'),
  ('701', 'Mercaderías', 'INGRESO', 3, FALSE, 'A'),
  ('7011', 'Mercaderías manufacturadas', 'INGRESO', 4, FALSE, 'A'),
  ('70111', 'Terceros', 'INGRESO', 5, TRUE, 'A'),
  ('709', 'Devoluciones sobre ventas', 'INGRESO', 3, FALSE, 'D'),
  ('7091', 'Mercaderías - Devoluciones', 'INGRESO', 4, TRUE, 'D'),

  -- CLASE 9: COSTOS Y GASTOS POR FUNCIÓN (uso opcional)
  ('9', 'COSTOS Y GASTOS POR FUNCIÓN', 'COSTO', 1, FALSE, 'D'),
  ('91', 'COSTO DE VENTAS', 'COSTO', 2, TRUE, 'D'),
  ('94', 'GASTOS DE ADMINISTRACIÓN', 'COSTO', 2, TRUE, 'D'),
  ('95', 'GASTOS DE VENTAS', 'COSTO', 2, TRUE, 'D')
ON CONFLICT (codigo) DO NOTHING;

-- Asignar cuenta_padre_id usando el código
UPDATE cuentas_contables c1 SET cuenta_padre_id = c2.id
FROM cuentas_contables c2
WHERE c1.cuenta_padre_id IS NULL
  AND LENGTH(c1.codigo) > 1
  AND c2.codigo = LEFT(c1.codigo, LENGTH(c1.codigo) - 1)
  AND c2.id IS NOT NULL;
