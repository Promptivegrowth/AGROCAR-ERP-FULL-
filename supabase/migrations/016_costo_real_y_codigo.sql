-- =============================================================================
-- Migración 016: costos reales + utilidad calculada + código de vendedor
-- =============================================================================

-- 1. Costo promedio en productos (actualizado al recibir compras)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_promedio NUMERIC(12,4);
COMMENT ON COLUMN productos.costo_promedio IS
  'Costo promedio ponderado del producto. Actualizado automáticamente al registrar compras.';

-- 2. Snapshot del costo en cada venta para calcular utilidad real
ALTER TABLE pedidos_items ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(12,4);
ALTER TABLE pedidos_items ADD COLUMN IF NOT EXISTS utilidad        NUMERIC(12,2);

COMMENT ON COLUMN pedidos_items.costo_unitario IS
  'Snapshot del costo del producto al momento de la venta (heredado de productos.costo_promedio).';
COMMENT ON COLUMN pedidos_items.utilidad IS
  'Utilidad de la línea: subtotal - (cantidad * costo_unitario).';

-- 3. Trigger: al insertar/actualizar compras_items, recalcular costo_promedio del producto
-- Promedio ponderado: (stock_actual * costo_anterior + cantidad_compra * precio_compra) / (stock_actual + cantidad_compra)
CREATE OR REPLACE FUNCTION actualizar_costo_promedio_producto()
RETURNS TRIGGER AS $$
DECLARE
  v_stock_actual NUMERIC := 0;
  v_costo_anterior NUMERIC := 0;
  v_nuevo_costo NUMERIC;
BEGIN
  -- Stock actual del producto (de la tabla stock o sumando lotes)
  SELECT COALESCE(cantidad, 0) INTO v_stock_actual FROM stock WHERE producto_id = NEW.producto_id LIMIT 1;
  -- Costo anterior
  SELECT COALESCE(costo_promedio, 0) INTO v_costo_anterior FROM productos WHERE id = NEW.producto_id;

  IF v_stock_actual + NEW.cantidad > 0 THEN
    v_nuevo_costo := (v_stock_actual * v_costo_anterior + NEW.cantidad * NEW.precio_unitario)
                     / (v_stock_actual + NEW.cantidad);
  ELSE
    v_nuevo_costo := NEW.precio_unitario;
  END IF;

  UPDATE productos SET costo_promedio = v_nuevo_costo WHERE id = NEW.producto_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_costo_compras ON compras_items;
CREATE TRIGGER trg_actualizar_costo_compras
  AFTER INSERT ON compras_items
  FOR EACH ROW
  EXECUTE FUNCTION actualizar_costo_promedio_producto();

-- 4. Trigger: al insertar pedidos_items, capturar costo_unitario y calcular utilidad
CREATE OR REPLACE FUNCTION snapshot_costo_y_utilidad_pedido()
RETURNS TRIGGER AS $$
DECLARE
  v_costo NUMERIC;
BEGIN
  -- Si no se especificó costo_unitario, tomar del producto
  IF NEW.costo_unitario IS NULL THEN
    SELECT COALESCE(costo_promedio, 0) INTO v_costo FROM productos WHERE id = NEW.producto_id;
    NEW.costo_unitario := v_costo;
  END IF;

  -- Calcular utilidad
  NEW.utilidad := COALESCE(NEW.subtotal, 0) - (NEW.cantidad * COALESCE(NEW.costo_unitario, 0));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_costo_pedido ON pedidos_items;
CREATE TRIGGER trg_snapshot_costo_pedido
  BEFORE INSERT ON pedidos_items
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_costo_y_utilidad_pedido();

-- 5. Vista de ventas con utilidad real
CREATE OR REPLACE VIEW v_ventas_con_utilidad AS
SELECT
  p.id AS pedido_id,
  p.numero,
  p.fecha_pedido,
  p.estado,
  p.cliente_id,
  p.vendedor_id,
  p.total AS total_venta,
  p.subtotal AS subtotal_venta,
  COALESCE(SUM(pi.cantidad * pi.costo_unitario), 0) AS costo_total,
  COALESCE(SUM(pi.utilidad), 0) AS utilidad_total,
  CASE
    WHEN p.subtotal > 0 THEN (COALESCE(SUM(pi.utilidad), 0) / p.subtotal) * 100
    ELSE 0
  END AS margen_pct
FROM pedidos p
LEFT JOIN pedidos_items pi ON pi.pedido_id = p.id
GROUP BY p.id;

COMMENT ON VIEW v_ventas_con_utilidad IS
  'Ventas con utilidad y margen real calculado a partir de costo_unitario por línea.';

-- 6. Código de vendedor (3 dígitos opcional para hoja de ruta simple y exports)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_codigo_unique;
ALTER TABLE profiles ADD CONSTRAINT profiles_codigo_unique UNIQUE (codigo);

COMMENT ON COLUMN profiles.codigo IS
  'Código corto del usuario (ej: 001, V01) usado en hoja de ruta simple y reportes Excel. Solo identificador visual.';
