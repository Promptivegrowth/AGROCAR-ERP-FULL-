-- =============================================================================
-- Migración 011: Rediseño de Despacho (peso, capacidad obligatoria, hoja de ruta)
-- -----------------------------------------------------------------------------
-- Cambios:
-- 1. productos.peso_kg NUMERIC(10,3) — peso unitario en kg (independiente UM)
-- 2. Vista v_pedidos_con_peso — calcula peso total de cada pedido
-- 3. vehiculos.capacidad_kg NOT NULL (default 500 para legacy vacíos)
-- 4. despachos.hoja_ruta_emitida_at, despachos.orden_entrega JSONB
--    (guarda el orden optimizado de entrega al consolidar)
-- 5. Configuración de almacén (claves: almacen_lat, almacen_lng, almacen_nombre,
--    almacen_direccion) para punto de partida del TSP
-- =============================================================================

-- 1. Agregar peso_kg a productos (default 0; UI mostrará warning)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(10,3) NOT NULL DEFAULT 0;
COMMENT ON COLUMN productos.peso_kg IS
  'Peso unitario en kg (independiente de la unidad de venta). Se usa para calcular peso total del pedido y validar capacidad del vehículo en despacho.';

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_peso_positive;
ALTER TABLE productos ADD CONSTRAINT productos_peso_positive CHECK (peso_kg >= 0);

-- 2. Vista con peso total calculado por pedido
CREATE OR REPLACE VIEW v_pedidos_con_peso AS
SELECT
  p.id AS pedido_id,
  p.numero,
  p.cliente_id,
  p.vendedor_id,
  p.estado,
  p.total,
  p.fecha_pedido,
  p.fecha_despacho,
  COALESCE(SUM(pi.cantidad * pr.peso_kg), 0) AS peso_total_kg,
  COUNT(pi.id) AS items_count,
  BOOL_OR(pr.peso_kg = 0) AS tiene_productos_sin_peso
FROM pedidos p
LEFT JOIN pedidos_items pi ON pi.pedido_id = p.id
LEFT JOIN productos pr ON pr.id = pi.producto_id
GROUP BY p.id;

COMMENT ON VIEW v_pedidos_con_peso IS
  'Resumen de pedidos con peso total calculado. tiene_productos_sin_peso=true cuando algún ítem tiene peso_kg=0 (requiere configurar).';

-- 3. Hacer capacidad_kg obligatoria en vehículos
-- Backfill primero: vehículos sin capacidad reciben 500 kg como default temporal
UPDATE vehiculos SET capacidad_kg = 500 WHERE capacidad_kg IS NULL;

ALTER TABLE vehiculos ALTER COLUMN capacidad_kg SET NOT NULL;
ALTER TABLE vehiculos ALTER COLUMN capacidad_kg SET DEFAULT 500;

ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS vehiculos_capacidad_positive;
ALTER TABLE vehiculos ADD CONSTRAINT vehiculos_capacidad_positive CHECK (capacidad_kg > 0);

-- 4. Columnas nuevas en despachos
ALTER TABLE despachos ADD COLUMN IF NOT EXISTS hoja_ruta_emitida_at TIMESTAMPTZ;
ALTER TABLE despachos ADD COLUMN IF NOT EXISTS orden_entrega JSONB;
ALTER TABLE despachos ADD COLUMN IF NOT EXISTS peso_total_kg NUMERIC(12,3) NOT NULL DEFAULT 0;

COMMENT ON COLUMN despachos.orden_entrega IS
  'Array JSON con el orden de entrega optimizado: [{"pedido_id":"uuid","secuencia":1,"distancia_km":2.4}, ...]';
COMMENT ON COLUMN despachos.hoja_ruta_emitida_at IS
  'Fecha-hora de emisión/consolidación de la hoja de ruta. NULL = aún no consolidado.';
COMMENT ON COLUMN despachos.peso_total_kg IS
  'Peso total consolidado del despacho en kg (snapshot al momento de consolidar).';

-- 5. Configuración del almacén (punto de partida para optimización de rutas)
-- La tabla configuracion usa formato clave/valor. Insertamos claves default.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('almacen_nombre',    'AGROCAR - Almacén Central', 'Nombre del almacén principal (punto de partida de rutas de despacho)'),
  ('almacen_direccion', '',                          'Dirección del almacén principal'),
  ('almacen_lat',       '-18.01465',                 'Latitud del almacén (centro de Tacna por defecto)'),
  ('almacen_lng',       '-70.25362',                 'Longitud del almacén (centro de Tacna por defecto)')
ON CONFLICT (clave) DO NOTHING;

-- 6. Índices útiles
CREATE INDEX IF NOT EXISTS idx_despachos_fecha ON despachos(fecha_despacho DESC);
CREATE INDEX IF NOT EXISTS idx_despachos_vehiculo ON despachos(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_productos_peso_cero ON productos(peso_kg) WHERE peso_kg = 0;
