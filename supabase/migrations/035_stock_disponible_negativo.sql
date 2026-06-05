-- ─────────────────────────────────────────────────────────────────────────────
-- 035: Stock disponible puede ser negativo (visibilidad de reposición)
--
-- La vista v_stock_disponible_real usaba GREATEST(0, cantidad - reservada)
-- para que el "disponible" nunca fuera negativo. Eso ocultaba el hueco
-- generado por pedidos con force_reserva (override de Daniel: camión en
-- camino).
--
-- Ahora la vista expone el valor real (puede ser negativo). Cuando llega
-- la mercadería y se aplica la compra (aplicar_compra suma a stock.cantidad),
-- el disponible se restaura solo:
--
--   antes  : cantidad=0  reservada=50  disponible=-50
--   compra : +100 al cantidad
--   después: cantidad=100 reservada=50 disponible=+50  ✓
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_stock_disponible_real AS
SELECT
  s.producto_id,
  s.cantidad AS stock_fisico,
  s.cantidad_reservada AS stock_reservado,
  -- Sin GREATEST: el negativo es la señal de reposición pendiente.
  (s.cantidad - s.cantidad_reservada) AS stock_disponible,
  s.costo_promedio,
  s.updated_at
FROM stock s;

GRANT SELECT ON v_stock_disponible_real TO authenticated;

COMMENT ON VIEW v_stock_disponible_real IS
  'Stock disponible real (cantidad - reservada). Puede ser negativo si hay pedidos creados con override (requiere_reposicion). Se restaura automáticamente al aplicar la compra correspondiente.';
