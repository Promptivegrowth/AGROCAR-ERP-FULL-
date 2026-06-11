-- ─────────────────────────────────────────────────────────────────────────────
-- 038: Fix crítico — RPC crear_pedido_atomico fallaba SIEMPRE por cast estado
--
-- Bug encontrado: la columna pedidos.estado es de tipo enum estado_pedido,
-- pero el INSERT en la RPC pasaba un TEXT crudo:
--
--   COALESCE(p_pedido->>'estado', 'enviado')
--
-- Postgres rechazaba con:
--   ERROR 42804: column "estado" is of type estado_pedido but expression is
--   of type text. HINT: You will need to rewrite or cast the expression.
--
-- Resultado: ningún pedido podía crearse vía la RPC. Reportado por el
-- cliente como "no pasan los pedidos sin stock" — en realidad no pasaba
-- ningún pedido nuevo desde el deploy del flujo atómico.
--
-- Fix: castear explícitamente a ::estado_pedido.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Validación dura: no se aceptan pedidos sin items
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se puede crear un pedido sin productos';
  END IF;

  -- Insertar cabecera (cast explícito a enum estado_pedido)
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
    COALESCE(p_pedido->>'estado', 'enviado')::estado_pedido,
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

  -- Insertar items
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

  -- Devolver pedido creado
  SELECT * INTO v_pedido_row FROM pedidos WHERE id = v_pedido_id;
  RETURN jsonb_build_object(
    'id', v_pedido_row.id,
    'numero', v_pedido_row.numero,
    'requiere_reposicion', v_pedido_row.requiere_reposicion,
    'motivo_reposicion', v_pedido_row.motivo_reposicion
  );
END;
$$;
