-- =============================================================================
-- Migración: alinear ENUM estado_cliente + auto-crear stock al crear producto
-- =============================================================================

-- 1. Agregar valores que el código espera (no rompe los existentes)
ALTER TYPE estado_cliente ADD VALUE IF NOT EXISTS 'suspendido';
ALTER TYPE estado_cliente ADD VALUE IF NOT EXISTS 'bloqueado';

-- 2. Trigger: al crear un producto, crear automáticamente su fila de stock con cantidad 0
CREATE OR REPLACE FUNCTION crear_stock_al_crear_producto()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stock (producto_id, cantidad, cantidad_reservada, costo_promedio)
  VALUES (NEW.id, 0, 0, 0)
  ON CONFLICT (producto_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_crear_stock_producto ON productos;
CREATE TRIGGER trg_crear_stock_producto
  AFTER INSERT ON productos
  FOR EACH ROW
  EXECUTE FUNCTION crear_stock_al_crear_producto();

-- 3. Crear filas de stock para productos ya existentes que no tienen
INSERT INTO stock (producto_id, cantidad, cantidad_reservada, costo_promedio)
SELECT p.id, 0, 0, 0
FROM productos p
LEFT JOIN stock s ON s.producto_id = p.id
WHERE s.id IS NULL;

-- 4. (Informativo) los valores 'inactivo' y 'de_baja' del ENUM se mantienen por
-- compatibilidad con datos históricos. El UI nuevo usa 'activo'|'suspendido'|'bloqueado'.
