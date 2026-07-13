-- ─────────────────────────────────────────────────────────────────────────────
-- 062: Módulo Caja Chica separado
--
-- Requerimiento Vaneza (R1):
-- "las compras todo lo que son compras aparte que no tenga que ver con este,
--  como es la Caja Chica"
-- "va a haber una persona encargada de hacer justamente los asientos de Caja
--  Chica no. Para que pueda gestionarlo de manera separada aparte de la
--  revisión de las demás compras grandes"
-- Daniel confirmó: rol 'caja' opera la Caja Chica.
--
-- Diseño:
-- - Tabla caja_chica_sesiones: sesiones de fondo fijo
-- - Tabla caja_chica_movimientos: gastos individuales + reposiciones
-- - Categorías predefinidas para agilidad + cuenta contable por categoría
-- - RPC genera asiento contable automáticamente
-- - Origen 'caja_chica' en asientos para filtrado
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabla de sesiones (fondo fijo actual)
CREATE TABLE IF NOT EXISTS caja_chica_sesiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT UNIQUE NOT NULL,          -- CC-YYYYMMDD-NNN
  fecha_apertura DATE NOT NULL,
  fecha_cierre DATE,
  responsable_id UUID REFERENCES profiles(id),
  fondo_inicial NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_gastos NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_reposiciones NUMERIC(12, 2) NOT NULL DEFAULT 0,
  saldo_actual NUMERIC(12, 2) GENERATED ALWAYS AS
    (fondo_inicial - total_gastos + total_reposiciones) STORED,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cerrada_at TIMESTAMPTZ,
  cerrada_por UUID REFERENCES profiles(id),
  arqueo_final NUMERIC(12, 2),          -- efectivo contado al cierre
  arqueo_diferencia NUMERIC(12, 2)      -- arqueo - saldo_actual
);

CREATE INDEX IF NOT EXISTS idx_cc_sesion_estado ON caja_chica_sesiones(estado);
CREATE INDEX IF NOT EXISTS idx_cc_sesion_fecha ON caja_chica_sesiones(fecha_apertura);

-- ── 2. Categorías de gastos de caja chica (configurables)
CREATE TABLE IF NOT EXISTS caja_chica_categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  cuenta_contable TEXT NOT NULL,        -- código de cuenta destino (ej 639, 634)
  requiere_tercero BOOLEAN NOT NULL DEFAULT FALSE, -- si sí, se debe indicar tercero
  requiere_recibo BOOLEAN NOT NULL DEFAULT TRUE,   -- si sí, se pide URL o notas
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  orden INT DEFAULT 0
);

-- Seed inicial (según casos típicos de AGROCAR)
INSERT INTO caja_chica_categorias (codigo, nombre, cuenta_contable, requiere_tercero, orden) VALUES
  ('MOVILIDAD', 'Movilidad (taxis, mototaxis)',     '6314', TRUE,  10),
  ('ESTIBA',    'Estiba y descarga',                '6321', TRUE,  20),
  ('COMBUSTIBLE','Combustible',                     '6591', FALSE, 30),
  ('SUMINISTROS','Suministros y útiles oficina',    '6035', FALSE, 40),
  ('LIMPIEZA',  'Limpieza y aseo',                  '6351', FALSE, 50),
  ('MANTENIMIENTO','Mantenimiento menor',           '6341', FALSE, 60),
  ('REFRIGERIO','Refrigerios / alimentación',       '6350', FALSE, 70),
  ('SERVICIOS', 'Servicios varios (fotocopias etc)','6394', FALSE, 80),
  ('OTROS',     'Otros gastos menudos',             '6591', FALSE, 90)
ON CONFLICT (codigo) DO NOTHING;

-- ── 3. Movimientos de caja chica
CREATE TABLE IF NOT EXISTS caja_chica_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id UUID NOT NULL REFERENCES caja_chica_sesiones(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('gasto', 'reposicion')),
  fecha DATE NOT NULL,
  hora TIME DEFAULT CURRENT_TIME,
  concepto TEXT NOT NULL,
  monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
  categoria_id UUID REFERENCES caja_chica_categorias(id),
  tercero_id UUID REFERENCES terceros(id),
  numero_recibo TEXT,
  url_recibo TEXT,                      -- foto del recibo (opcional)
  centro_costo_id UUID REFERENCES centros_costo(id),
  asiento_id UUID REFERENCES asientos_contables(id),  -- asiento generado
  creado_por UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notas TEXT
);

CREATE INDEX IF NOT EXISTS idx_ccm_sesion ON caja_chica_movimientos(sesion_id);
CREATE INDEX IF NOT EXISTS idx_ccm_fecha ON caja_chica_movimientos(fecha);
CREATE INDEX IF NOT EXISTS idx_ccm_tipo ON caja_chica_movimientos(tipo);
CREATE INDEX IF NOT EXISTS idx_ccm_categoria ON caja_chica_movimientos(categoria_id);

-- ── 4. Trigger para mantener totales de la sesión al día
CREATE OR REPLACE FUNCTION recalcular_sesion_caja_chica()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sid UUID;
BEGIN
  v_sid := COALESCE(NEW.sesion_id, OLD.sesion_id);
  UPDATE caja_chica_sesiones
  SET total_gastos = COALESCE(
        (SELECT SUM(monto) FROM caja_chica_movimientos
         WHERE sesion_id = v_sid AND tipo = 'gasto'), 0),
      total_reposiciones = COALESCE(
        (SELECT SUM(monto) FROM caja_chica_movimientos
         WHERE sesion_id = v_sid AND tipo = 'reposicion'), 0)
  WHERE id = v_sid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_sesion_cc ON caja_chica_movimientos;
CREATE TRIGGER trg_recalc_sesion_cc AFTER INSERT OR UPDATE OR DELETE ON caja_chica_movimientos
  FOR EACH ROW EXECUTE FUNCTION recalcular_sesion_caja_chica();

-- ── 5. RPC para abrir sesión de caja chica
CREATE OR REPLACE FUNCTION abrir_caja_chica(p_fondo NUMERIC, p_notas TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_hoy DATE := CURRENT_DATE;
  v_existente UUID;
  v_numero TEXT;
  v_seq INT;
  v_sesion_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador', 'caja') THEN
    RAISE EXCEPTION 'Solo administrador/gerente/contador/caja pueden abrir Caja Chica';
  END IF;

  -- Solo una sesión abierta a la vez
  SELECT id INTO v_existente FROM caja_chica_sesiones WHERE estado = 'abierta' LIMIT 1;
  IF v_existente IS NOT NULL THEN
    RAISE EXCEPTION 'Ya hay una sesión de Caja Chica abierta';
  END IF;

  IF p_fondo IS NULL OR p_fondo < 0 THEN
    RAISE EXCEPTION 'Fondo inicial inválido';
  END IF;

  -- Generar número: CC-YYYYMMDD-NNN
  SELECT COUNT(*) + 1 INTO v_seq FROM caja_chica_sesiones WHERE fecha_apertura = v_hoy;
  v_numero := 'CC-' || TO_CHAR(v_hoy, 'YYYYMMDD') || '-' || LPAD(v_seq::text, 3, '0');

  INSERT INTO caja_chica_sesiones (numero, fecha_apertura, responsable_id, fondo_inicial, notas)
  VALUES (v_numero, v_hoy, v_user, p_fondo, p_notas)
  RETURNING id INTO v_sesion_id;

  RETURN v_sesion_id;
END;
$$;

GRANT EXECUTE ON FUNCTION abrir_caja_chica TO authenticated;

-- ── 6. RPC para registrar movimiento (gasto o reposición) con asiento automático
CREATE OR REPLACE FUNCTION registrar_movimiento_caja_chica(
  p_tipo TEXT,                        -- 'gasto' o 'reposicion'
  p_concepto TEXT,
  p_monto NUMERIC,
  p_categoria_id UUID DEFAULT NULL,
  p_tercero_id UUID DEFAULT NULL,
  p_numero_recibo TEXT DEFAULT NULL,
  p_url_recibo TEXT DEFAULT NULL,
  p_centro_costo_id UUID DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_sesion RECORD;
  v_categoria RECORD;
  v_mov_id UUID;
  v_asiento_id UUID;
  v_numero_asiento TEXT;
  v_cta_gasto UUID;
  v_cta_caja UUID;
  v_glosa TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador', 'caja') THEN
    RAISE EXCEPTION 'Sin permisos para operar Caja Chica';
  END IF;

  IF p_tipo NOT IN ('gasto', 'reposicion') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo;
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  -- Sesión abierta actual
  SELECT * INTO v_sesion FROM caja_chica_sesiones WHERE estado = 'abierta' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay sesión de Caja Chica abierta'; END IF;

  -- Para gasto: valida que hay fondo suficiente
  IF p_tipo = 'gasto' AND v_sesion.saldo_actual < p_monto THEN
    RAISE EXCEPTION 'Fondo insuficiente. Saldo actual: %, Monto: %', v_sesion.saldo_actual, p_monto;
  END IF;

  -- Insertar movimiento (sin asiento aún)
  INSERT INTO caja_chica_movimientos (
    sesion_id, tipo, fecha, concepto, monto, categoria_id, tercero_id,
    numero_recibo, url_recibo, centro_costo_id, creado_por, notas
  ) VALUES (
    v_sesion.id, p_tipo, CURRENT_DATE, p_concepto, p_monto, p_categoria_id, p_tercero_id,
    p_numero_recibo, p_url_recibo, p_centro_costo_id, v_user, p_notas
  ) RETURNING id INTO v_mov_id;

  -- Generar asiento automático
  IF p_tipo = 'gasto' THEN
    -- Obtener cuenta según categoría (o cuenta genérica de gasto menor)
    IF p_categoria_id IS NOT NULL THEN
      SELECT * INTO v_categoria FROM caja_chica_categorias WHERE id = p_categoria_id;
      v_cta_gasto := _cuenta_id_por_codigo(v_categoria.cuenta_contable);
    END IF;
    IF v_cta_gasto IS NULL THEN
      v_cta_gasto := _cuenta_id_por_codigo('6591'); -- Otros gastos
    END IF;
    v_cta_caja := _cuenta_id_por_codigo('1011');

    v_numero_asiento := siguiente_numero_asiento();
    v_glosa := 'CC-' || v_sesion.numero || ' · ' || p_concepto;

    INSERT INTO asientos_contables (
      numero, fecha, glosa, origen, estado,
      referencia_tabla, referencia_id, creado_por
    ) VALUES (
      v_numero_asiento, CURRENT_DATE, v_glosa, 'caja_chica', 'borrador',
      'caja_chica_movimientos', v_mov_id, v_user
    ) RETURNING id INTO v_asiento_id;

    -- Debe: cuenta de gasto (con tercero si categoría lo requiere)
    INSERT INTO asientos_partidas (
      asiento_id, cuenta_id, debe, haber, orden, tercero_id, centro_costo_id
    ) VALUES (
      v_asiento_id, v_cta_gasto, p_monto, 0, 1, p_tercero_id, p_centro_costo_id
    );
    -- Haber: caja
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_caja, 0, p_monto, 2);
  ELSE
    -- Reposición: Debe Caja MN, Haber Bancos (asumiendo retiro banco→caja)
    v_cta_caja := _cuenta_id_por_codigo('1011');
    v_numero_asiento := siguiente_numero_asiento();
    v_glosa := 'CC-' || v_sesion.numero || ' · Reposición: ' || p_concepto;
    INSERT INTO asientos_contables (numero, fecha, glosa, origen, estado, referencia_tabla, referencia_id, creado_por)
    VALUES (v_numero_asiento, CURRENT_DATE, v_glosa, 'caja_chica', 'borrador', 'caja_chica_movimientos', v_mov_id, v_user)
    RETURNING id INTO v_asiento_id;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_caja, p_monto, 0, 1);
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, _cuenta_id_por_codigo('1041'), 0, p_monto, 2);
  END IF;

  UPDATE caja_chica_movimientos SET asiento_id = v_asiento_id WHERE id = v_mov_id;
  RETURN v_mov_id;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_movimiento_caja_chica TO authenticated;

-- ── 7. RPC para cerrar sesión con arqueo
CREATE OR REPLACE FUNCTION cerrar_caja_chica(p_sesion_id UUID, p_arqueo_efectivo NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_sesion RECORD;
  v_diferencia NUMERIC;
BEGIN
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador', 'caja') THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  SELECT * INTO v_sesion FROM caja_chica_sesiones WHERE id = p_sesion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no existe'; END IF;
  IF v_sesion.estado <> 'abierta' THEN RAISE EXCEPTION 'Sesión ya está cerrada'; END IF;

  v_diferencia := p_arqueo_efectivo - v_sesion.saldo_actual;

  UPDATE caja_chica_sesiones
  SET estado = 'cerrada',
      fecha_cierre = CURRENT_DATE,
      cerrada_at = NOW(),
      cerrada_por = v_user,
      arqueo_final = p_arqueo_efectivo,
      arqueo_diferencia = v_diferencia
  WHERE id = p_sesion_id;

  RETURN jsonb_build_object(
    'sesion_numero', v_sesion.numero,
    'saldo_sistema', v_sesion.saldo_actual,
    'arqueo', p_arqueo_efectivo,
    'diferencia', v_diferencia,
    'cuadra', ABS(v_diferencia) < 0.01
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cerrar_caja_chica TO authenticated;

-- ── 8. RLS
ALTER TABLE caja_chica_sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_chica_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_chica_movimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY cc_ses_read ON caja_chica_sesiones FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador', 'caja'])
);
CREATE POLICY cc_ses_write ON caja_chica_sesiones FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador', 'caja'])
);

CREATE POLICY cc_cat_read ON caja_chica_categorias FOR SELECT USING (TRUE);
CREATE POLICY cc_cat_write ON caja_chica_categorias FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);

CREATE POLICY cc_mov_read ON caja_chica_movimientos FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador', 'caja'])
);
CREATE POLICY cc_mov_write ON caja_chica_movimientos FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador', 'caja'])
);
