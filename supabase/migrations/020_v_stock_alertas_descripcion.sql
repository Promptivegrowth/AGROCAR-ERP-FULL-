-- =============================================================================
-- Migración 020: Recrear v_stock_alertas con campo descripcion
-- -----------------------------------------------------------------------------
-- El campo "descripcion" del producto contiene el nombre comercial específico
-- (ej: "CHORIZO PARRILLERO X 500GR.CERDEÑA"). Se agrega a la vista para que
-- las alertas y notificaciones muestren el nombre comercial en lugar del
-- nombre genérico (ej: "CHORIZOS").
-- =============================================================================

DROP VIEW IF EXISTS v_stock_alertas;

CREATE VIEW v_stock_alertas AS
SELECT
  p.id,
  p.codigo,
  p.nombre,
  p.descripcion,
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

GRANT SELECT ON v_stock_alertas TO authenticated, anon;

COMMENT ON VIEW v_stock_alertas IS
  'Productos activos con su estado de stock calculado (bajo_minimo, cerca_minimo, sobrestock, ok). Incluye nombre y descripcion para mostrar el nombre comercial en notificaciones.';
