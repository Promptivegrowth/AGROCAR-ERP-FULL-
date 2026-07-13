-- ─────────────────────────────────────────────────────────────────────────────
-- 070: Conciliación Bancaria — importar estado de cuenta + match automático
--
-- Requerimiento Vaneza (R1):
-- "todos los meses tenemos los estados de cuenta del banco... sería ideal
--  una opción de conciliación: importar el Excel del estado de cuenta y
--  hacer un match, a ver dónde están las diferencias"
-- Daniel: "el principal es BCP que nosotros trabajamos"
--
-- Diseño:
-- - Tabla conciliaciones_bancarias (una por mes/cuenta)
-- - Tabla banco_movimientos (líneas importadas del banco)
-- - RPC match automático contra asientos de cuentas 104x del sistema
-- - Match nivel 1: monto exacto + fecha exacta
-- - Match nivel 2: monto exacto + fecha ±3 días
-- - Resto: pendiente de conciliación manual
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Conciliaciones (cabecera)
CREATE TABLE IF NOT EXISTS conciliaciones_bancarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banco TEXT NOT NULL DEFAULT 'BCP',
  anio INT NOT NULL,
  mes INT NOT NULL,
  archivo_nombre TEXT,
  total_lineas_banco INT NOT NULL DEFAULT 0,
  conciliados INT NOT NULL DEFAULT 0,
  pendientes_banco INT NOT NULL DEFAULT 0,     -- en banco, no en sistema
  pendientes_sistema INT NOT NULL DEFAULT 0,   -- en sistema, no en banco
  estado TEXT NOT NULL DEFAULT 'en_proceso' CHECK (estado IN ('en_proceso', 'conciliada')),
  realizado_por UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cerrada_at TIMESTAMPTZ,
  notas TEXT,
  CONSTRAINT uniq_conciliacion_mes UNIQUE (banco, anio, mes)
);

-- ── 2. Movimientos del banco importados
CREATE TABLE IF NOT EXISTS banco_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conciliacion_id UUID NOT NULL REFERENCES conciliaciones_bancarias(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  descripcion TEXT,
  monto NUMERIC(14, 2) NOT NULL,               -- positivo = abono, negativo = cargo
  saldo NUMERIC(14, 2),
  operacion TEXT,                              -- número de operación del banco
  -- Match
  match_estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (match_estado IN ('pendiente', 'auto_exacto', 'auto_cercano', 'manual', 'ignorado')),
  partida_id UUID REFERENCES asientos_partidas(id),  -- partida del sistema con la que matchea
  match_notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bm_conciliacion ON banco_movimientos(conciliacion_id);
CREATE INDEX IF NOT EXISTS idx_bm_estado ON banco_movimientos(match_estado);

-- ── 3. RPC: ejecutar match automático de una conciliación
CREATE OR REPLACE FUNCTION conciliar_banco_auto(p_conciliacion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_conc RECORD;
  v_mov RECORD;
  v_partida_id UUID;
  v_exactos INT := 0;
  v_cercanos INT := 0;
  v_pendientes INT := 0;
  v_desde DATE;
  v_hasta DATE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  SELECT * INTO v_conc FROM conciliaciones_bancarias WHERE id = p_conciliacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conciliación no existe'; END IF;

  v_desde := make_date(v_conc.anio, v_conc.mes, 1);
  v_hasta := (v_desde + INTERVAL '1 month - 1 day')::date;

  -- Para cada movimiento del banco sin match
  FOR v_mov IN
    SELECT * FROM banco_movimientos
    WHERE conciliacion_id = p_conciliacion_id AND match_estado = 'pendiente'
  LOOP
    v_partida_id := NULL;

    -- NIVEL 1: monto exacto + fecha exacta contra partidas de bancos (104x)
    -- Abono banco (+) = Debe en el sistema; Cargo banco (-) = Haber
    SELECT p.id INTO v_partida_id
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    WHERE c.codigo LIKE '104%'
      AND a.fecha = v_mov.fecha
      AND a.estado <> 'anulado'
      AND (
        (v_mov.monto > 0 AND ABS(p.debe - v_mov.monto) < 0.01) OR
        (v_mov.monto < 0 AND ABS(p.haber - ABS(v_mov.monto)) < 0.01)
      )
      AND NOT EXISTS (
        SELECT 1 FROM banco_movimientos bm2
        WHERE bm2.partida_id = p.id AND bm2.id <> v_mov.id
      )
    LIMIT 1;

    IF v_partida_id IS NOT NULL THEN
      UPDATE banco_movimientos SET match_estado = 'auto_exacto', partida_id = v_partida_id
      WHERE id = v_mov.id;
      v_exactos := v_exactos + 1;
      CONTINUE;
    END IF;

    -- NIVEL 2: monto exacto + fecha ±3 días
    SELECT p.id INTO v_partida_id
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    WHERE c.codigo LIKE '104%'
      AND a.fecha BETWEEN v_mov.fecha - 3 AND v_mov.fecha + 3
      AND a.estado <> 'anulado'
      AND (
        (v_mov.monto > 0 AND ABS(p.debe - v_mov.monto) < 0.01) OR
        (v_mov.monto < 0 AND ABS(p.haber - ABS(v_mov.monto)) < 0.01)
      )
      AND NOT EXISTS (
        SELECT 1 FROM banco_movimientos bm2
        WHERE bm2.partida_id = p.id AND bm2.id <> v_mov.id
      )
    LIMIT 1;

    IF v_partida_id IS NOT NULL THEN
      UPDATE banco_movimientos SET match_estado = 'auto_cercano', partida_id = v_partida_id
      WHERE id = v_mov.id;
      v_cercanos := v_cercanos + 1;
    ELSE
      v_pendientes := v_pendientes + 1;
    END IF;
  END LOOP;

  -- Partidas del sistema (104x del mes) sin match del banco
  UPDATE conciliaciones_bancarias SET
    conciliados = (SELECT COUNT(*) FROM banco_movimientos WHERE conciliacion_id = p_conciliacion_id AND match_estado IN ('auto_exacto', 'auto_cercano', 'manual')),
    pendientes_banco = (SELECT COUNT(*) FROM banco_movimientos WHERE conciliacion_id = p_conciliacion_id AND match_estado = 'pendiente'),
    pendientes_sistema = (
      SELECT COUNT(*)
      FROM asientos_partidas p
      JOIN asientos_contables a ON a.id = p.asiento_id
      JOIN cuentas_contables c ON c.id = p.cuenta_id
      WHERE c.codigo LIKE '104%'
        AND a.fecha BETWEEN v_desde AND v_hasta
        AND a.estado <> 'anulado'
        AND (p.debe > 0 OR p.haber > 0)
        AND NOT EXISTS (SELECT 1 FROM banco_movimientos bm WHERE bm.partida_id = p.id)
    )
  WHERE id = p_conciliacion_id;

  RETURN jsonb_build_object(
    'exactos', v_exactos,
    'cercanos', v_cercanos,
    'pendientes', v_pendientes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION conciliar_banco_auto TO authenticated;

-- ── 4. Vista: partidas del sistema sin conciliar (para la UI)
CREATE OR REPLACE FUNCTION partidas_banco_sin_conciliar(p_anio INT, p_mes INT)
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
    'partida_id', p.id,
    'fecha', a.fecha,
    'glosa', a.glosa,
    'numero_asiento', a.numero,
    'debe', p.debe,
    'haber', p.haber
  ) ORDER BY a.fecha), '[]'::jsonb)
  FROM asientos_partidas p
  JOIN asientos_contables a ON a.id = p.asiento_id
  JOIN cuentas_contables c ON c.id = p.cuenta_id
  CROSS JOIN rango r
  WHERE c.codigo LIKE '104%'
    AND a.fecha BETWEEN r.desde AND r.hasta
    AND a.estado <> 'anulado'
    AND (p.debe > 0 OR p.haber > 0)
    AND NOT EXISTS (SELECT 1 FROM banco_movimientos bm WHERE bm.partida_id = p.id);
$$;

GRANT EXECUTE ON FUNCTION partidas_banco_sin_conciliar TO authenticated;

-- ── 5. RLS
ALTER TABLE conciliaciones_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE banco_movimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY conc_read ON conciliaciones_bancarias FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY conc_write ON conciliaciones_bancarias FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY bm_read ON banco_movimientos FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY bm_write ON banco_movimientos FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
