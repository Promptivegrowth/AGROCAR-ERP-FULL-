-- Migración 008: descuento automático de stock y lotes al ENTREGAR un pedido

CREATE OR REPLACE FUNCTION descontar_stock_al_entregar()
RETURNS TRIGGER AS $$
DECLARE
  item RECORD;
  movimiento_id UUID;
BEGIN
  -- Solo actuar cuando el estado CAMBIA a 'entregado' (no en cada update)
  IF NEW.estado = 'entregado' AND (OLD.estado IS NULL OR OLD.estado <> 'entregado') THEN

    FOR item IN
      SELECT pi.id, pi.producto_id, pi.cantidad, pi.lote_id, pi.precio_unitario
      FROM pedidos_items pi
      WHERE pi.pedido_id = NEW.id
    LOOP
      -- 1. Descontar del lote específico (si hay lote asignado)
      IF item.lote_id IS NOT NULL THEN
        UPDATE lotes
        SET cantidad_actual = GREATEST(0, cantidad_actual - item.cantidad),
            updated_at = NOW()
        WHERE id = item.lote_id;
      END IF;

      -- 2. Descontar del stock global del producto
      UPDATE stock
      SET cantidad = GREATEST(0, cantidad - item.cantidad),
          updated_at = NOW()
      WHERE producto_id = item.producto_id;

      -- 3. Registrar movimiento de stock de tipo 'salida'
      INSERT INTO movimientos_stock (
        producto_id, lote_id, tipo, cantidad, costo_unitario,
        referencia_tipo, referencia_id, notas, created_at
      ) VALUES (
        item.producto_id, item.lote_id, 'salida', item.cantidad, item.precio_unitario,
        'pedido', NEW.id,
        'Salida automática por entrega de pedido ' || NEW.numero,
        NOW()
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_descontar_stock_entrega ON pedidos;
CREATE TRIGGER trg_descontar_stock_entrega
  AFTER UPDATE OF estado ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION descontar_stock_al_entregar();

COMMENT ON FUNCTION descontar_stock_al_entregar() IS
  'Al marcar un pedido como entregado, descuenta la cantidad de cada item del stock general y del lote asignado, y crea un movimiento_stock de tipo salida.';
