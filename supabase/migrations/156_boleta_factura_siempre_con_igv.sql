-- Facturas y boletas siempre con IGV.
--
-- Daniel, 07/11/2026: SUNAT rechazó la boleta B002-1692 (3111: "El monto de
-- afectación de IGV por línea debe ser diferente a 0.00"). El pedido
-- P-16690888 se registró "sin IGV" desde la PWA, y emitir_comprobante_atomico
-- copiaba las líneas con IGV 0 %. Los productos son gravados: un comprobante
-- electrónico no puede llevarlos sin IGV. Una vez rechazado, SUNAT no admite
-- reenviar ese número (1032); hay que anularlo y emitir otro.
--
-- Ahora, en factura y boleta, si el pedido vino "sin IGV" el total se toma con
-- IGV incluido (el cliente paga lo mismo) y cada línea lleva el IGV vigente.
-- El documento interno sigue respetando lo que diga el pedido.

CREATE OR REPLACE FUNCTION public.emitir_comprobante_atomico(p_pedido_id uuid, p_tipo text, p_serie text, p_numero text, p_fecha_emision date, p_subtotal numeric, p_igv numeric, p_total numeric, p_facturador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido RECORD;
  v_comp_id UUID;
  v_items_count INT;
  v_serie TEXT;
  v_numero TEXT;
  v_previo RECORD;
  v_con_igv BOOLEAN;
  v_subtotal NUMERIC := p_subtotal;
  v_igv NUMERIC := p_igv;
BEGIN
  -- El pedido queda bloqueado hasta terminar: dos emisiones del mismo pedido
  -- al mismo tiempo se ponen en fila y la segunda ve el comprobante de la
  -- primera.
  SELECT p.id, p.cliente_id, p.incluir_igv, p.estado, p.fecha_despacho
    INTO v_pedido FROM pedidos p WHERE p.id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;

  IF p_tipo IN ('factura', 'boleta', 'nota_pedido_interna') THEN
    SELECT serie, numero INTO v_previo FROM comprobantes
     WHERE pedido_id = p_pedido_id AND estado <> 'anulado'
       AND tipo IN ('factura', 'boleta', 'nota_pedido_interna')
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Este pedido ya tiene el comprobante %-%. Para emitir otro, primero hay que anular ese.',
        v_previo.serie, v_previo.numero;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_items_count FROM pedidos_items WHERE pedido_id = p_pedido_id;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'No se puede emitir comprobante: el pedido % no tiene productos', p_pedido_id;
  END IF;

  -- Factura y boleta van a SUNAT: siempre con IGV. Si el pedido vino "sin IGV",
  -- el total se toma con IGV incluido y se desglosa (B002-1692, 07/11).
  v_con_igv := v_pedido.incluir_igv OR p_tipo IN ('factura', 'boleta');
  IF p_tipo IN ('factura', 'boleta') AND COALESCE(p_igv, 0) = 0 AND COALESCE(p_total, 0) > 0 THEN
    v_subtotal := ROUND(p_total / (1 + igv_vigente() / 100.0), 2);
    v_igv := p_total - v_subtotal;
  END IF;

  IF p_serie IS NULL OR p_numero IS NULL OR trim(p_serie) = '' OR trim(p_numero) = '' THEN
    SELECT s.serie, s.numero INTO v_serie, v_numero
      FROM siguiente_correlativo(p_tipo::tipo_comprobante) s;
  ELSE
    v_serie := p_serie;
    v_numero := p_numero;
  END IF;

  INSERT INTO comprobantes (
    pedido_id, cliente_id, tipo, serie, numero,
    fecha_emision, fecha_despacho,
    subtotal, igv, total, moneda, estado,
    facturador_id
  ) VALUES (
    p_pedido_id, v_pedido.cliente_id,
    p_tipo::tipo_comprobante,
    v_serie, v_numero,
    p_fecha_emision, v_pedido.fecha_despacho,
    v_subtotal, v_igv, p_total,
    'PEN'::moneda,
    'emitido'::estado_comprobante,
    p_facturador_id
  )
  RETURNING id INTO v_comp_id;

  INSERT INTO comprobantes_items (
    comprobante_id, producto_id, descripcion, cantidad,
    precio_unitario, subtotal, igv_porcentaje
  )
  SELECT
    v_comp_id,
    pi.producto_id,
    COALESCE(NULLIF(TRIM(pi.descripcion_libre), ''), TRIM(p.descripcion), p.nombre, '—'),
    pi.cantidad,
    pi.precio_unitario,
    pi.subtotal,
    -- El IGV configurado (migración 112), no un 18 escrito a mano.
    CASE WHEN v_con_igv THEN igv_vigente() ELSE 0 END
  FROM pedidos_items pi
  LEFT JOIN productos p ON p.id = pi.producto_id
  WHERE pi.pedido_id = p_pedido_id;

  GET DIAGNOSTICS v_items_count = ROW_COUNT;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'Error al copiar items del pedido al comprobante. Rollback.';
  END IF;

  -- Venta en oficina (zona sin despacho): se entrega al facturar. Y lo ya
  -- despachado o entregado no vuelve atrás (migración 123).
  UPDATE pedidos p
     SET estado = CASE WHEN EXISTS (
                   SELECT 1 FROM clientes cl
                     LEFT JOIN cliente_direcciones cd ON cd.id = p.direccion_entrega_id
                     JOIN zonas z ON z.id = COALESCE(cd.zona_id, cl.zona_id)
                    WHERE cl.id = p.cliente_id AND z.sin_despacho)
                 THEN 'entregado' ELSE 'facturado' END::estado_pedido,
         updated_at = NOW()
   WHERE p.id = p_pedido_id AND p.estado NOT IN ('despachado', 'entregado');

  RETURN jsonb_build_object(
    'id', v_comp_id,
    'serie', v_serie,
    'numero', v_numero,
    'items_count', v_items_count
  );
END;
$function$;
