-- Migración 023b: Funciones aplicar_compra() y revertir_compra()
-- Centralizan la lógica de impacto a stock/lotes/costos en transacciones
-- atómicas, separadas del INSERT inicial de la compra.

-- ────────────────────────────────────────────────────────────────────────
-- aplicar_compra(compra_id) → impacta almacén y genera NC si hay diferencia
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION aplicar_compra(p_compra_id UUID)
RETURNS TABLE (nota_credito_id UUID, nota_credito_total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_compra RECORD;
  v_item RECORD;
  v_lote_id UUID;
  v_cant_real NUMERIC;
  v_diff NUMERIC;
  v_nc_id UUID;
  v_nc_subtotal NUMERIC := 0;
  v_nc_igv NUMERIC := 0;
  v_nc_total NUMERIC := 0;
  v_tiene_diferencia BOOLEAN := FALSE;
  v_user_id UUID;
BEGIN
  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_compra.estado <> 'recibida' THEN
    RAISE EXCEPTION 'Solo se puede aplicar una compra en estado recibida (estado actual: %)', v_compra.estado;
  END IF;

  v_user_id := auth.uid();

  -- Procesar cada item: usar cantidad_recibida si está, sino cantidad facturada
  FOR v_item IN
    SELECT ci.*, pr.tiene_lote, pr.tiene_vencimiento
    FROM compras_items ci
    JOIN productos pr ON pr.id = ci.producto_id
    WHERE ci.compra_id = p_compra_id
  LOOP
    v_cant_real := COALESCE(v_item.cantidad_recibida, v_item.cantidad);

    IF v_cant_real <= 0 THEN
      -- Si recibido = 0, todo va a la NC y no se ingresa stock
      v_diff := v_item.cantidad;
      v_tiene_diferencia := TRUE;
    ELSE
      -- 1. Lote: crear si tiene_lote/tiene_vencimiento + lote_numero, sino lote_id=null
      v_lote_id := NULL;
      IF (v_item.tiene_lote OR v_item.tiene_vencimiento) AND v_item.lote_numero IS NOT NULL THEN
        -- Buscar lote existente con mismo numero
        SELECT id INTO v_lote_id FROM lotes
          WHERE producto_id = v_item.producto_id AND numero_lote = v_item.lote_numero;

        IF v_lote_id IS NULL THEN
          -- Crear nuevo lote
          INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, activo)
          VALUES (v_item.producto_id, v_item.lote_numero, v_item.lote_fecha_vencimiento, v_cant_real, v_cant_real, TRUE)
          RETURNING id INTO v_lote_id;
        ELSE
          -- Acumular en lote existente
          UPDATE lotes
            SET cantidad_actual = cantidad_actual + v_cant_real,
                cantidad_inicial = cantidad_inicial + v_cant_real,
                updated_at = NOW()
          WHERE id = v_lote_id;
        END IF;

        -- Guardar lote_id en el item para trazabilidad
        UPDATE compras_items SET lote_id = v_lote_id WHERE id = v_item.id;
      END IF;

      -- 2. Stock global del producto
      INSERT INTO stock (producto_id, cantidad, costo_promedio, updated_at)
      VALUES (v_item.producto_id, v_cant_real, v_item.precio_unitario, NOW())
      ON CONFLICT (producto_id) DO UPDATE SET
        cantidad = stock.cantidad + EXCLUDED.cantidad,
        costo_promedio = CASE
          WHEN stock.cantidad + EXCLUDED.cantidad > 0 THEN
            ((stock.cantidad * stock.costo_promedio) + (EXCLUDED.cantidad * v_item.precio_unitario))
            / (stock.cantidad + EXCLUDED.cantidad)
          ELSE v_item.precio_unitario
        END,
        updated_at = NOW();

      -- 3. Movimiento de stock
      INSERT INTO movimientos_stock (
        producto_id, lote_id, tipo, cantidad, costo_unitario,
        referencia_tipo, referencia_id, notas
      ) VALUES (
        v_item.producto_id, v_lote_id, 'entrada', v_cant_real, v_item.precio_unitario,
        'compra', p_compra_id,
        'Entrada por compra ' || COALESCE(v_compra.numero_factura_proveedor, p_compra_id::text)
      );

      -- 4. Si recibió menos de lo facturado, generar línea NC por la diferencia
      v_diff := v_item.cantidad - v_cant_real;
      IF v_diff > 0 THEN v_tiene_diferencia := TRUE; END IF;
    END IF;

    -- Si hay diferencia (recibió menos), agregar a NC
    IF v_diff > 0 THEN
      IF v_nc_id IS NULL THEN
        INSERT INTO notas_credito_compras (
          compra_id, proveedor_id, numero, motivo, created_by
        ) VALUES (
          p_compra_id, v_compra.proveedor_id,
          'NC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTR(p_compra_id::text, 1, 6),
          'Diferencia entre factura y mercaderia recibida',
          v_user_id
        ) RETURNING id INTO v_nc_id;
      END IF;

      INSERT INTO notas_credito_compras_items (
        nota_credito_id, compra_item_id, producto_id, cantidad, precio_unitario, subtotal
      ) VALUES (
        v_nc_id, v_item.id, v_item.producto_id, v_diff, v_item.precio_unitario,
        v_diff * v_item.precio_unitario
      );

      v_nc_subtotal := v_nc_subtotal + (v_diff * v_item.precio_unitario);
    END IF;
  END LOOP;

  -- Cerrar totales de la NC si se generó (asumir mismo régimen IGV que la compra)
  IF v_nc_id IS NOT NULL THEN
    v_nc_igv := CASE WHEN v_compra.incluir_igv THEN v_nc_subtotal * 0.18 ELSE 0 END;
    v_nc_total := v_nc_subtotal + v_nc_igv;
    UPDATE notas_credito_compras
      SET subtotal = v_nc_subtotal, igv = v_nc_igv, total = v_nc_total
    WHERE id = v_nc_id;
  END IF;

  -- Actualizar compra
  UPDATE compras SET estado = 'aplicada' WHERE id = p_compra_id;

  RETURN QUERY SELECT v_nc_id, v_nc_total;
END;
$$;

COMMENT ON FUNCTION aplicar_compra(UUID) IS
  'Aplica una compra al almacén: crea lotes, actualiza stock + costo_promedio, registra movimientos_stock y genera NC contable por diferencias. Solo opera sobre compras en estado recibida.';

-- ────────────────────────────────────────────────────────────────────────
-- revertir_compra(compra_id) → deshace impacto y vuelve a 'registrada'
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION revertir_compra(p_compra_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_compra RECORD;
  v_item RECORD;
  v_cant_real NUMERIC;
BEGIN
  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_compra.estado <> 'aplicada' THEN
    RAISE EXCEPTION 'Solo se puede revertir una compra aplicada (estado actual: %)', v_compra.estado;
  END IF;

  -- Eliminar NC asociada (CASCADE elimina sus items)
  DELETE FROM notas_credito_compras WHERE compra_id = p_compra_id;

  -- Revertir cada item
  FOR v_item IN
    SELECT * FROM compras_items WHERE compra_id = p_compra_id
  LOOP
    v_cant_real := COALESCE(v_item.cantidad_recibida, v_item.cantidad);
    IF v_cant_real <= 0 THEN CONTINUE; END IF;

    -- Decrementar lote
    IF v_item.lote_id IS NOT NULL THEN
      UPDATE lotes
        SET cantidad_actual = GREATEST(0, cantidad_actual - v_cant_real),
            cantidad_inicial = GREATEST(0, cantidad_inicial - v_cant_real),
            updated_at = NOW()
      WHERE id = v_item.lote_id;
      -- Si el lote queda en 0 y fue creado solo para esta compra, desactivar
      UPDATE lotes SET activo = FALSE WHERE id = v_item.lote_id AND cantidad_actual = 0;
    END IF;

    -- Decrementar stock global (sin recalcular costo_promedio retroactivo
    -- para simplificar; se ajustará en la próxima entrada)
    UPDATE stock
      SET cantidad = GREATEST(0, cantidad - v_cant_real),
          updated_at = NOW()
    WHERE producto_id = v_item.producto_id;

    -- Movimiento de reversión
    INSERT INTO movimientos_stock (
      producto_id, lote_id, tipo, cantidad, costo_unitario,
      referencia_tipo, referencia_id, notas
    ) VALUES (
      v_item.producto_id, v_item.lote_id, 'ajuste', -v_cant_real, v_item.precio_unitario,
      'compra', p_compra_id,
      'Reversión de compra ' || COALESCE(v_compra.numero_factura_proveedor, p_compra_id::text)
    );
  END LOOP;

  UPDATE compras SET estado = 'registrada' WHERE id = p_compra_id;
END;
$$;

COMMENT ON FUNCTION revertir_compra(UUID) IS
  'Revierte una compra aplicada: decrementa lotes y stock, registra movimientos de ajuste, elimina NC. La compra vuelve a estado registrada para edición.';
