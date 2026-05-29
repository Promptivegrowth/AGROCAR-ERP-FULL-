-- Migración 030: Stock con reserva atómica + descuento al despachar
--
-- Resuelve 3 problemas reportados por el cliente:
--
-- 1) Bug actual: el trigger descontar_stock_al_entregar solo se dispara
--    cuando un pedido pasa a 'entregado', pero la mayoría queda en
--    'despachado' y el stock nunca se descuenta (13 pedidos huérfanos
--    confirmados en BD).
--
-- 2) Race condition: si dos vendedores hacen pedido del mismo producto
--    al mismo tiempo, ambos pueden agotar stock que ya no existe porque
--    no había validación a nivel transaccional.
--
-- 3) Visibilidad de stock comprometido: el "Disponible" debería ser
--    cantidad - cantidad_reservada, no solo cantidad.
--
-- Modelo:
-- - Pedido CREADO ('enviado'): reserva atómica (cantidad_reservada +=)
-- - Pedido DESPACHADO: descuenta real (cantidad -=) y libera reserva
-- - Pedido CANCELADO: libera reserva
-- - Pedido ENTREGADO sin pasar por despachado (venta directa): descuenta

-- ────────────────────────────────────────────────────────────────────────
-- 1. Trigger AFTER INSERT en pedidos_items: reservar stock atómicamente
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reservar_stock_al_crear_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_disponible NUMERIC;
  v_nombre TEXT;
BEGIN
  -- UPDATE atómico que solo afecta si hay stock disponible (cantidad - reservada >= pedida)
  UPDATE stock
    SET cantidad_reservada = cantidad_reservada + NEW.cantidad,
        updated_at = NOW()
  WHERE producto_id = NEW.producto_id
    AND (cantidad - cantidad_reservada) >= NEW.cantidad;

  -- Si no se actualizó ninguna fila, lanzar excepción con mensaje claro
  IF NOT FOUND THEN
    SELECT COALESCE(descripcion, nombre), (cantidad - cantidad_reservada)
      INTO v_nombre, v_disponible
    FROM productos p
    LEFT JOIN stock s ON s.producto_id = p.id
    WHERE p.id = NEW.producto_id;

    RAISE EXCEPTION 'Stock insuficiente para "%": pediste % pero disponible %',
      COALESCE(v_nombre, NEW.producto_id::text),
      NEW.cantidad,
      COALESCE(v_disponible, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservar_stock_al_crear_item ON pedidos_items;
CREATE TRIGGER trg_reservar_stock_al_crear_item
  AFTER INSERT ON pedidos_items
  FOR EACH ROW
  EXECUTE FUNCTION reservar_stock_al_crear_item();

COMMENT ON FUNCTION reservar_stock_al_crear_item() IS
  'Reserva atómicamente la cantidad pedida sumándola a stock.cantidad_reservada. Si no hay stock disponible (cantidad - reservada < cantidad pedida), lanza excepción rompiendo la transacción.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. Reemplazar trigger descontar_stock_al_entregar:
--    ahora dispara también con 'despachado', y libera reserva.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION descontar_stock_al_despachar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item RECORD;
  ya_descontado BOOLEAN;
BEGIN
  -- Solo actuar cuando entra a despachado o entregado (si no pasó antes)
  IF NEW.estado NOT IN ('despachado', 'entregado') THEN RETURN NEW; END IF;
  IF OLD.estado = NEW.estado THEN RETURN NEW; END IF;
  IF OLD.estado IN ('despachado', 'entregado') THEN RETURN NEW; END IF;

  -- Verificar si ya hay movimientos por este pedido (evitar doble descuento)
  SELECT EXISTS (
    SELECT 1 FROM movimientos_stock
    WHERE referencia_tipo = 'pedido' AND referencia_id = NEW.id AND tipo = 'salida'
  ) INTO ya_descontado;

  IF ya_descontado THEN RETURN NEW; END IF;

  FOR item IN
    SELECT pi.id, pi.producto_id, pi.cantidad, pi.lote_id, pi.precio_unitario
    FROM pedidos_items pi
    WHERE pi.pedido_id = NEW.id
  LOOP
    -- 1. Descontar del lote específico (si hay lote)
    IF item.lote_id IS NOT NULL THEN
      UPDATE lotes
        SET cantidad_actual = GREATEST(0, cantidad_actual - item.cantidad),
            updated_at = NOW()
      WHERE id = item.lote_id;
    END IF;

    -- 2. Descontar del stock global Y liberar la reserva al mismo tiempo
    UPDATE stock
      SET cantidad = GREATEST(0, cantidad - item.cantidad),
          cantidad_reservada = GREATEST(0, cantidad_reservada - item.cantidad),
          updated_at = NOW()
    WHERE producto_id = item.producto_id;

    -- 3. Registrar movimiento de salida
    INSERT INTO movimientos_stock (
      producto_id, lote_id, tipo, cantidad, costo_unitario,
      referencia_tipo, referencia_id, notas, created_at
    ) VALUES (
      item.producto_id, item.lote_id, 'salida', item.cantidad, item.precio_unitario,
      'pedido', NEW.id,
      'Salida automática por despacho de pedido ' || NEW.numero,
      NOW()
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Reemplazar el trigger viejo
DROP TRIGGER IF EXISTS trg_descontar_stock_entrega ON pedidos;
DROP TRIGGER IF EXISTS trg_descontar_stock_despacho ON pedidos;
CREATE TRIGGER trg_descontar_stock_despacho
  AFTER UPDATE ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION descontar_stock_al_despachar();

COMMENT ON FUNCTION descontar_stock_al_despachar() IS
  'Descuenta stock real y libera la reserva cuando un pedido pasa a despachado o entregado. Evita doble descuento verificando si ya hay movimientos previos.';

-- ────────────────────────────────────────────────────────────────────────
-- 3. Liberar reserva al cancelar pedido
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION liberar_stock_al_cancelar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item RECORD;
BEGIN
  IF NEW.estado <> 'cancelado' OR OLD.estado = 'cancelado' THEN
    RETURN NEW;
  END IF;
  -- Solo liberar si el pedido nunca llegó a despachado (no se descontó stock real)
  IF OLD.estado IN ('despachado', 'entregado') THEN
    RETURN NEW;
  END IF;

  FOR item IN
    SELECT producto_id, cantidad FROM pedidos_items WHERE pedido_id = NEW.id
  LOOP
    UPDATE stock
      SET cantidad_reservada = GREATEST(0, cantidad_reservada - item.cantidad),
          updated_at = NOW()
    WHERE producto_id = item.producto_id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_liberar_stock_al_cancelar ON pedidos;
CREATE TRIGGER trg_liberar_stock_al_cancelar
  AFTER UPDATE ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION liberar_stock_al_cancelar();

-- ────────────────────────────────────────────────────────────────────────
-- 4. Vista útil: stock disponible
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_stock_disponible_real AS
SELECT
  s.producto_id,
  s.cantidad AS stock_fisico,
  s.cantidad_reservada AS stock_reservado,
  GREATEST(0, s.cantidad - s.cantidad_reservada) AS stock_disponible,
  s.costo_promedio,
  s.updated_at
FROM stock s;

GRANT SELECT ON v_stock_disponible_real TO authenticated;
