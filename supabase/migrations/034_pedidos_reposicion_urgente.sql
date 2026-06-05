-- ─────────────────────────────────────────────────────────────────────────────
-- 034: Pedidos con override de stock para casos operativos urgentes
--
-- Bug reportado: el sistema mostraba "Stock insuficiente" pero igualmente
-- guardaba la cabecera del pedido (sin items), porque cada INSERT es una
-- transacción independiente: la cabecera entra, los items fallan y nadie
-- limpia. Además, se podían enviar pedidos sin productos pero con monto.
--
-- Caso operativo de DANIEL: a veces el camión va en camino y aun así hay
-- que registrar el pedido. Necesitamos una vía controlada para crear
-- pedidos sabiendo que el stock es insuficiente.
--
-- Diseño:
-- - Columna pedidos.requiere_reposicion: marca el pedido como "creado con
--   stock insuficiente" para que se vea fácil en reportes y para que el
--   almacenero priorice reposición.
-- - Columna pedidos.motivo_reposicion: razón obligatoria que da el usuario
--   (ej. "Camión en camino a Tacna, llega 17:00").
-- - Columna pedidos_items.force_reserva: marca explícita por item. El
--   trigger de reserva atómica respeta esta marca y reserva igual aunque
--   no haya stock, dejando cantidad_reservada > cantidad (negativo lógico).
-- - El almacenero ve negativos en v_stock_disponible_real y sabe que tiene
--   que reponer antes del despacho.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS requiere_reposicion BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS motivo_reposicion TEXT;

ALTER TABLE pedidos_items
  ADD COLUMN IF NOT EXISTS force_reserva BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_pedidos_requiere_reposicion
  ON pedidos (requiere_reposicion)
  WHERE requiere_reposicion = TRUE;

COMMENT ON COLUMN pedidos.requiere_reposicion IS
  'Marca el pedido como creado con stock insuficiente. Operativamente significa que el almacén debe reponer antes del despacho.';
COMMENT ON COLUMN pedidos.motivo_reposicion IS
  'Texto libre con la razón por la que se autorizó crear sin stock (camión en camino, reposición programada, etc.).';
COMMENT ON COLUMN pedidos_items.force_reserva IS
  'Si TRUE, el trigger reserva stock sin validar disponibilidad (puede dejar cantidad_reservada > cantidad).';

-- ────────────────────────────────────────────────────────────────────────
-- Trigger reservar_stock_al_crear_item: ahora respeta force_reserva
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reservar_stock_al_crear_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_disponible NUMERIC;
  v_nombre TEXT;
BEGIN
  -- Modo override: reservar sin validar (cantidad_reservada puede superar a cantidad).
  -- Esto deja stock_disponible negativo, señal visible para reposición.
  IF NEW.force_reserva = TRUE THEN
    UPDATE stock
      SET cantidad_reservada = cantidad_reservada + NEW.cantidad,
          updated_at = NOW()
    WHERE producto_id = NEW.producto_id;

    -- Si no existe fila de stock para el producto, crearla (con cantidad=0 y reserva=cantidad)
    IF NOT FOUND THEN
      INSERT INTO stock (producto_id, cantidad, cantidad_reservada, updated_at)
      VALUES (NEW.producto_id, 0, NEW.cantidad, NOW())
      ON CONFLICT (producto_id) DO UPDATE
        SET cantidad_reservada = stock.cantidad_reservada + NEW.cantidad,
            updated_at = NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- Modo normal: UPDATE atómico que solo afecta si hay stock disponible
  UPDATE stock
    SET cantidad_reservada = cantidad_reservada + NEW.cantidad,
        updated_at = NOW()
  WHERE producto_id = NEW.producto_id
    AND (cantidad - cantidad_reservada) >= NEW.cantidad;

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

-- ────────────────────────────────────────────────────────────────────────
-- RPC atómica: crea pedido + items en una sola transacción.
--   Si los items fallan, hace ROLLBACK automático del pedido completo.
--   Esto elimina el bug de "cabeceras huérfanas con monto".
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION crear_pedido_atomico(
  p_pedido JSONB,
  p_items JSONB,
  p_permitir_sin_stock BOOLEAN DEFAULT FALSE,
  p_motivo_reposicion TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id UUID;
  v_pedido_numero TEXT;
  v_item JSONB;
  v_pedido_row pedidos%ROWTYPE;
BEGIN
  -- Validación dura: NO se aceptan pedidos sin items.
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se puede crear un pedido sin productos';
  END IF;

  -- 1) Insertar cabecera con marca requiere_reposicion según parámetro
  INSERT INTO pedidos (
    numero, cliente_id, vendedor_id, fecha_pedido, fecha_despacho,
    estado, tipo_pago, direccion_entrega_id, direccion_entrega_texto,
    descuento_porcentaje, descuento_monto, subtotal, igv, incluir_igv,
    total, requiere_autorizacion, notas,
    requiere_reposicion, motivo_reposicion
  ) VALUES (
    p_pedido->>'numero',
    (p_pedido->>'cliente_id')::UUID,
    NULLIF(p_pedido->>'vendedor_id', '')::UUID,
    (p_pedido->>'fecha_pedido')::DATE,
    (p_pedido->>'fecha_despacho')::DATE,
    COALESCE(p_pedido->>'estado', 'enviado'),
    COALESCE(p_pedido->>'tipo_pago', 'contado'),
    NULLIF(p_pedido->>'direccion_entrega_id', '')::UUID,
    p_pedido->>'direccion_entrega_texto',
    COALESCE((p_pedido->>'descuento_porcentaje')::NUMERIC, 0),
    COALESCE((p_pedido->>'descuento_monto')::NUMERIC, 0),
    (p_pedido->>'subtotal')::NUMERIC,
    COALESCE((p_pedido->>'igv')::NUMERIC, 0),
    COALESCE((p_pedido->>'incluir_igv')::BOOLEAN, TRUE),
    (p_pedido->>'total')::NUMERIC,
    COALESCE((p_pedido->>'requiere_autorizacion')::BOOLEAN, FALSE),
    p_pedido->>'notas',
    p_permitir_sin_stock,
    CASE WHEN p_permitir_sin_stock THEN p_motivo_reposicion ELSE NULL END
  )
  RETURNING id, numero INTO v_pedido_id, v_pedido_numero;

  -- 2) Insertar items en bloque. Si el trigger de reserva falla, toda la
  --    transacción se cae automáticamente (incluyendo el pedido cabecera).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO pedidos_items (
      pedido_id, producto_id, lote_id, cantidad,
      precio_unitario, descuento_porcentaje, subtotal,
      force_reserva
    ) VALUES (
      v_pedido_id,
      (v_item->>'producto_id')::UUID,
      NULLIF(v_item->>'lote_id', '')::UUID,
      (v_item->>'cantidad')::NUMERIC,
      (v_item->>'precio_unitario')::NUMERIC,
      COALESCE((v_item->>'descuento_porcentaje')::NUMERIC, 0),
      (v_item->>'subtotal')::NUMERIC,
      p_permitir_sin_stock
    );
  END LOOP;

  -- 3) Devolver el pedido creado
  SELECT * INTO v_pedido_row FROM pedidos WHERE id = v_pedido_id;
  RETURN jsonb_build_object(
    'id', v_pedido_row.id,
    'numero', v_pedido_row.numero,
    'requiere_reposicion', v_pedido_row.requiere_reposicion,
    'motivo_reposicion', v_pedido_row.motivo_reposicion
  );
END;
$$;

COMMENT ON FUNCTION crear_pedido_atomico IS
  'Crea un pedido + sus items en una sola transacción. Si algo falla, hace rollback completo. Si p_permitir_sin_stock=true, los items se insertan con force_reserva y el pedido queda marcado como requiere_reposicion.';

GRANT EXECUTE ON FUNCTION crear_pedido_atomico TO authenticated;
