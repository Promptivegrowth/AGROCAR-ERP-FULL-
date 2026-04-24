-- =============================================================================
-- Migración 014: tabla cuotas_producto + vista cobranzas_status
-- =============================================================================

-- 1. Cuotas por producto (cantidad y valor por mes y vendedor)
CREATE TABLE IF NOT EXISTS cuotas_producto (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  producto_id  UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  anio         INTEGER NOT NULL,
  mes          INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  cant_cuota   NUMERIC(12,3) NOT NULL DEFAULT 0,
  valor_cuota  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vendedor_id, producto_id, anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_cuotas_producto_periodo ON cuotas_producto(anio, mes);
CREATE INDEX IF NOT EXISTS idx_cuotas_producto_vendedor ON cuotas_producto(vendedor_id);

ALTER TABLE cuotas_producto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cuotas_producto_select" ON cuotas_producto;
CREATE POLICY "cuotas_producto_select" ON cuotas_producto
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "cuotas_producto_write" ON cuotas_producto;
CREATE POLICY "cuotas_producto_write" ON cuotas_producto
  FOR ALL USING (has_role('gerente', 'administrador'));

CREATE TRIGGER set_cuotas_producto_updated_at
  BEFORE UPDATE ON cuotas_producto
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Vista cobranzas_status: calcula estado pago/por_vencer/vencido por comprobante
CREATE OR REPLACE VIEW v_cobranzas_status AS
SELECT
  c.id AS comprobante_id,
  c.tipo,
  c.serie,
  c.numero,
  c.fecha_emision,
  c.fecha_vencimiento,
  c.total,
  c.cliente_id,
  cli.razon_social AS cliente,
  cli.zona_id,
  z.nombre AS zona_nombre,
  COALESCE(cob_sum.cobrado, 0) AS cobrado,
  c.total - COALESCE(cob_sum.cobrado, 0) AS saldo,
  cli.credito_dias AS dias_credito,
  (CURRENT_DATE - c.fecha_emision)::int AS dias_transcurridos,
  CASE
    WHEN COALESCE(cob_sum.cobrado, 0) >= c.total THEN 'pago'
    WHEN c.fecha_vencimiento IS NOT NULL AND c.fecha_vencimiento < CURRENT_DATE THEN 'vencido'
    WHEN c.fecha_emision + (cli.credito_dias || ' days')::interval < CURRENT_DATE AND cli.credito_dias > 0 THEN 'vencido'
    ELSE 'por_vencer'
  END AS status
FROM comprobantes c
JOIN clientes cli ON cli.id = c.cliente_id
LEFT JOIN zonas z ON z.id = cli.zona_id
LEFT JOIN (
  SELECT referencia_id AS comprobante_id, SUM(total) AS cobrado
  FROM cobros
  WHERE tipo = 'venta'
  GROUP BY referencia_id
) cob_sum ON cob_sum.comprobante_id = c.id
WHERE c.estado != 'anulado';

COMMENT ON VIEW v_cobranzas_status IS
  'Resumen de cobranzas con status calculado: pago (cobrado>=total), vencido (fecha_vencimiento<hoy), por_vencer (resto).';

-- 3. Columna numero en ordenes_compra (si no existe)
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS incluir_igv BOOLEAN NOT NULL DEFAULT TRUE;
