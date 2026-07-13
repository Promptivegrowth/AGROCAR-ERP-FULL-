-- ─────────────────────────────────────────────────────────────────────────────
-- 067: Estados Financieros — Balance General + Flujo Efectivo + Cambios Patrimonio
--
-- Requerimiento Vaneza (R1):
-- "manejamos estado de situación financiera, el estado de resultados, el
--  estado de flujo efectivo, el estado de cambios en el patrimonio y las
--  notas a los estados financieros... que esté dentro de contabilidad
--  como opción"
--
-- Estado de Resultados ya existe (migración 056). Aquí van los 3 restantes:
-- - EF1: Estado de Situación Financiera (Balance General)
-- - EF4: Estado de Flujo de Efectivo (método directo simplificado)
-- - EF5: Estado de Cambios en el Patrimonio Neto
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Balance General (Estado de Situación Financiera) a una fecha de corte
CREATE OR REPLACE FUNCTION balance_general(p_al DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH saldos AS (
    SELECT
      c.id, c.codigo, c.nombre, c.naturaleza, c.saldo_natural, c.clase,
      COALESCE(SUM(
        CASE WHEN c.saldo_natural = 'D' THEN p.debe - p.haber
             ELSE p.haber - p.debe END
      ), 0) AS saldo
    FROM cuentas_contables c
    JOIN asientos_partidas p ON p.cuenta_id = c.id
    JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE a.fecha <= p_al
      AND a.estado = 'asentado'
      AND c.es_movimiento = TRUE
    GROUP BY c.id, c.codigo, c.nombre, c.naturaleza, c.saldo_natural, c.clase
    HAVING ABS(COALESCE(SUM(
      CASE WHEN c.saldo_natural = 'D' THEN p.debe - p.haber
           ELSE p.haber - p.debe END
    ), 0)) > 0.005
  ),
  -- Resultado del ejercicio: ingresos - gastos hasta la fecha de corte
  resultado AS (
    SELECT
      COALESCE(SUM(CASE WHEN c.naturaleza = 'INGRESO' THEN p.haber - p.debe ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN c.naturaleza IN ('GASTO','COSTO') THEN p.debe - p.haber ELSE 0 END), 0)
      AS utilidad
    FROM asientos_partidas p
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE a.fecha <= p_al AND a.estado = 'asentado'
      AND c.naturaleza IN ('INGRESO','GASTO','COSTO')
  )
  SELECT jsonb_build_object(
    'al', p_al,
    'activo_corriente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'saldo', saldo) ORDER BY codigo)
      FROM saldos WHERE naturaleza = 'ACTIVO' AND clase IN ('1','2')
    ), '[]'::jsonb),
    'activo_no_corriente', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'saldo', saldo) ORDER BY codigo)
      FROM saldos WHERE naturaleza = 'ACTIVO' AND clase = '3'
    ), '[]'::jsonb),
    'pasivo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'saldo', saldo) ORDER BY codigo)
      FROM saldos WHERE naturaleza = 'PASIVO'
    ), '[]'::jsonb),
    'patrimonio', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'saldo', saldo) ORDER BY codigo)
      FROM saldos WHERE naturaleza = 'PATRIMONIO'
    ), '[]'::jsonb),
    'total_activo_corriente', COALESCE((SELECT SUM(saldo) FROM saldos WHERE naturaleza = 'ACTIVO' AND clase IN ('1','2')), 0),
    'total_activo_no_corriente', COALESCE((SELECT SUM(saldo) FROM saldos WHERE naturaleza = 'ACTIVO' AND clase = '3'), 0),
    'total_pasivo', COALESCE((SELECT SUM(saldo) FROM saldos WHERE naturaleza = 'PASIVO'), 0),
    'total_patrimonio_cuentas', COALESCE((SELECT SUM(saldo) FROM saldos WHERE naturaleza = 'PATRIMONIO'), 0),
    'resultado_ejercicio', (SELECT utilidad FROM resultado)
  );
$$;

GRANT EXECUTE ON FUNCTION balance_general TO authenticated;

-- ── 2. Estado de Flujo de Efectivo (método directo simplificado)
-- Analiza los movimientos de las cuentas de efectivo (101x, 104x) en el período,
-- clasificados por el ORIGEN del asiento.
CREATE OR REPLACE FUNCTION flujo_efectivo(p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH movs_efectivo AS (
    SELECT
      a.origen,
      SUM(p.debe) AS entradas,
      SUM(p.haber) AS salidas
    FROM asientos_partidas p
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE a.fecha BETWEEN p_desde AND p_hasta
      AND a.estado = 'asentado'
      AND (c.codigo LIKE '101%' OR c.codigo LIKE '104%')
    GROUP BY a.origen
  ),
  saldo_inicial AS (
    SELECT COALESCE(SUM(p.debe - p.haber), 0) AS saldo
    FROM asientos_partidas p
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE a.fecha < p_desde AND a.estado = 'asentado'
      AND (c.codigo LIKE '101%' OR c.codigo LIKE '104%')
  ),
  totales AS (
    SELECT COALESCE(SUM(entradas), 0) AS total_entradas,
           COALESCE(SUM(salidas), 0) AS total_salidas
    FROM movs_efectivo
  )
  SELECT jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'saldo_inicial', (SELECT saldo FROM saldo_inicial),
    'detalle', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'origen', origen,
        'entradas', entradas,
        'salidas', salidas,
        'neto', entradas - salidas
      ) ORDER BY origen)
      FROM movs_efectivo
    ), '[]'::jsonb),
    'total_entradas', (SELECT total_entradas FROM totales),
    'total_salidas', (SELECT total_salidas FROM totales),
    'flujo_neto', (SELECT total_entradas - total_salidas FROM totales),
    'saldo_final', (SELECT saldo FROM saldo_inicial) + (SELECT total_entradas - total_salidas FROM totales)
  );
$$;

GRANT EXECUTE ON FUNCTION flujo_efectivo TO authenticated;

-- ── 3. Estado de Cambios en el Patrimonio Neto
-- Compara saldos de cuentas de patrimonio entre 2 fechas + resultado del período
CREATE OR REPLACE FUNCTION cambios_patrimonio(p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cuentas_pat AS (
    SELECT id, codigo, nombre FROM cuentas_contables
    WHERE naturaleza = 'PATRIMONIO' AND es_movimiento = TRUE
  ),
  saldo_al AS (
    SELECT
      cp.id, cp.codigo, cp.nombre,
      COALESCE(SUM(CASE WHEN a.fecha < p_desde THEN p.haber - p.debe ELSE 0 END), 0) AS saldo_inicial,
      COALESCE(SUM(CASE WHEN a.fecha BETWEEN p_desde AND p_hasta THEN p.haber ELSE 0 END), 0) AS aumentos,
      COALESCE(SUM(CASE WHEN a.fecha BETWEEN p_desde AND p_hasta THEN p.debe ELSE 0 END), 0) AS disminuciones
    FROM cuentas_pat cp
    LEFT JOIN asientos_partidas p ON p.cuenta_id = cp.id
    LEFT JOIN asientos_contables a ON a.id = p.asiento_id AND a.estado = 'asentado'
    GROUP BY cp.id, cp.codigo, cp.nombre
  ),
  resultado_periodo AS (
    SELECT
      COALESCE(SUM(CASE WHEN c.naturaleza = 'INGRESO' THEN p.haber - p.debe ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN c.naturaleza IN ('GASTO','COSTO') THEN p.debe - p.haber ELSE 0 END), 0)
      AS utilidad
    FROM asientos_partidas p
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE a.fecha BETWEEN p_desde AND p_hasta AND a.estado = 'asentado'
      AND c.naturaleza IN ('INGRESO','GASTO','COSTO')
  )
  SELECT jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'cuentas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'codigo', codigo, 'nombre', nombre,
        'saldo_inicial', saldo_inicial,
        'aumentos', aumentos,
        'disminuciones', disminuciones,
        'saldo_final', saldo_inicial + aumentos - disminuciones
      ) ORDER BY codigo)
      FROM saldo_al
    ), '[]'::jsonb),
    'total_inicial', COALESCE((SELECT SUM(saldo_inicial) FROM saldo_al), 0),
    'total_aumentos', COALESCE((SELECT SUM(aumentos) FROM saldo_al), 0),
    'total_disminuciones', COALESCE((SELECT SUM(disminuciones) FROM saldo_al), 0),
    'resultado_periodo', (SELECT utilidad FROM resultado_periodo),
    'total_final', COALESCE((SELECT SUM(saldo_inicial + aumentos - disminuciones) FROM saldo_al), 0)
      + (SELECT utilidad FROM resultado_periodo)
  );
$$;

GRANT EXECUTE ON FUNCTION cambios_patrimonio TO authenticated;

-- ── 4. Notas a los EEFF — tabla libre para que el contador escriba
CREATE TABLE IF NOT EXISTS eeff_notas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio INT NOT NULL,
  mes INT,                              -- NULL = nota anual
  numero INT NOT NULL,                  -- N° de nota (1, 2, 3…)
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  estado_ref TEXT,                      -- a qué estado refiere: EF1/EF3/EF4/EF5
  creado_por UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_nota_periodo UNIQUE (anio, mes, numero)
);

ALTER TABLE eeff_notas ENABLE ROW LEVEL SECURITY;
CREATE POLICY notas_read ON eeff_notas FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY notas_write ON eeff_notas FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
