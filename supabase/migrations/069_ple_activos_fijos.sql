-- ─────────────────────────────────────────────────────────────────────────────
-- 069: PLE — Libro Diario 5.1 + Libro Mayor 6.1 + Registro de Activos Fijos 7.1
--
-- Requerimiento Vaneza (R1):
-- "gestionar el PLE con los demás libros como son diario mayor registro de
--  activos fijos... la contabilidad manual ya desapareció"
--
-- Diseño:
-- - RPCs que devuelven las filas en estructura PLE (el TXT con nomenclatura
--   oficial se arma en el frontend)
-- - Tabla activos_fijos con depreciación mensual automática
-- - RPC generar_asiento_depreciacion_mensual
--
-- Nomenclatura de archivo PLE:
-- LE + RUC(11) + AAAA + MM + 00 + CODLIBRO(6) + 00 + 1 + estado(1) + 1 + 1 + .txt
-- Ej: LE20519883296202606000501000011011.txt (Libro Diario jun-2026)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. PLE 5.1 — Libro Diario
CREATE OR REPLACE FUNCTION ple_libro_diario(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  filas AS (
    SELECT
      LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0') || '00' AS periodo,
      a.numero AS cuo,                    -- código único de operación
      'M' || p.orden AS correlativo_linea,
      c.codigo AS cuenta,
      COALESCE(c.codigo_ple, c.codigo) AS codigo_ple,
      '' AS centro_costo_ple,
      'PEN' AS moneda,
      COALESCE(
        CASE
          WHEN p.cliente_id IS NOT NULL THEN '6'
          WHEN p.proveedor_id IS NOT NULL THEN '6'
          WHEN p.tercero_id IS NOT NULL THEN '1'
          ELSE ''
        END, '') AS tipo_doc_anexo,
      COALESCE(cl.ruc, cl.dni, pr.ruc, te.numero_doc, '') AS num_doc_anexo,
      TO_CHAR(a.fecha, 'DD/MM/YYYY') AS fecha_contable,
      TO_CHAR(a.fecha, 'DD/MM/YYYY') AS fecha_vencimiento,
      TO_CHAR(a.fecha, 'DD/MM/YYYY') AS fecha_operacion,
      LEFT(a.glosa, 200) AS glosa,
      LEFT(COALESCE(p.glosa_partida, ''), 200) AS glosa_referencial,
      p.debe,
      p.haber,
      '' AS dato_estructurado,
      '1' AS estado_ple                    -- 1 = operación del período
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    LEFT JOIN clientes cl ON cl.id = p.cliente_id
    LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    LEFT JOIN terceros te ON te.id = p.tercero_id
    CROSS JOIN rango r
    WHERE a.fecha BETWEEN r.desde AND r.hasta
      AND a.estado = 'asentado'
    ORDER BY a.fecha, a.numero, p.orden
  )
  SELECT jsonb_build_object(
    'periodo', LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0'),
    'filas', COALESCE(jsonb_agg(row_to_json(filas)), '[]'::jsonb),
    'cantidad', (SELECT COUNT(*) FROM filas),
    'total_debe', COALESCE((SELECT SUM(debe) FROM filas), 0),
    'total_haber', COALESCE((SELECT SUM(haber) FROM filas), 0)
  ) FROM filas;
$$;

GRANT EXECUTE ON FUNCTION ple_libro_diario TO authenticated;

-- ── 2. PLE 6.1 — Libro Mayor
CREATE OR REPLACE FUNCTION ple_libro_mayor(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  filas AS (
    SELECT
      LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0') || '00' AS periodo,
      a.numero AS cuo,
      'M' || p.orden AS correlativo_linea,
      TO_CHAR(a.fecha, 'DD/MM/YYYY') AS fecha_operacion,
      c.codigo AS cuenta,
      c.nombre AS denominacion_cuenta,
      LEFT(a.glosa, 200) AS glosa,
      p.debe,
      p.haber,
      '1' AS estado_ple
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    CROSS JOIN rango r
    WHERE a.fecha BETWEEN r.desde AND r.hasta
      AND a.estado = 'asentado'
    ORDER BY c.codigo, a.fecha, a.numero, p.orden
  )
  SELECT jsonb_build_object(
    'periodo', LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0'),
    'filas', COALESCE(jsonb_agg(row_to_json(filas)), '[]'::jsonb),
    'cantidad', (SELECT COUNT(*) FROM filas),
    'total_debe', COALESCE((SELECT SUM(debe) FROM filas), 0),
    'total_haber', COALESCE((SELECT SUM(haber) FROM filas), 0)
  ) FROM filas;
$$;

GRANT EXECUTE ON FUNCTION ple_libro_mayor TO authenticated;

-- ── 3. Tabla activos_fijos
CREATE TABLE IF NOT EXISTS activos_fijos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,           -- AF-001
  descripcion TEXT NOT NULL,
  marca TEXT,
  modelo TEXT,
  numero_serie TEXT,
  fecha_adquisicion DATE NOT NULL,
  valor_adquisicion NUMERIC(14, 2) NOT NULL CHECK (valor_adquisicion > 0),
  -- Depreciación
  metodo_depreciacion TEXT NOT NULL DEFAULT 'linea_recta' CHECK (metodo_depreciacion IN ('linea_recta')),
  vida_util_anios INT NOT NULL DEFAULT 10 CHECK (vida_util_anios > 0),
  porcentaje_depreciacion NUMERIC(5, 2),  -- calculado o manual (SUNAT: 10% muebles, 20% vehículos, 25% cómputo)
  depreciacion_acumulada NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- Cuentas
  cuenta_activo TEXT NOT NULL DEFAULT '335',       -- Muebles y enseres por defecto
  cuenta_depreciacion TEXT NOT NULL DEFAULT '391', -- Depreciación acumulada
  cuenta_gasto TEXT NOT NULL DEFAULT '6814',       -- Depreciación IME - Costo
  centro_costo_id UUID REFERENCES centros_costo(id),
  -- Estado
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'depreciado', 'vendido', 'baja')),
  fecha_baja DATE,
  motivo_baja TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_af_estado ON activos_fijos(estado);

COMMENT ON TABLE activos_fijos IS
  'Registro de Activos Fijos (PLE 7.1). Depreciación línea recta con % SUNAT: edificios 5%, vehículos 20%, maquinaria 10%, cómputo 25%, muebles 10%.';

-- ── 4. Registro mensual de depreciación (evita duplicar el asiento del mes)
CREATE TABLE IF NOT EXISTS depreciaciones_mensuales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio INT NOT NULL,
  mes INT NOT NULL,
  activo_fijo_id UUID NOT NULL REFERENCES activos_fijos(id) ON DELETE CASCADE,
  monto NUMERIC(14, 2) NOT NULL,
  asiento_id UUID REFERENCES asientos_contables(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_dep_mes UNIQUE (anio, mes, activo_fijo_id)
);

-- ── 5. RPC: generar depreciación del mes (un asiento consolidado)
CREATE OR REPLACE FUNCTION generar_depreciacion_mensual(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_af RECORD;
  v_monto_mes NUMERIC;
  v_total NUMERIC := 0;
  v_count INT := 0;
  v_asiento_id UUID;
  v_numero TEXT;
  v_fecha DATE;
  v_cta_gasto UUID;
  v_cta_dep UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  v_fecha := (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date;

  -- Crear cabecera del asiento (una sola por mes)
  v_numero := siguiente_numero_asiento();
  INSERT INTO asientos_contables (numero, fecha, glosa, origen, estado, creado_por)
  VALUES (v_numero, v_fecha,
          'Depreciación mensual ' || LPAD(p_mes::text, 2, '0') || '-' || p_anio,
          'depreciacion', 'borrador', v_user)
  RETURNING id INTO v_asiento_id;

  FOR v_af IN
    SELECT * FROM activos_fijos
    WHERE estado = 'activo'
      AND fecha_adquisicion <= v_fecha
      AND depreciacion_acumulada < valor_adquisicion
      AND NOT EXISTS (
        SELECT 1 FROM depreciaciones_mensuales dm
        WHERE dm.activo_fijo_id = activos_fijos.id AND dm.anio = p_anio AND dm.mes = p_mes
      )
  LOOP
    -- Depreciación mensual = valor × % anual / 12 (o vida útil)
    v_monto_mes := ROUND(
      v_af.valor_adquisicion *
      COALESCE(v_af.porcentaje_depreciacion / 100.0, 1.0 / v_af.vida_util_anios) / 12.0,
      2);
    -- No exceder el valor restante
    v_monto_mes := LEAST(v_monto_mes, v_af.valor_adquisicion - v_af.depreciacion_acumulada);
    IF v_monto_mes <= 0 THEN CONTINUE; END IF;

    v_cta_gasto := _cuenta_id_por_codigo(v_af.cuenta_gasto);
    v_cta_dep := _cuenta_id_por_codigo(v_af.cuenta_depreciacion);
    IF v_cta_gasto IS NULL OR v_cta_dep IS NULL THEN CONTINUE; END IF;

    -- Partidas: Debe gasto / Haber depreciación acumulada
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida, centro_costo_id)
    VALUES (v_asiento_id, v_cta_gasto, v_monto_mes, 0, v_count * 2 + 1, v_af.codigo || ' ' || v_af.descripcion, v_af.centro_costo_id);
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, glosa_partida)
    VALUES (v_asiento_id, v_cta_dep, 0, v_monto_mes, v_count * 2 + 2, v_af.codigo || ' ' || v_af.descripcion);

    -- Actualizar acumulada + registrar el mes
    UPDATE activos_fijos
    SET depreciacion_acumulada = depreciacion_acumulada + v_monto_mes,
        estado = CASE WHEN depreciacion_acumulada + v_monto_mes >= valor_adquisicion THEN 'depreciado' ELSE estado END
    WHERE id = v_af.id;

    INSERT INTO depreciaciones_mensuales (anio, mes, activo_fijo_id, monto, asiento_id)
    VALUES (p_anio, p_mes, v_af.id, v_monto_mes, v_asiento_id);

    v_total := v_total + v_monto_mes;
    v_count := v_count + 1;
  END LOOP;

  -- Si no hubo activos que depreciar, eliminar el asiento vacío
  IF v_count = 0 THEN
    DELETE FROM asientos_contables WHERE id = v_asiento_id;
    RETURN jsonb_build_object('activos_depreciados', 0, 'total', 0, 'asiento_id', NULL,
      'mensaje', 'No hay activos pendientes de depreciar este mes');
  END IF;

  RETURN jsonb_build_object(
    'activos_depreciados', v_count,
    'total', v_total,
    'asiento_id', v_asiento_id,
    'numero_asiento', v_numero
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generar_depreciacion_mensual TO authenticated;

-- ── 6. RLS
ALTER TABLE activos_fijos ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciaciones_mensuales ENABLE ROW LEVEL SECURITY;

CREATE POLICY af_read ON activos_fijos FOR SELECT USING (TRUE);
CREATE POLICY af_write ON activos_fijos FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY dm_read ON depreciaciones_mensuales FOR SELECT USING (TRUE);
CREATE POLICY dm_write ON depreciaciones_mensuales FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
