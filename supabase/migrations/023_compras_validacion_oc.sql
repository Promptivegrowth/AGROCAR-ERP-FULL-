-- Migración 023: Validación de OC + edición de cantidades en compras + NC contable
-- (Requerimiento D)
--
-- Cambia el flujo de compras de "una sola etapa" (al registrar ya impacta
-- stock/lotes) a tres etapas explícitas:
--
--   registrada → recibida → aplicada
--                                   ↘ anulado (en cualquier momento)
--
-- Solo en estado 'aplicada' se descuenta stock, actualiza lotes,
-- registra movimientos_stock y se calcula el costo promedio.
-- Esto permite editar cantidades de la factura antes de impactar almacén
-- y registrar la cantidad físicamente recibida (que puede diferir).
-- Si hay diferencia entre lo facturado y lo recibido, se genera
-- automáticamente una NOTA DE CRÉDITO DE COMPRA contable.

-- ────────────────────────────────────────────────────────────────────────
-- 1. Compras: nuevo CHECK de estado
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE compras DROP CONSTRAINT IF EXISTS compras_estado_check;
ALTER TABLE compras ADD CONSTRAINT compras_estado_check
  CHECK (estado IN ('registrada', 'recibida', 'aplicada', 'anulado'));

-- Default ahora es 'registrada' (antes 'activo')
ALTER TABLE compras ALTER COLUMN estado SET DEFAULT 'registrada';

-- ────────────────────────────────────────────────────────────────────────
-- 2. compras_items: cantidad_recibida (puede diferir de cantidad facturada)
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE compras_items ADD COLUMN IF NOT EXISTS cantidad_recibida NUMERIC(12,3);
ALTER TABLE compras_items ADD COLUMN IF NOT EXISTS lote_numero TEXT;
ALTER TABLE compras_items ADD COLUMN IF NOT EXISTS lote_fecha_vencimiento DATE;

COMMENT ON COLUMN compras_items.cantidad IS 'Cantidad según factura del proveedor';
COMMENT ON COLUMN compras_items.cantidad_recibida IS
  'Cantidad realmente recibida en almacén. Si NULL, aún no validada. Si difiere de cantidad, genera nota de crédito automática al aplicar.';
COMMENT ON COLUMN compras_items.lote_numero IS
  'Número de lote (texto, no FK aún). El lote real se crea al aplicar la compra.';

-- ────────────────────────────────────────────────────────────────────────
-- 3. Tabla notas_credito_compras
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notas_credito_compras (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  compra_id       UUID NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  numero          TEXT NOT NULL,
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo          TEXT NOT NULL DEFAULT 'Diferencia entre factura y mercadería recibida',
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  igv             NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda          moneda NOT NULL DEFAULT 'PEN',
  estado          TEXT NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida', 'anulada')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE notas_credito_compras IS
  'Notas de crédito recibidas del proveedor por diferencias entre lo facturado y lo recibido. Se generan automáticamente al aplicar una compra con cantidades menores a las facturadas.';

CREATE INDEX IF NOT EXISTS idx_ncc_compra ON notas_credito_compras(compra_id);
CREATE INDEX IF NOT EXISTS idx_ncc_proveedor ON notas_credito_compras(proveedor_id);

CREATE TABLE IF NOT EXISTS notas_credito_compras_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nota_credito_id   UUID NOT NULL REFERENCES notas_credito_compras(id) ON DELETE CASCADE,
  compra_item_id    UUID NOT NULL REFERENCES compras_items(id) ON DELETE CASCADE,
  producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad          NUMERIC(12,3) NOT NULL,
  precio_unitario   NUMERIC(12,4) NOT NULL,
  subtotal          NUMERIC(12,2) NOT NULL,

  CONSTRAINT ncc_items_cantidad_positive CHECK (cantidad > 0)
);

COMMENT ON TABLE notas_credito_compras_items IS
  'Líneas de la NC: cantidad = (cantidad facturada - cantidad recibida) por producto.';

-- ────────────────────────────────────────────────────────────────────────
-- 4. RLS para las nuevas tablas
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE notas_credito_compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_credito_compras_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ncc_select_all" ON notas_credito_compras;
CREATE POLICY "ncc_select_all" ON notas_credito_compras
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "ncc_write_admin_almacen" ON notas_credito_compras;
CREATE POLICY "ncc_write_admin_almacen" ON notas_credito_compras
  FOR ALL USING (has_role(VARIADIC ARRAY['gerente', 'administrador', 'almacenero']));

DROP POLICY IF EXISTS "ncc_items_select_all" ON notas_credito_compras_items;
CREATE POLICY "ncc_items_select_all" ON notas_credito_compras_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "ncc_items_write_admin_almacen" ON notas_credito_compras_items;
CREATE POLICY "ncc_items_write_admin_almacen" ON notas_credito_compras_items
  FOR ALL USING (has_role(VARIADIC ARRAY['gerente', 'administrador', 'almacenero']));
