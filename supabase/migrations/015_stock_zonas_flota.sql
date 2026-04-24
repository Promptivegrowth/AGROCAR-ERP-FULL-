-- =============================================================================
-- Migración 015: stock min/max, zonas geográficas, tiempos de flota
-- =============================================================================

-- 1. Stock min/max en productos (opcional para alertas predictivas)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12,3);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_maximo NUMERIC(12,3);
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_stock_min_max;
ALTER TABLE productos ADD CONSTRAINT productos_stock_min_max CHECK (
  stock_minimo IS NULL OR stock_minimo >= 0
);
ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_stock_max_range;
ALTER TABLE productos ADD CONSTRAINT productos_stock_max_range CHECK (
  stock_maximo IS NULL OR (stock_maximo >= COALESCE(stock_minimo, 0))
);

COMMENT ON COLUMN productos.stock_minimo IS
  'Stock mínimo de alerta. Si stock actual < min, el sistema genera alerta de reposición.';
COMMENT ON COLUMN productos.stock_maximo IS
  'Stock máximo sugerido. Si stock actual > max, genera alerta de sobrestock.';

-- 2. Zonas geográficas (centro + radio + descripción ampliada + referencias)
ALTER TABLE zonas ADD COLUMN IF NOT EXISTS centro_lat   DOUBLE PRECISION;
ALTER TABLE zonas ADD COLUMN IF NOT EXISTS centro_lng   DOUBLE PRECISION;
ALTER TABLE zonas ADD COLUMN IF NOT EXISTS radio_km     NUMERIC(6,2);
ALTER TABLE zonas ADD COLUMN IF NOT EXISTS referencias  TEXT;
ALTER TABLE zonas ADD COLUMN IF NOT EXISTS color_hex    TEXT;

COMMENT ON COLUMN zonas.centro_lat IS 'Latitud del centro de la zona (para visualización y cálculo de clientes dentro)';
COMMENT ON COLUMN zonas.centro_lng IS 'Longitud del centro';
COMMENT ON COLUMN zonas.radio_km IS 'Radio en kilómetros del círculo de cobertura';
COMMENT ON COLUMN zonas.referencias IS 'Referencias textuales: calles, landmarks, límites conocidos';
COMMENT ON COLUMN zonas.color_hex IS 'Color hex para distinguir la zona en mapas (#RRGGBB)';

-- 3. Tiempos de flota en despachos
ALTER TABLE despachos ADD COLUMN IF NOT EXISTS hora_salida      TIMESTAMPTZ;
ALTER TABLE despachos ADD COLUMN IF NOT EXISTS hora_retorno     TIMESTAMPTZ;
ALTER TABLE despachos ADD COLUMN IF NOT EXISTS duracion_minutos INTEGER;
ALTER TABLE despachos ADD COLUMN IF NOT EXISTS km_recorridos    NUMERIC(8,2);

COMMENT ON COLUMN despachos.hora_salida IS 'Fecha-hora de salida del vehículo del almacén';
COMMENT ON COLUMN despachos.hora_retorno IS 'Fecha-hora de retorno al almacén';
COMMENT ON COLUMN despachos.duracion_minutos IS 'Duración total del recorrido en minutos (auto-calculable)';
COMMENT ON COLUMN despachos.km_recorridos IS 'Kilometraje recorrido (ingreso manual del chofer)';

-- 4. Vista de flota en vivo: despachos en curso con métricas
CREATE OR REPLACE VIEW v_flota_en_vivo AS
SELECT
  d.id,
  d.numero,
  d.fecha_despacho,
  d.estado,
  d.hora_salida,
  d.hora_retorno,
  d.duracion_minutos,
  d.km_recorridos,
  d.total_pedidos,
  d.total_monto,
  d.peso_total_kg,
  v.placa,
  v.descripcion AS vehiculo_descripcion,
  v.tipo AS vehiculo_tipo,
  v.capacidad_kg,
  COALESCE(di_stats.entregados, 0) AS pedidos_entregados,
  COALESCE(di_stats.pendientes, 0) AS pedidos_pendientes,
  CASE
    WHEN d.hora_salida IS NOT NULL AND d.hora_retorno IS NULL
      THEN EXTRACT(EPOCH FROM (NOW() - d.hora_salida)) / 60
    WHEN d.hora_salida IS NOT NULL AND d.hora_retorno IS NOT NULL
      THEN EXTRACT(EPOCH FROM (d.hora_retorno - d.hora_salida)) / 60
    ELSE NULL
  END AS minutos_transcurridos
FROM despachos d
LEFT JOIN vehiculos v ON v.id = d.vehiculo_id
LEFT JOIN (
  SELECT despacho_id,
    COUNT(*) FILTER (WHERE estado = 'entregado') AS entregados,
    COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes
  FROM despachos_items
  GROUP BY despacho_id
) di_stats ON di_stats.despacho_id = d.id;

COMMENT ON VIEW v_flota_en_vivo IS
  'Vista de despachos con tiempos y conteos de entregas para monitoreo de flota en tiempo real.';

-- 5. Vista de productos con alerta de stock
CREATE OR REPLACE VIEW v_stock_alertas AS
SELECT
  p.id,
  p.codigo,
  p.nombre,
  p.familia_id,
  p.activo,
  p.stock_minimo,
  p.stock_maximo,
  COALESCE(s.cantidad, 0) AS stock_actual,
  CASE
    WHEN p.stock_minimo IS NOT NULL AND COALESCE(s.cantidad, 0) < p.stock_minimo THEN 'bajo_minimo'
    WHEN p.stock_maximo IS NOT NULL AND COALESCE(s.cantidad, 0) > p.stock_maximo THEN 'sobrestock'
    WHEN p.stock_minimo IS NOT NULL AND COALESCE(s.cantidad, 0) < p.stock_minimo * 1.2 THEN 'cerca_minimo'
    ELSE 'ok'
  END AS estado_stock,
  CASE
    WHEN p.stock_minimo IS NOT NULL AND p.stock_maximo IS NOT NULL
      THEN p.stock_maximo - COALESCE(s.cantidad, 0)
    ELSE NULL
  END AS cantidad_reorden_sugerida
FROM productos p
LEFT JOIN (
  SELECT producto_id, SUM(cantidad_actual) AS cantidad
  FROM lotes
  WHERE activo = TRUE AND cantidad_actual > 0
  GROUP BY producto_id
) s ON s.producto_id = p.id
WHERE p.activo = TRUE;

-- 6. Backfill: asignar coordenadas aproximadas a las zonas demo (Tacna)
UPDATE zonas SET
  centro_lat = -18.005 + (random() - 0.5) * 0.04,
  centro_lng = -70.250 + (random() - 0.5) * 0.04,
  radio_km = 1.5,
  color_hex = CASE (EXTRACT(EPOCH FROM created_at)::bigint % 8)
    WHEN 0 THEN '#2563eb' WHEN 1 THEN '#dc2626' WHEN 2 THEN '#16a34a' WHEN 3 THEN '#ea580c'
    WHEN 4 THEN '#7c3aed' WHEN 5 THEN '#0891b2' WHEN 6 THEN '#db2777' ELSE '#65a30d'
  END
WHERE centro_lat IS NULL;
