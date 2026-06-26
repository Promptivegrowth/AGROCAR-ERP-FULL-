-- ─────────────────────────────────────────────────────────────────────────────
-- 057: Cuotas mensuales por vendedor × familia + reporte de cumplimiento
--
-- Daniel asigna un objetivo de venta mensual por vendedor y familia (ej:
-- vendedor Juan, familia Embutidos, mes 2026-06 = S/ 12,000). El sistema
-- compara contra ventas reales (subtotal de comprobantes_items no anulados)
-- y muestra % de cumplimiento.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cuotas_vendedor_familia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  familia_id UUID NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  anio INT NOT NULL CHECK (anio BETWEEN 2024 AND 2100),
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  cuota_monto NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cuota_monto >= 0),
  notas TEXT,
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_cuota_vendedor_familia_mes UNIQUE (vendedor_id, familia_id, anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_cuotas_periodo ON cuotas_vendedor_familia (anio, mes);
CREATE INDEX IF NOT EXISTS idx_cuotas_vendedor ON cuotas_vendedor_familia (vendedor_id);

COMMENT ON TABLE cuotas_vendedor_familia IS
  'Cuota objetivo mensual de venta por vendedor y familia de productos. Subtotal sin IGV.';

-- ── RPC: upsert masivo de cuotas (matriz de un mes)
-- Recibe un array de {vendedor_id, familia_id, cuota_monto} y los guarda
CREATE OR REPLACE FUNCTION upsert_cuotas_mes(
  p_anio INT,
  p_mes INT,
  p_cuotas JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_item JSONB;
  v_count INT := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF v_profile.role NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo admin/gerente pueden asignar cuotas';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cuotas) LOOP
    INSERT INTO cuotas_vendedor_familia (
      vendedor_id, familia_id, anio, mes, cuota_monto, created_by, updated_by
    ) VALUES (
      (v_item->>'vendedor_id')::UUID,
      (v_item->>'familia_id')::UUID,
      p_anio, p_mes,
      COALESCE((v_item->>'cuota_monto')::NUMERIC, 0),
      v_user_id, v_user_id
    )
    ON CONFLICT (vendedor_id, familia_id, anio, mes) DO UPDATE
      SET cuota_monto = EXCLUDED.cuota_monto,
          updated_by = v_user_id,
          updated_at = NOW();
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_cuotas_mes TO authenticated;

-- ── RPC: copiar cuotas del mes anterior
CREATE OR REPLACE FUNCTION copiar_cuotas_mes_anterior(p_anio INT, p_mes INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_anio_ant INT;
  v_mes_ant INT;
  v_count INT;
BEGIN
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF v_profile.role NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo admin/gerente pueden copiar cuotas';
  END IF;

  -- Calcular mes anterior
  IF p_mes = 1 THEN
    v_anio_ant := p_anio - 1; v_mes_ant := 12;
  ELSE
    v_anio_ant := p_anio; v_mes_ant := p_mes - 1;
  END IF;

  INSERT INTO cuotas_vendedor_familia (
    vendedor_id, familia_id, anio, mes, cuota_monto, created_by, updated_by
  )
  SELECT vendedor_id, familia_id, p_anio, p_mes, cuota_monto, v_user_id, v_user_id
  FROM cuotas_vendedor_familia
  WHERE anio = v_anio_ant AND mes = v_mes_ant
  ON CONFLICT (vendedor_id, familia_id, anio, mes) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION copiar_cuotas_mes_anterior TO authenticated;

-- ── RPC: reporte de cumplimiento (cuota vs vendido)
-- Devuelve por cada (vendedor, familia) en el mes:
--   cuota_monto, vendido_monto, pct_cumplimiento, diferencia
CREATE OR REPLACE FUNCTION cumplimiento_cuotas_mes(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rango AS (
    SELECT
      make_date(p_anio, p_mes, 1) AS desde,
      (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  ventas AS (
    -- Subtotal sin IGV vendido por (vendedor, familia) en el mes
    -- El vendedor viene del pedido vinculado al comprobante
    SELECT
      pe.vendedor_id,
      p.familia_id,
      COALESCE(SUM(ci.subtotal), 0) AS vendido_monto,
      COUNT(DISTINCT c.id) AS comprobantes
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    JOIN productos p ON p.id = ci.producto_id
    CROSS JOIN rango r
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND pe.vendedor_id IS NOT NULL
      AND p.familia_id IS NOT NULL
    GROUP BY pe.vendedor_id, p.familia_id
  ),
  matriz AS (
    SELECT
      v.id AS vendedor_id,
      COALESCE(v.full_name, v.email) AS vendedor_nombre,
      f.id AS familia_id,
      f.nombre AS familia_nombre,
      COALESCE(cu.cuota_monto, 0) AS cuota_monto,
      COALESCE(ve.vendido_monto, 0) AS vendido_monto,
      COALESCE(ve.comprobantes, 0) AS comprobantes
    FROM profiles v
    CROSS JOIN familias f
    LEFT JOIN cuotas_vendedor_familia cu
      ON cu.vendedor_id = v.id AND cu.familia_id = f.id
      AND cu.anio = p_anio AND cu.mes = p_mes
    LEFT JOIN ventas ve
      ON ve.vendedor_id = v.id AND ve.familia_id = f.id
    WHERE v.role = 'vendedor' AND COALESCE(v.activo, TRUE) = TRUE
  )
  SELECT jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'filas', COALESCE(jsonb_agg(jsonb_build_object(
      'vendedor_id', vendedor_id,
      'vendedor_nombre', vendedor_nombre,
      'familia_id', familia_id,
      'familia_nombre', familia_nombre,
      'cuota_monto', cuota_monto,
      'vendido_monto', vendido_monto,
      'comprobantes', comprobantes,
      'pct_cumplimiento', CASE WHEN cuota_monto > 0
        THEN ROUND((vendido_monto / cuota_monto) * 100, 1) ELSE NULL END,
      'diferencia', vendido_monto - cuota_monto
    ) ORDER BY vendedor_nombre, familia_nombre), '[]'::jsonb)
  ) FROM matriz;
$$;

GRANT EXECUTE ON FUNCTION cumplimiento_cuotas_mes TO authenticated;

-- RLS
ALTER TABLE cuotas_vendedor_familia ENABLE ROW LEVEL SECURITY;

CREATE POLICY cuotas_select ON cuotas_vendedor_familia FOR SELECT USING (TRUE);
CREATE POLICY cuotas_write ON cuotas_vendedor_familia FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente'])
);
