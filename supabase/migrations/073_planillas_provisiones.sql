-- ─────────────────────────────────────────────────────────────────────────────
-- 073: Planillas Fase 3 — provisiones CTS/gratificación/vacaciones + goce
--
-- Requerimiento Vaneza (R1):
-- "en todo lo que es personal se ven las vacaciones, la gratificación,
--  la CTS, liquidaciones... cada mes se devengan ya sean vacaciones,
--  CTS o gratificaciones para poder tener una contabilidad al día"
--
-- Norma peruana (régimen general D.L. 728):
-- - Vacaciones: 30 días por año → provisión mensual = rem. computable / 12
-- - Gratificación: 2 sueldos/año (jul + dic) → provisión = rem. / 6 por mes
--   + bonificación extraordinaria 9% (Ley 30334, EsSalud que no se paga)
-- - CTS: 1 sueldo + 1/6 grati por año → depósitos may/nov
--   provisión mensual = (rem. + 1/6 grati) / 12
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Provisiones mensuales de beneficios
CREATE TABLE IF NOT EXISTS provisiones_beneficios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  trabajador_id UUID NOT NULL REFERENCES trabajadores(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('vacaciones', 'gratificacion', 'cts')),
  base_computable NUMERIC(12, 2) NOT NULL,
  monto NUMERIC(12, 2) NOT NULL,
  asiento_id UUID REFERENCES asientos_contables(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_provision UNIQUE (anio, mes, trabajador_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_prov_periodo ON provisiones_beneficios(anio, mes);

-- ── 2. Registro de vacaciones (programación y goce)
CREATE TABLE IF NOT EXISTS vacaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id UUID NOT NULL REFERENCES trabajadores(id),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  dias INT NOT NULL CHECK (dias > 0),
  periodo_computable TEXT,               -- ej: "2025-2026"
  estado TEXT NOT NULL DEFAULT 'programada' CHECK (estado IN ('programada', 'gozada', 'cancelada')),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  CONSTRAINT chk_vac_fechas CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_vac_trab ON vacaciones(trabajador_id);

-- ── 3. RPC: generar provisiones del mes (asiento consolidado)
CREATE OR REPLACE FUNCTION generar_provisiones_mes(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_trab RECORD;
  v_fecha DATE;
  v_asiento_id UUID;
  v_numero TEXT;
  v_rmv NUMERIC;
  v_base NUMERIC;
  v_asig_fam NUMERIC;
  v_prov_vac NUMERIC;
  v_prov_grati NUMERIC;
  v_prov_cts NUMERIC;
  v_total_vac NUMERIC := 0;
  v_total_grati NUMERIC := 0;
  v_total_cts NUMERIC := 0;
  v_count INT := 0;
  v_orden INT := 0;
  v_cta UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  v_fecha := (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date;
  SELECT valor INTO v_rmv FROM parametros_planilla WHERE anio = p_anio AND clave = 'rmv';
  IF v_rmv IS NULL THEN
    RAISE EXCEPTION 'Falta RMV del año % en parámetros de planilla', p_anio;
  END IF;

  -- Asiento cabecera
  v_numero := siguiente_numero_asiento();
  INSERT INTO asientos_contables (numero, fecha, glosa, origen, estado, creado_por)
  VALUES (v_numero, v_fecha,
          'Provisión beneficios sociales ' || LPAD(p_mes::text, 2, '0') || '-' || p_anio,
          'provision_beneficios', 'borrador', v_user)
  RETURNING id INTO v_asiento_id;

  FOR v_trab IN
    SELECT * FROM trabajadores
    WHERE estado = 'activo'
      AND fecha_ingreso <= v_fecha
      AND NOT EXISTS (
        SELECT 1 FROM provisiones_beneficios pb
        WHERE pb.trabajador_id = trabajadores.id AND pb.anio = p_anio AND pb.mes = p_mes
      )
  LOOP
    -- Remuneración computable = sueldo + asignación familiar
    v_asig_fam := CASE WHEN v_trab.tiene_hijos THEN ROUND(v_rmv * 0.10, 2) ELSE 0 END;
    v_base := v_trab.sueldo_base + v_asig_fam;

    -- Provisión vacaciones: base / 12
    v_prov_vac := ROUND(v_base / 12.0, 2);
    -- Provisión gratificación: base / 6 (una grati por semestre) × ajuste mensual
    -- Método simple: 2 sueldos / 12 meses = base / 6
    v_prov_grati := ROUND(v_base / 6.0, 2);
    -- Provisión CTS: (base + 1/6 de grati) / 12
    v_prov_cts := ROUND((v_base + v_base / 6.0) / 12.0, 2);

    INSERT INTO provisiones_beneficios (anio, mes, trabajador_id, tipo, base_computable, monto, asiento_id) VALUES
      (p_anio, p_mes, v_trab.id, 'vacaciones', v_base, v_prov_vac, v_asiento_id),
      (p_anio, p_mes, v_trab.id, 'gratificacion', v_base, v_prov_grati, v_asiento_id),
      (p_anio, p_mes, v_trab.id, 'cts', v_base, v_prov_cts, v_asiento_id);

    v_total_vac := v_total_vac + v_prov_vac;
    v_total_grati := v_total_grati + v_prov_grati;
    v_total_cts := v_total_cts + v_prov_cts;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    DELETE FROM asientos_contables WHERE id = v_asiento_id;
    RETURN jsonb_build_object('trabajadores', 0, 'mensaje', 'Provisiones del mes ya generadas o sin trabajadores activos');
  END IF;

  -- Partidas del asiento (agrupadas por tipo)
  -- Vacaciones: Debe 6215 / Haber 4115
  v_orden := v_orden + 1;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
  VALUES (v_asiento_id, _cuenta_id_por_codigo('6215'), v_total_vac, 0, v_orden, 'Provisión vacaciones');
  v_orden := v_orden + 1;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
  VALUES (v_asiento_id, _cuenta_id_por_codigo('4115'), 0, v_total_vac, v_orden, 'Vacaciones por pagar');
  -- Gratificación: Debe 6214 / Haber 4114
  v_orden := v_orden + 1;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
  VALUES (v_asiento_id, _cuenta_id_por_codigo('6214'), v_total_grati, 0, v_orden, 'Provisión gratificación');
  v_orden := v_orden + 1;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
  VALUES (v_asiento_id, _cuenta_id_por_codigo('4114'), 0, v_total_grati, v_orden, 'Gratificaciones por pagar');
  -- CTS: Debe 6291 / Haber 4151
  v_orden := v_orden + 1;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
  VALUES (v_asiento_id, _cuenta_id_por_codigo('6291'), v_total_cts, 0, v_orden, 'Provisión CTS');
  v_orden := v_orden + 1;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
  VALUES (v_asiento_id, _cuenta_id_por_codigo('4151'), 0, v_total_cts, v_orden, 'CTS por pagar');

  RETURN jsonb_build_object(
    'trabajadores', v_count,
    'total_vacaciones', v_total_vac,
    'total_gratificacion', v_total_grati,
    'total_cts', v_total_cts,
    'asiento_id', v_asiento_id,
    'numero_asiento', v_numero
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generar_provisiones_mes TO authenticated;

-- ── 4. RPC: calcular liquidación de beneficios sociales (cese)
CREATE OR REPLACE FUNCTION calcular_liquidacion(p_trabajador_id UUID, p_fecha_cese DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trab RECORD;
  v_rmv NUMERIC;
  v_asig_fam NUMERIC;
  v_base NUMERIC;
  -- Períodos truncos
  v_meses_vac NUMERIC; v_dias_vac NUMERIC;
  v_meses_grati NUMERIC;
  v_meses_cts NUMERIC; v_dias_cts NUMERIC;
  v_vac_trunca NUMERIC;
  v_grati_trunca NUMERIC;
  v_bonif_ley NUMERIC;
  v_cts_trunca NUMERIC;
  v_inicio_semestre DATE;
  v_inicio_cts DATE;
  v_ultimo_aniversario DATE;
BEGIN
  SELECT * INTO v_trab FROM trabajadores WHERE id = p_trabajador_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trabajador no existe'; END IF;

  SELECT valor INTO v_rmv FROM parametros_planilla
  WHERE anio = EXTRACT(YEAR FROM p_fecha_cese)::int AND clave = 'rmv';
  v_rmv := COALESCE(v_rmv, 1130);

  v_asig_fam := CASE WHEN v_trab.tiene_hijos THEN ROUND(v_rmv * 0.10, 2) ELSE 0 END;
  v_base := v_trab.sueldo_base + v_asig_fam;

  -- VACACIONES TRUNCAS: desde el último aniversario de ingreso
  v_ultimo_aniversario := v_trab.fecha_ingreso +
    (EXTRACT(YEAR FROM AGE(p_fecha_cese, v_trab.fecha_ingreso))::int || ' years')::interval;
  v_meses_vac := EXTRACT(MONTH FROM AGE(p_fecha_cese, v_ultimo_aniversario));
  v_dias_vac := EXTRACT(DAY FROM AGE(p_fecha_cese, v_ultimo_aniversario));
  v_vac_trunca := ROUND(v_base / 12.0 * v_meses_vac + v_base / 12.0 / 30.0 * v_dias_vac, 2);

  -- GRATIFICACIÓN TRUNCA: desde inicio del semestre (ene o jul)
  IF EXTRACT(MONTH FROM p_fecha_cese) >= 7 THEN
    v_inicio_semestre := make_date(EXTRACT(YEAR FROM p_fecha_cese)::int, 7, 1);
  ELSE
    v_inicio_semestre := make_date(EXTRACT(YEAR FROM p_fecha_cese)::int, 1, 1);
  END IF;
  IF v_trab.fecha_ingreso > v_inicio_semestre THEN
    v_inicio_semestre := v_trab.fecha_ingreso;
  END IF;
  -- Meses COMPLETOS trabajados en el semestre
  v_meses_grati := EXTRACT(YEAR FROM AGE(p_fecha_cese, v_inicio_semestre)) * 12 +
                   EXTRACT(MONTH FROM AGE(p_fecha_cese, v_inicio_semestre));
  v_grati_trunca := ROUND(v_base / 6.0 * v_meses_grati, 2);
  v_bonif_ley := ROUND(v_grati_trunca * 0.09, 2);  -- Ley 30334

  -- CTS TRUNCA: desde último depósito (may o nov)
  IF EXTRACT(MONTH FROM p_fecha_cese) >= 11 THEN
    v_inicio_cts := make_date(EXTRACT(YEAR FROM p_fecha_cese)::int, 11, 1);
  ELSIF EXTRACT(MONTH FROM p_fecha_cese) >= 5 THEN
    v_inicio_cts := make_date(EXTRACT(YEAR FROM p_fecha_cese)::int, 5, 1);
  ELSE
    v_inicio_cts := make_date(EXTRACT(YEAR FROM p_fecha_cese)::int - 1, 11, 1);
  END IF;
  IF v_trab.fecha_ingreso > v_inicio_cts THEN
    v_inicio_cts := v_trab.fecha_ingreso;
  END IF;
  v_meses_cts := EXTRACT(YEAR FROM AGE(p_fecha_cese, v_inicio_cts)) * 12 +
                 EXTRACT(MONTH FROM AGE(p_fecha_cese, v_inicio_cts));
  v_dias_cts := EXTRACT(DAY FROM AGE(p_fecha_cese, v_inicio_cts));
  -- Base CTS = rem + 1/6 grati
  v_cts_trunca := ROUND((v_base + v_base / 6.0) / 12.0 * v_meses_cts +
                        (v_base + v_base / 6.0) / 12.0 / 30.0 * v_dias_cts, 2);

  RETURN jsonb_build_object(
    'trabajador', v_trab.nombres || ' ' || v_trab.apellido_paterno,
    'fecha_ingreso', v_trab.fecha_ingreso,
    'fecha_cese', p_fecha_cese,
    'base_computable', v_base,
    'vacaciones_truncas', jsonb_build_object(
      'meses', v_meses_vac, 'dias', v_dias_vac, 'monto', v_vac_trunca),
    'gratificacion_trunca', jsonb_build_object(
      'meses', v_meses_grati, 'monto', v_grati_trunca, 'bonificacion_9pct', v_bonif_ley),
    'cts_trunca', jsonb_build_object(
      'meses', v_meses_cts, 'dias', v_dias_cts, 'monto', v_cts_trunca),
    'total_liquidacion', v_vac_trunca + v_grati_trunca + v_bonif_ley + v_cts_trunca
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calcular_liquidacion TO authenticated;

-- ── 5. RLS
ALTER TABLE provisiones_beneficios ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY prov_read ON provisiones_beneficios FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY prov_write ON provisiones_beneficios FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY vac_read ON vacaciones FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY vac_write ON vacaciones FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
