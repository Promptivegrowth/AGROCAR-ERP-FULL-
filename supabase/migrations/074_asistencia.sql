-- ─────────────────────────────────────────────────────────────────────────────
-- 074: Control de asistencia (HITO 17)
--
-- Requerimiento Daniel (R1):
-- "usar la información de inicio/fin de sesión de los vendedores... para
--  otros roles hay que pensar cómo... un control biométrico algo tenemos
--  que hacer, pero hay que dejarlo ya habilitado"
--
-- Diseño:
-- - Registro manual de entrada/salida por trabajador
-- - Cálculo de horas trabajadas + tardanzas
-- - Endpoint preparado para integrar biométrico después (tabla ya lista,
--   el equipo solo tendría que POSTear marcas)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asistencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajador_id UUID NOT NULL REFERENCES trabajadores(id),
  fecha DATE NOT NULL,
  hora_entrada TIME,
  hora_salida TIME,
  horas_trabajadas NUMERIC(5, 2) GENERATED ALWAYS AS (
    CASE WHEN hora_entrada IS NOT NULL AND hora_salida IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (hora_salida - hora_entrada)) / 3600.0, 2)
      ELSE NULL END
  ) STORED,
  tipo TEXT NOT NULL DEFAULT 'normal' CHECK (tipo IN ('normal', 'falta', 'tardanza', 'permiso', 'descanso_medico', 'vacaciones', 'feriado')),
  fuente TEXT NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual', 'biometrico', 'pwa')),
  notas TEXT,
  registrado_por UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_asistencia_dia UNIQUE (trabajador_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_asis_fecha ON asistencias(fecha);
CREATE INDEX IF NOT EXISTS idx_asis_trab ON asistencias(trabajador_id);

COMMENT ON TABLE asistencias IS
  'Control de asistencia. fuente=biometrico queda preparado para cuando Daniel instale el equipo (el dispositivo POSTea marcas a un endpoint).';

-- Resumen mensual por trabajador (para cruzar con planilla)
CREATE OR REPLACE FUNCTION resumen_asistencia_mes(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'trabajador_id', t.id,
    'codigo', t.codigo,
    'nombre', t.nombres || ' ' || t.apellido_paterno,
    'dias_asistidos', stats.dias_asistidos,
    'faltas', stats.faltas,
    'tardanzas', stats.tardanzas,
    'permisos', stats.permisos,
    'total_horas', stats.total_horas
  ) ORDER BY t.codigo), '[]'::jsonb)
  FROM trabajadores t
  CROSS JOIN rango r
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE a.tipo = 'normal') AS dias_asistidos,
      COUNT(*) FILTER (WHERE a.tipo = 'falta') AS faltas,
      COUNT(*) FILTER (WHERE a.tipo = 'tardanza') AS tardanzas,
      COUNT(*) FILTER (WHERE a.tipo IN ('permiso','descanso_medico')) AS permisos,
      COALESCE(SUM(a.horas_trabajadas), 0) AS total_horas
    FROM asistencias a
    WHERE a.trabajador_id = t.id AND a.fecha BETWEEN r.desde AND r.hasta
  ) stats ON TRUE
  WHERE t.estado = 'activo';
$$;

GRANT EXECUTE ON FUNCTION resumen_asistencia_mes TO authenticated;

ALTER TABLE asistencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY asis_read ON asistencias FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY asis_write ON asistencias FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
