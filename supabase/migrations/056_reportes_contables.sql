-- ─────────────────────────────────────────────────────────────────────────────
-- 056: Reportes contables — Libro Mayor + Balance de Comprobación + EERR
--
-- Funciones SQL que devuelven los reportes con datos pre-calculados:
-- - libro_mayor_cuenta(p_cuenta_id, p_desde, p_hasta): movimientos + saldo
--   acumulado por cuenta
-- - balance_comprobacion(p_desde, p_hasta): sumas y saldos por cuenta
-- - estado_resultados(p_desde, p_hasta): clase 6/7/9 agrupado (utilidad neta)
--
-- Solo cuentan asientos en estado 'asentado'. Los borradores quedan fuera
-- para que el reporte refleje únicamente lo "oficial" según SUNAT.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Libro Mayor por cuenta
CREATE OR REPLACE FUNCTION libro_mayor_cuenta(
  p_cuenta_id UUID,
  p_desde DATE,
  p_hasta DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo_inicial NUMERIC := 0;
  v_resultado JSONB;
  v_cuenta RECORD;
BEGIN
  SELECT * INTO v_cuenta FROM cuentas_contables WHERE id = p_cuenta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta no existe'; END IF;

  -- Saldo inicial: movimientos antes de p_desde
  SELECT COALESCE(SUM(
    CASE WHEN v_cuenta.saldo_natural = 'D' THEN debe - haber
         ELSE haber - debe END
  ), 0) INTO v_saldo_inicial
  FROM asientos_partidas p
  JOIN asientos_contables a ON a.id = p.asiento_id
  WHERE p.cuenta_id = p_cuenta_id
    AND a.fecha < p_desde
    AND a.estado = 'asentado';

  SELECT jsonb_build_object(
    'cuenta', jsonb_build_object(
      'codigo', v_cuenta.codigo,
      'nombre', v_cuenta.nombre,
      'naturaleza', v_cuenta.naturaleza,
      'saldo_natural', v_cuenta.saldo_natural
    ),
    'desde', p_desde,
    'hasta', p_hasta,
    'saldo_inicial', v_saldo_inicial,
    'movimientos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fecha', a.fecha,
        'asiento_numero', a.numero,
        'asiento_id', a.id,
        'glosa', a.glosa,
        'glosa_partida', p.glosa_partida,
        'debe', p.debe,
        'haber', p.haber
      ) ORDER BY a.fecha, a.numero)
      FROM asientos_partidas p
      JOIN asientos_contables a ON a.id = p.asiento_id
      WHERE p.cuenta_id = p_cuenta_id
        AND a.fecha BETWEEN p_desde AND p_hasta
        AND a.estado = 'asentado'
    ), '[]'::jsonb),
    'total_debe', COALESCE((
      SELECT SUM(p.debe) FROM asientos_partidas p
      JOIN asientos_contables a ON a.id = p.asiento_id
      WHERE p.cuenta_id = p_cuenta_id
        AND a.fecha BETWEEN p_desde AND p_hasta
        AND a.estado = 'asentado'
    ), 0),
    'total_haber', COALESCE((
      SELECT SUM(p.haber) FROM asientos_partidas p
      JOIN asientos_contables a ON a.id = p.asiento_id
      WHERE p.cuenta_id = p_cuenta_id
        AND a.fecha BETWEEN p_desde AND p_hasta
        AND a.estado = 'asentado'
    ), 0)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION libro_mayor_cuenta TO authenticated;

-- ── Balance de Comprobación (sumas y saldos por cuenta)
CREATE OR REPLACE FUNCTION balance_comprobacion(p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH movs AS (
    SELECT
      c.id, c.codigo, c.nombre, c.naturaleza, c.saldo_natural,
      COALESCE(SUM(
        CASE WHEN a.fecha < p_desde AND a.estado='asentado' THEN
          CASE WHEN c.saldo_natural='D' THEN p.debe - p.haber ELSE p.haber - p.debe END
        ELSE 0 END
      ), 0) AS saldo_inicial,
      COALESCE(SUM(
        CASE WHEN a.fecha BETWEEN p_desde AND p_hasta AND a.estado='asentado' THEN p.debe ELSE 0 END
      ), 0) AS debe_periodo,
      COALESCE(SUM(
        CASE WHEN a.fecha BETWEEN p_desde AND p_hasta AND a.estado='asentado' THEN p.haber ELSE 0 END
      ), 0) AS haber_periodo
    FROM cuentas_contables c
    LEFT JOIN asientos_partidas p ON p.cuenta_id = c.id
    LEFT JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE c.es_movimiento = TRUE
    GROUP BY c.id, c.codigo, c.nombre, c.naturaleza, c.saldo_natural
  )
  SELECT jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'totales', jsonb_build_object(
      'total_debe', COALESCE(SUM(debe_periodo), 0),
      'total_haber', COALESCE(SUM(haber_periodo), 0)
    ),
    'cuentas', COALESCE(jsonb_agg(jsonb_build_object(
      'cuenta_id', id,
      'codigo', codigo,
      'nombre', nombre,
      'naturaleza', naturaleza,
      'saldo_inicial', saldo_inicial,
      'debe_periodo', debe_periodo,
      'haber_periodo', haber_periodo,
      'saldo_final',
        saldo_inicial + (CASE WHEN saldo_natural='D' THEN debe_periodo - haber_periodo
                              ELSE haber_periodo - debe_periodo END)
    ) ORDER BY codigo) FILTER (WHERE debe_periodo > 0 OR haber_periodo > 0 OR saldo_inicial <> 0),
    '[]'::jsonb)
  )
  FROM movs;
$$;

GRANT EXECUTE ON FUNCTION balance_comprobacion TO authenticated;

-- ── Estado de Resultados (P&L simplificado)
-- Ingresos (clase 7) − Gastos (clase 6) = Utilidad antes de impuestos
CREATE OR REPLACE FUNCTION estado_resultados(p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lineas AS (
    SELECT
      c.codigo, c.nombre, c.naturaleza, c.clase,
      COALESCE(SUM(
        CASE WHEN c.naturaleza='INGRESO' THEN p.haber - p.debe  -- Ingresos: H - D
             WHEN c.naturaleza IN ('GASTO','COSTO') THEN p.debe - p.haber  -- Gastos: D - H
             ELSE 0 END
      ), 0) AS monto
    FROM cuentas_contables c
    LEFT JOIN asientos_partidas p ON p.cuenta_id = c.id
    LEFT JOIN asientos_contables a ON a.id = p.asiento_id
      AND a.fecha BETWEEN p_desde AND p_hasta
      AND a.estado = 'asentado'
    WHERE c.es_movimiento = TRUE
      AND c.naturaleza IN ('INGRESO','GASTO','COSTO')
    GROUP BY c.codigo, c.nombre, c.naturaleza, c.clase
  ),
  agregado AS (
    SELECT
      SUM(monto) FILTER (WHERE naturaleza='INGRESO') AS total_ingresos,
      SUM(monto) FILTER (WHERE naturaleza='GASTO') AS total_gastos,
      SUM(monto) FILTER (WHERE naturaleza='COSTO') AS total_costos
    FROM lineas
  )
  SELECT jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'ingresos', COALESCE(ag.total_ingresos, 0),
    'gastos', COALESCE(ag.total_gastos, 0),
    'costos', COALESCE(ag.total_costos, 0),
    'utilidad_bruta', COALESCE(ag.total_ingresos, 0) - COALESCE(ag.total_costos, 0),
    'utilidad_operativa', COALESCE(ag.total_ingresos, 0) - COALESCE(ag.total_gastos, 0) - COALESCE(ag.total_costos, 0),
    'detalle_ingresos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'monto', monto) ORDER BY codigo)
      FROM lineas WHERE naturaleza='INGRESO' AND monto <> 0
    ), '[]'::jsonb),
    'detalle_gastos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre, 'monto', monto) ORDER BY codigo)
      FROM lineas WHERE naturaleza IN ('GASTO','COSTO') AND monto <> 0
    ), '[]'::jsonb)
  )
  FROM agregado ag;
$$;

GRANT EXECUTE ON FUNCTION estado_resultados TO authenticated;
