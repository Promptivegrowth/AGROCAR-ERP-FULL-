-- ─────────────────────────────────────────────────────────────────────────────
-- 063: Declaraciones Juradas (comprobantes sin sustento formal)
--
-- Requerimiento Vaneza (R1):
-- "usualmente se registra eso con declaraciones juradas... un 6% no puede
--  exceder de las compras totales anuales... si estamos hablando de un 20%
--  un 30% la administración tributaria podría hacernos una observación"
--
-- Referencia normativa: Ley del Impuesto a la Renta - artículo 37 inciso j)
-- y su Reglamento. Los gastos sustentados con "documentos que no reúnen los
-- requisitos" (declaraciones juradas) tienen tope del 6% del monto acreditado
-- con comprobantes.
--
-- Diseño:
-- - Tabla declaraciones_juradas
-- - RPC porcentaje_djs_anio(anio) para calcular % usado
-- - RPC registrar_declaracion_jurada con asiento automático
-- - Vista con proyección + alertas
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabla declaraciones_juradas
CREATE TABLE IF NOT EXISTS declaraciones_juradas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT UNIQUE NOT NULL,          -- DJ-YYYYMMDD-NNN
  fecha DATE NOT NULL,
  concepto TEXT NOT NULL,               -- descripción del gasto
  monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
  tercero_id UUID REFERENCES terceros(id),
  cuenta_contable TEXT NOT NULL,        -- código de cuenta gasto
  centro_costo_id UUID REFERENCES centros_costo(id),
  metodo_pago TEXT DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo','yape','plin','transferencia','caja_chica')),
  origen_pago TEXT,                     -- referencia si vino de caja chica u otro
  origen_pago_id UUID,
  asiento_id UUID REFERENCES asientos_contables(id),
  creado_por UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notas TEXT
);

CREATE INDEX IF NOT EXISTS idx_dj_fecha ON declaraciones_juradas(fecha);
CREATE INDEX IF NOT EXISTS idx_dj_tercero ON declaraciones_juradas(tercero_id);
CREATE INDEX IF NOT EXISTS idx_dj_anio ON declaraciones_juradas(EXTRACT(YEAR FROM fecha));

COMMENT ON TABLE declaraciones_juradas IS
  'Gastos sin comprobante formal (estibadores, taxis, movilidad). Sujetos a tope del 6% anual sobre compras con comprobantes formales.';

-- ── 2. Vista: total anual de compras acreditadas con comprobantes
CREATE OR REPLACE VIEW v_compras_acreditadas_anio AS
SELECT
  EXTRACT(YEAR FROM fecha)::int AS anio,
  COALESCE(SUM(subtotal), 0) AS total_compras
FROM compras
WHERE estado <> 'anulada'
GROUP BY EXTRACT(YEAR FROM fecha);

-- ── 3. RPC: calcular % usado de declaraciones juradas del año
CREATE OR REPLACE FUNCTION porcentaje_djs_anio(p_anio INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_compras_anio NUMERIC;
  v_djs_anio NUMERIC;
  v_pct NUMERIC;
  v_estado TEXT;
BEGIN
  SELECT COALESCE(total_compras, 0) INTO v_compras_anio
  FROM v_compras_acreditadas_anio WHERE anio = p_anio;
  v_compras_anio := COALESCE(v_compras_anio, 0);

  SELECT COALESCE(SUM(monto), 0) INTO v_djs_anio
  FROM declaraciones_juradas
  WHERE EXTRACT(YEAR FROM fecha) = p_anio;

  IF v_compras_anio > 0 THEN
    v_pct := ROUND((v_djs_anio / v_compras_anio) * 100, 2);
  ELSE
    v_pct := 0;
  END IF;

  v_estado := CASE
    WHEN v_pct >= 6 THEN 'excedido'
    WHEN v_pct >= 5 THEN 'critico'
    WHEN v_pct >= 3 THEN 'alerta'
    ELSE 'ok'
  END;

  RETURN jsonb_build_object(
    'anio', p_anio,
    'compras_formales', v_compras_anio,
    'djs_total', v_djs_anio,
    'porcentaje_usado', v_pct,
    'tope_absoluto', ROUND(v_compras_anio * 0.06, 2),
    'disponible', GREATEST(ROUND(v_compras_anio * 0.06, 2) - v_djs_anio, 0),
    'estado', v_estado
  );
END;
$$;

GRANT EXECUTE ON FUNCTION porcentaje_djs_anio TO authenticated;

-- ── 4. RPC: registrar declaración jurada con asiento automático
CREATE OR REPLACE FUNCTION registrar_declaracion_jurada(
  p_fecha DATE,
  p_concepto TEXT,
  p_monto NUMERIC,
  p_cuenta_contable TEXT,
  p_tercero_id UUID DEFAULT NULL,
  p_centro_costo_id UUID DEFAULT NULL,
  p_metodo_pago TEXT DEFAULT 'efectivo',
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
  v_dj_id UUID;
  v_asiento_id UUID;
  v_numero_dj TEXT;
  v_seq INT;
  v_cta_gasto UUID;
  v_cta_pago UUID;
  v_numero_asiento TEXT;
  v_glosa TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador', 'caja') THEN
    RAISE EXCEPTION 'Sin permisos para registrar declaraciones juradas';
  END IF;

  IF p_monto <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  IF p_concepto IS NULL OR LENGTH(TRIM(p_concepto)) = 0 THEN
    RAISE EXCEPTION 'Concepto requerido';
  END IF;

  v_cta_gasto := _cuenta_id_por_codigo(p_cuenta_contable);
  IF v_cta_gasto IS NULL THEN
    RAISE EXCEPTION 'Cuenta contable % no existe', p_cuenta_contable;
  END IF;

  -- Cuenta de pago según método
  v_cta_pago := CASE p_metodo_pago
    WHEN 'efectivo' THEN _cuenta_id_por_codigo('1011')
    WHEN 'yape' THEN _cuenta_id_por_codigo('1012')
    WHEN 'plin' THEN _cuenta_id_por_codigo('1012')
    WHEN 'transferencia' THEN _cuenta_id_por_codigo('1041')
    WHEN 'caja_chica' THEN _cuenta_id_por_codigo('1011')
    ELSE _cuenta_id_por_codigo('1011')
  END;

  -- Numeración DJ-YYYYMMDD-NNN
  SELECT COUNT(*) + 1 INTO v_seq FROM declaraciones_juradas WHERE fecha = p_fecha;
  v_numero_dj := 'DJ-' || TO_CHAR(p_fecha, 'YYYYMMDD') || '-' || LPAD(v_seq::text, 3, '0');

  INSERT INTO declaraciones_juradas (
    numero, fecha, concepto, monto, tercero_id, cuenta_contable,
    centro_costo_id, metodo_pago, creado_por, notas
  ) VALUES (
    v_numero_dj, p_fecha, p_concepto, p_monto, p_tercero_id, p_cuenta_contable,
    p_centro_costo_id, p_metodo_pago, v_user, p_notas
  ) RETURNING id INTO v_dj_id;

  -- Asiento contable
  v_numero_asiento := siguiente_numero_asiento();
  v_glosa := v_numero_dj || ' · ' || p_concepto;

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado,
    referencia_tabla, referencia_id, creado_por
  ) VALUES (
    v_numero_asiento, p_fecha, v_glosa, 'declaracion_jurada', 'borrador',
    'declaraciones_juradas', v_dj_id, v_user
  ) RETURNING id INTO v_asiento_id;

  -- Debe: cuenta gasto (con tercero + CC)
  INSERT INTO asientos_partidas (
    asiento_id, cuenta_id, debe, haber, orden, tercero_id, centro_costo_id
  ) VALUES (v_asiento_id, v_cta_gasto, p_monto, 0, 1, p_tercero_id, p_centro_costo_id);
  -- Haber: cuenta de pago
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
  VALUES (v_asiento_id, v_cta_pago, 0, p_monto, 2);

  UPDATE declaraciones_juradas SET asiento_id = v_asiento_id WHERE id = v_dj_id;
  RETURN v_dj_id;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_declaracion_jurada TO authenticated;

-- ── 5. RLS
ALTER TABLE declaraciones_juradas ENABLE ROW LEVEL SECURITY;

CREATE POLICY dj_read ON declaraciones_juradas FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador', 'caja'])
);
CREATE POLICY dj_write ON declaraciones_juradas FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador', 'caja'])
);

GRANT SELECT ON v_compras_acreditadas_anio TO authenticated;
