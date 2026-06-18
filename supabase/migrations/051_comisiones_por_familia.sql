-- ─────────────────────────────────────────────────────────────────────────────
-- 051: Comisiones por FAMILIA de producto (no tasa única por vendedor)
--
-- Daniel pidió que cada familia tenga su propia tasa de comisión configurable.
-- El esquema YA soportaba esto (comisiones_reglas.familia_id existía), pero
-- el cálculo en el frontend lo ignoraba y siempre usaba una sola regla por
-- vendedor.
--
-- Cambios:
-- 1) Permitir múltiples reglas activas por vendedor (una por familia + una
--    "global" sin familia como fallback).
-- 2) Agregar índice único parcial para evitar reglas duplicadas (vendedor,
--    familia) — un vendedor no debería tener 2 reglas activas para la misma
--    familia simultáneamente.
-- 3) Nueva tabla `liquidaciones_comision_detalle` para guardar el desglose
--    por familia en cada liquidación.
-- 4) RPC `calcular_comision_vendedor(p_vendedor_id, p_desde, p_hasta)` que
--    desglosa la comisión por familia. Para cada línea facturada, busca:
--    a) regla específica para vendedor + familia (mayor prioridad)
--    b) regla por familia sin vendedor (default de familia)
--    c) regla global del vendedor sin familia (fallback)
--    Si no hay regla aplicable, esa línea no genera comisión.
-- 5) RPC `comisiones_defaults_por_familia()` para listar configuración global.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Permitir varias reglas activas por vendedor (no estaba bloqueado, pero
--    aseguramos consistencia con índice único parcial)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_comisiones_reglas_activa
  ON comisiones_reglas (
    COALESCE(vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(familia_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE activo = TRUE;

COMMENT ON INDEX uniq_comisiones_reglas_activa IS
  'Una sola regla activa por (vendedor, familia). Permite vendedor NULL = default global, familia NULL = aplica a todas las familias.';

-- ── Tabla de detalle por familia en cada liquidación
CREATE TABLE IF NOT EXISTS liquidaciones_comision_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id UUID NOT NULL REFERENCES liquidaciones_comision(id) ON DELETE CASCADE,
  familia_id UUID REFERENCES familias(id) ON DELETE SET NULL,
  familia_nombre TEXT, -- snapshot por si se borra la familia
  monto_ventas NUMERIC(12, 2) NOT NULL DEFAULT 0,
  porcentaje NUMERIC(5, 2),
  monto_comision NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liq_detalle_liquidacion
  ON liquidaciones_comision_detalle (liquidacion_id);

COMMENT ON TABLE liquidaciones_comision_detalle IS
  'Desglose por familia de una liquidación de comisión. Permite ver de qué familia salió cada parte.';

-- ── RPC: calcular comisión de un vendedor desglosada por familia
-- Implementado con CTE en lugar de tabla temporal (incompatible con STABLE).
CREATE OR REPLACE FUNCTION calcular_comision_vendedor(
  p_vendedor_id UUID,
  p_desde DATE,
  p_hasta DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lineas_base AS (
    SELECT
      ci.id AS item_id,
      p.familia_id,
      f.nombre AS familia_nombre,
      ci.subtotal AS monto
    FROM comprobantes_items ci
    JOIN comprobantes c ON c.id = ci.comprobante_id
    LEFT JOIN pedidos pe ON pe.id = c.pedido_id
    LEFT JOIN productos p ON p.id = ci.producto_id
    LEFT JOIN familias f ON f.id = p.familia_id
    WHERE c.fecha_emision BETWEEN p_desde AND p_hasta
      AND c.estado <> 'anulado'
      AND pe.vendedor_id = p_vendedor_id
  ),
  lineas_con_regla AS (
    SELECT
      l.*,
      COALESCE(
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id = p_vendedor_id AND familia_id = l.familia_id AND activo
          ORDER BY created_at DESC LIMIT 1),
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id = p_vendedor_id AND familia_id IS NULL AND activo
          ORDER BY created_at DESC LIMIT 1),
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id IS NULL AND familia_id = l.familia_id AND activo
          ORDER BY created_at DESC LIMIT 1),
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id IS NULL AND familia_id IS NULL AND activo
          ORDER BY created_at DESC LIMIT 1)
      ) AS regla_id
    FROM lineas_base l
  ),
  lineas_completas AS (
    SELECT
      l.*,
      r.porcentaje
    FROM lineas_con_regla l
    LEFT JOIN comisiones_reglas r ON r.id = l.regla_id
  ),
  por_familia AS (
    SELECT
      familia_id,
      familia_nombre,
      SUM(monto) AS monto_familia,
      AVG(porcentaje) AS porcentaje_prom,
      ROUND(COALESCE(SUM(monto * porcentaje) / 100, 0), 2) AS comision_familia,
      BOOL_OR(regla_id IS NOT NULL) AS tiene_regla
    FROM lineas_completas
    GROUP BY familia_id, familia_nombre
  )
  SELECT jsonb_build_object(
    'vendedor_id', p_vendedor_id,
    'desde', p_desde,
    'hasta', p_hasta,
    'total_ventas', COALESCE((SELECT SUM(monto) FROM lineas_base), 0),
    'total_comision', COALESCE((
      SELECT ROUND(SUM(monto * COALESCE(porcentaje, 0)) / 100, 2)
      FROM lineas_completas WHERE regla_id IS NOT NULL
    ), 0),
    'lineas_sin_regla', (SELECT COUNT(*) FROM lineas_completas WHERE regla_id IS NULL),
    'monto_sin_regla', COALESCE(
      (SELECT SUM(monto) FROM lineas_completas WHERE regla_id IS NULL), 0),
    'desglose', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'familia_id', familia_id,
        'familia_nombre', COALESCE(familia_nombre, '— Sin familia —'),
        'monto_ventas', monto_familia,
        'porcentaje_promedio', porcentaje_prom,
        'monto_comision', comision_familia,
        'tiene_regla', tiene_regla
      ) ORDER BY monto_familia DESC)
      FROM por_familia
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION calcular_comision_vendedor IS
  'Calcula la comisión de un vendedor desglosada por familia. Para cada línea facturada, busca la regla más específica aplicable (vendedor+familia > vendedor solo > familia sola > regla global).';

GRANT EXECUTE ON FUNCTION calcular_comision_vendedor TO authenticated;


-- ── RPC: lista las reglas "default" por familia (sin vendedor específico)
CREATE OR REPLACE FUNCTION comisiones_defaults_por_familia()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'familia_id', f.id,
    'familia_nombre', f.nombre,
    'regla_id', r.id,
    'porcentaje', r.porcentaje,
    'monto_fijo', r.monto_fijo,
    'tiene_regla', r.id IS NOT NULL
  ) ORDER BY f.nombre), '[]'::jsonb)
  FROM familias f
  LEFT JOIN comisiones_reglas r
    ON r.familia_id = f.id AND r.vendedor_id IS NULL AND r.activo = TRUE
  WHERE f.activo = TRUE;
$$;

GRANT EXECUTE ON FUNCTION comisiones_defaults_por_familia TO authenticated;
