-- ─────────────────────────────────────────────────────────────────────────────
-- 072: Planillas Fase 2 — cálculo de planilla mensual + cierre
--
-- Requerimiento Vaneza (R1):
-- "que se haga la planilla, que podamos gestionarla... cerrar la planilla
--  es bueno que las planillas se cierren y una vez terminada ya no puedan
--  ser modificadas, y podemos abrir un siguiente periodo"
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Planillas (una por mes)
CREATE TABLE IF NOT EXISTS planillas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'calculada', 'cerrada', 'pagada')),
  total_ingresos NUMERIC(14, 2) DEFAULT 0,
  total_descuentos NUMERIC(14, 2) DEFAULT 0,
  total_neto NUMERIC(14, 2) DEFAULT 0,
  total_aportes_empleador NUMERIC(14, 2) DEFAULT 0,
  trabajadores_count INT DEFAULT 0,
  asiento_id UUID REFERENCES asientos_contables(id),
  calculada_at TIMESTAMPTZ,
  cerrada_at TIMESTAMPTZ,
  cerrada_por UUID REFERENCES profiles(id),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_planilla_mes UNIQUE (anio, mes)
);

-- ── 2. Detalle: trabajador × concepto
CREATE TABLE IF NOT EXISTS planilla_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_id UUID NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
  trabajador_id UUID NOT NULL REFERENCES trabajadores(id),
  concepto_id UUID NOT NULL REFERENCES conceptos_remunerativos(id),
  monto NUMERIC(12, 2) NOT NULL DEFAULT 0,
  es_manual BOOLEAN DEFAULT FALSE,          -- si fue editado a mano (no recalcular)
  notas TEXT,
  CONSTRAINT uniq_planilla_trab_concepto UNIQUE (planilla_id, trabajador_id, concepto_id)
);

CREATE INDEX IF NOT EXISTS idx_pd_planilla ON planilla_detalle(planilla_id);
CREATE INDEX IF NOT EXISTS idx_pd_trabajador ON planilla_detalle(trabajador_id);

-- ── 3. Horas extras del mes (input para el cálculo)
CREATE TABLE IF NOT EXISTS planilla_horas_extras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_id UUID NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
  trabajador_id UUID NOT NULL REFERENCES trabajadores(id),
  horas_25 NUMERIC(6, 2) DEFAULT 0,
  horas_35 NUMERIC(6, 2) DEFAULT 0,
  CONSTRAINT uniq_he_planilla_trab UNIQUE (planilla_id, trabajador_id)
);

-- ── 4. RPC: calcular planilla del mes
CREATE OR REPLACE FUNCTION calcular_planilla(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_planilla_id UUID;
  v_planilla RECORD;
  v_trab RECORD;
  v_rmv NUMERIC;
  v_uit NUMERIC;
  v_essalud_tasa NUMERIC;
  v_onp_tasa NUMERIC;
  v_asig_pct NUMERIC;
  v_sueldo NUMERIC;
  v_asig_fam NUMERIC;
  v_he RECORD;
  v_valor_hora NUMERIC;
  v_monto_he25 NUMERIC;
  v_monto_he35 NUMERIC;
  v_base_afecta NUMERIC;
  v_onp NUMERIC; v_afp_fondo NUMERIC; v_afp_seguro NUMERIC; v_afp_comision NUMERIC;
  v_renta5ta NUMERIC;
  v_proyeccion_anual NUMERIC;
  v_essalud NUMERIC;
  v_count INT := 0;
  c_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Sin permisos para calcular planilla';
  END IF;

  -- Crear u obtener planilla del mes
  INSERT INTO planillas (anio, mes) VALUES (p_anio, p_mes)
  ON CONFLICT (anio, mes) DO NOTHING;
  SELECT * INTO v_planilla FROM planillas WHERE anio = p_anio AND mes = p_mes;
  v_planilla_id := v_planilla.id;
  IF v_planilla.estado IN ('cerrada', 'pagada') THEN
    RAISE EXCEPTION 'La planilla %-% está cerrada — no se puede recalcular', p_anio, LPAD(p_mes::text, 2, '0');
  END IF;

  -- Parámetros del año
  SELECT valor INTO v_rmv FROM parametros_planilla WHERE anio = p_anio AND clave = 'rmv';
  SELECT valor INTO v_uit FROM parametros_planilla WHERE anio = p_anio AND clave = 'uit';
  SELECT valor INTO v_essalud_tasa FROM parametros_planilla WHERE anio = p_anio AND clave = 'essalud_tasa';
  SELECT valor INTO v_onp_tasa FROM parametros_planilla WHERE anio = p_anio AND clave = 'onp_tasa';
  SELECT valor INTO v_asig_pct FROM parametros_planilla WHERE anio = p_anio AND clave = 'asignacion_familiar_pct';
  IF v_rmv IS NULL OR v_uit IS NULL THEN
    RAISE EXCEPTION 'Faltan parámetros de planilla para el año % (RMV/UIT). Configúralos primero.', p_anio;
  END IF;

  -- Limpiar cálculos previos NO manuales
  DELETE FROM planilla_detalle
  WHERE planilla_id = v_planilla_id AND es_manual = FALSE;

  FOR v_trab IN
    SELECT * FROM trabajadores
    WHERE estado = 'activo'
      AND fecha_ingreso <= (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date
  LOOP
    v_sueldo := v_trab.sueldo_base;

    -- SUELDO
    SELECT id INTO c_id FROM conceptos_remunerativos WHERE codigo = 'SUELDO';
    INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
    VALUES (v_planilla_id, v_trab.id, c_id, v_sueldo)
    ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO NOTHING;

    -- ASIGNACIÓN FAMILIAR
    v_asig_fam := 0;
    IF v_trab.tiene_hijos THEN
      v_asig_fam := ROUND(v_rmv * COALESCE(v_asig_pct, 10) / 100.0, 2);
      SELECT id INTO c_id FROM conceptos_remunerativos WHERE codigo = 'ASIG_FAM';
      INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
      VALUES (v_planilla_id, v_trab.id, c_id, v_asig_fam)
      ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO NOTHING;
    END IF;

    -- HORAS EXTRAS (si están registradas)
    v_monto_he25 := 0; v_monto_he35 := 0;
    SELECT * INTO v_he FROM planilla_horas_extras
    WHERE planilla_id = v_planilla_id AND trabajador_id = v_trab.id;
    IF FOUND THEN
      v_valor_hora := v_sueldo / 30.0 / 8.0;
      IF COALESCE(v_he.horas_25, 0) > 0 THEN
        v_monto_he25 := ROUND(v_valor_hora * 1.25 * v_he.horas_25, 2);
        SELECT id INTO c_id FROM conceptos_remunerativos WHERE codigo = 'HE_25';
        INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
        VALUES (v_planilla_id, v_trab.id, c_id, v_monto_he25)
        ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;
      END IF;
      IF COALESCE(v_he.horas_35, 0) > 0 THEN
        v_monto_he35 := ROUND(v_valor_hora * 1.35 * v_he.horas_35, 2);
        SELECT id INTO c_id FROM conceptos_remunerativos WHERE codigo = 'HE_35';
        INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
        VALUES (v_planilla_id, v_trab.id, c_id, v_monto_he35)
        ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;
      END IF;
    END IF;

    -- Base afecta a pensión = sueldo + asig fam + HE + conceptos manuales afectos
    SELECT COALESCE(SUM(pd.monto), 0) INTO v_base_afecta
    FROM planilla_detalle pd
    JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
    WHERE pd.planilla_id = v_planilla_id AND pd.trabajador_id = v_trab.id
      AND cr.tipo = 'ingreso' AND cr.afecta_pension;

    -- PENSIÓN
    IF v_trab.regimen_pension = 'onp' THEN
      v_onp := ROUND(v_base_afecta * v_onp_tasa / 100.0, 2);
      SELECT id INTO c_id FROM conceptos_remunerativos WHERE codigo = 'ONP';
      INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
      VALUES (v_planilla_id, v_trab.id, c_id, v_onp)
      ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;
    ELSE
      -- AFP: fondo 10% + seguro + comisión (tasas de conceptos)
      SELECT id, porcentaje INTO c_id, v_afp_fondo FROM conceptos_remunerativos WHERE codigo = 'AFP_FONDO';
      INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
      VALUES (v_planilla_id, v_trab.id, c_id, ROUND(v_base_afecta * v_afp_fondo / 100.0, 2))
      ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;

      SELECT id, porcentaje INTO c_id, v_afp_seguro FROM conceptos_remunerativos WHERE codigo = 'AFP_SEGURO';
      INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
      VALUES (v_planilla_id, v_trab.id, c_id, ROUND(v_base_afecta * v_afp_seguro / 100.0, 2))
      ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;

      SELECT id, porcentaje INTO c_id, v_afp_comision FROM conceptos_remunerativos WHERE codigo = 'AFP_COMISION';
      INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
      VALUES (v_planilla_id, v_trab.id, c_id, ROUND(v_base_afecta * v_afp_comision / 100.0, 2))
      ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;
    END IF;

    -- RENTA 5TA (proyección anual simplificada)
    -- Proyección = base mensual × 14 (12 sueldos + 2 gratis). Si > 7 UIT, retener.
    SELECT COALESCE(SUM(pd.monto), 0) INTO v_base_afecta
    FROM planilla_detalle pd
    JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
    WHERE pd.planilla_id = v_planilla_id AND pd.trabajador_id = v_trab.id
      AND cr.tipo = 'ingreso' AND cr.afecta_renta5ta;

    v_proyeccion_anual := v_base_afecta * 14;
    IF v_proyeccion_anual > (7 * v_uit) THEN
      -- Cálculo simplificado por tramos (8% hasta 5 UIT sobre el exceso de 7)
      DECLARE
        v_exceso NUMERIC := v_proyeccion_anual - (7 * v_uit);
        v_impuesto_anual NUMERIC := 0;
      BEGIN
        -- Tramos: 8% hasta 5 UIT, 14% hasta 20, 17% hasta 35, 20% hasta 45, 30% resto
        v_impuesto_anual :=
          LEAST(v_exceso, 5 * v_uit) * 0.08 +
          GREATEST(LEAST(v_exceso - 5 * v_uit, 15 * v_uit), 0) * 0.14 +
          GREATEST(LEAST(v_exceso - 20 * v_uit, 15 * v_uit), 0) * 0.17 +
          GREATEST(LEAST(v_exceso - 35 * v_uit, 10 * v_uit), 0) * 0.20 +
          GREATEST(v_exceso - 45 * v_uit, 0) * 0.30;
        v_renta5ta := ROUND(v_impuesto_anual / 12.0, 2);
      END;
      SELECT id INTO c_id FROM conceptos_remunerativos WHERE codigo = 'RENTA_5TA';
      INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
      VALUES (v_planilla_id, v_trab.id, c_id, v_renta5ta)
      ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;
    END IF;

    -- ESSALUD (aporte del empleador — sobre base afecta essalud, mínimo RMV)
    SELECT COALESCE(SUM(pd.monto), 0) INTO v_base_afecta
    FROM planilla_detalle pd
    JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
    WHERE pd.planilla_id = v_planilla_id AND pd.trabajador_id = v_trab.id
      AND cr.tipo = 'ingreso' AND cr.afecta_essalud;

    v_essalud := ROUND(GREATEST(v_base_afecta, v_rmv) * v_essalud_tasa / 100.0, 2);
    SELECT id INTO c_id FROM conceptos_remunerativos WHERE codigo = 'ESSALUD';
    INSERT INTO planilla_detalle (planilla_id, trabajador_id, concepto_id, monto)
    VALUES (v_planilla_id, v_trab.id, c_id, v_essalud)
    ON CONFLICT (planilla_id, trabajador_id, concepto_id) DO UPDATE SET monto = EXCLUDED.monto;

    v_count := v_count + 1;
  END LOOP;

  -- Totales de la planilla
  UPDATE planillas SET
    estado = 'calculada',
    calculada_at = NOW(),
    trabajadores_count = v_count,
    total_ingresos = COALESCE((
      SELECT SUM(pd.monto) FROM planilla_detalle pd
      JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
      WHERE pd.planilla_id = v_planilla_id AND cr.tipo = 'ingreso'), 0),
    total_descuentos = COALESCE((
      SELECT SUM(pd.monto) FROM planilla_detalle pd
      JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
      WHERE pd.planilla_id = v_planilla_id AND cr.tipo = 'descuento'), 0),
    total_aportes_empleador = COALESCE((
      SELECT SUM(pd.monto) FROM planilla_detalle pd
      JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
      WHERE pd.planilla_id = v_planilla_id AND cr.tipo = 'aporte_empleador'), 0)
  WHERE id = v_planilla_id;

  UPDATE planillas SET total_neto = total_ingresos - total_descuentos WHERE id = v_planilla_id;

  RETURN jsonb_build_object(
    'planilla_id', v_planilla_id,
    'trabajadores', v_count,
    'total_ingresos', (SELECT total_ingresos FROM planillas WHERE id = v_planilla_id),
    'total_descuentos', (SELECT total_descuentos FROM planillas WHERE id = v_planilla_id),
    'total_neto', (SELECT total_neto FROM planillas WHERE id = v_planilla_id),
    'total_aportes', (SELECT total_aportes_empleador FROM planillas WHERE id = v_planilla_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calcular_planilla TO authenticated;

-- ── 5. RPC: cerrar planilla + generar asiento contable
CREATE OR REPLACE FUNCTION cerrar_planilla(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_planilla RECORD;
  v_asiento_id UUID;
  v_numero TEXT;
  v_fecha DATE;
  v_orden INT := 0;
  v_grupo RECORD;
  v_cta UUID;
BEGIN
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  SELECT * INTO v_planilla FROM planillas WHERE anio = p_anio AND mes = p_mes;
  IF NOT FOUND THEN RAISE EXCEPTION 'Planilla no existe — calcúlala primero'; END IF;
  IF v_planilla.estado = 'borrador' THEN RAISE EXCEPTION 'Planilla sin calcular'; END IF;
  IF v_planilla.estado IN ('cerrada', 'pagada') THEN RAISE EXCEPTION 'Planilla ya cerrada'; END IF;

  v_fecha := (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date;
  v_numero := siguiente_numero_asiento();

  INSERT INTO asientos_contables (numero, fecha, glosa, origen, estado, creado_por)
  VALUES (v_numero, v_fecha,
          'Planilla de remuneraciones ' || LPAD(p_mes::text, 2, '0') || '-' || p_anio,
          'planilla', 'borrador', v_user)
  RETURNING id INTO v_asiento_id;

  -- DEBE: gastos por concepto de ingreso + aportes empleador (agrupado por cuenta)
  FOR v_grupo IN
    SELECT cr.cuenta_contable AS cuenta, SUM(pd.monto) AS total
    FROM planilla_detalle pd
    JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
    WHERE pd.planilla_id = v_planilla.id
      AND cr.tipo IN ('ingreso', 'aporte_empleador')
      AND cr.cuenta_contable IS NOT NULL
    GROUP BY cr.cuenta_contable
    HAVING SUM(pd.monto) > 0
  LOOP
    v_cta := _cuenta_id_por_codigo(v_grupo.cuenta);
    IF v_cta IS NULL THEN CONTINUE; END IF;
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta, v_grupo.total, 0, v_orden);
  END LOOP;

  -- HABER: neto a pagar (411) + descuentos por contrapartida + aportes por pagar
  -- Neto a pagar
  v_cta := _cuenta_id_por_codigo('411');
  v_orden := v_orden + 1;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
  VALUES (v_asiento_id, v_cta, 0, v_planilla.total_neto, v_orden, 'Neto a pagar trabajadores');

  -- Descuentos + aportes agrupados por cuenta contrapartida
  FOR v_grupo IN
    SELECT cr.cuenta_contrapartida AS cuenta, SUM(pd.monto) AS total
    FROM planilla_detalle pd
    JOIN conceptos_remunerativos cr ON cr.id = pd.concepto_id
    WHERE pd.planilla_id = v_planilla.id
      AND cr.tipo IN ('descuento', 'aporte_empleador')
      AND cr.cuenta_contrapartida IS NOT NULL
    GROUP BY cr.cuenta_contrapartida
    HAVING SUM(pd.monto) > 0
  LOOP
    v_cta := _cuenta_id_por_codigo(v_grupo.cuenta);
    IF v_cta IS NULL THEN CONTINUE; END IF;
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta, 0, v_grupo.total, v_orden);
  END LOOP;

  UPDATE planillas SET estado = 'cerrada', cerrada_at = NOW(), cerrada_por = v_user, asiento_id = v_asiento_id
  WHERE id = v_planilla.id;

  RETURN jsonb_build_object(
    'asiento_id', v_asiento_id,
    'numero_asiento', v_numero,
    'total_neto', v_planilla.total_neto
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cerrar_planilla TO authenticated;

-- ── 6. RLS
ALTER TABLE planillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE planilla_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE planilla_horas_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY pl_read ON planillas FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY pl_write ON planillas FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY pld_read ON planilla_detalle FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY pld_write ON planilla_detalle FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY plhe_read ON planilla_horas_extras FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY plhe_write ON planilla_horas_extras FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
