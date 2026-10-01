-- Editar un comprobante: agregar productos, y que el stock acompañe.
--
-- Daniel, 01/10: "en editar comprobante no puedo agregar producto, solo se
-- puede cambiar el nombre del cliente". El diálogo dejaba cambiar cantidad,
-- precio y quitar líneas, pero no sumar una.
--
-- Y ninguna edición tocaba el stock: si el cliente devolvía 2 unidades y se
-- corregía la cantidad, la mercadería volvía al almacén pero el sistema no lo
-- sabía. El stock se descuenta al consolidar el despacho, desde las líneas del
-- PEDIDO, así que una edición del comprobante tiene que acompañar a uno de los
-- dos lados según el momento:
--
--   - Pedido ya despachado (su salida está en el kárdex): se mueve el stock
--     ahora por la diferencia, con un movimiento que queda en el kárdex.
--   - Pedido todavía sin despachar: se ajusta la línea del pedido, y el
--     despacho descuenta la cantidad correcta.
--
-- Todo con la misma trazabilidad de siempre, y solo mientras el comprobante no
-- esté declarado a SUNAT (eso lo frenan también los triggers de la 116).

BEGIN;

-- ── 1. Mover el stock por una edición del comprobante ──────────────────────
-- p_delta > 0: se vende más (sale del almacén). p_delta < 0: vuelve.
CREATE OR REPLACE FUNCTION public.ajustar_stock_por_edicion(
  p_comprobante_id uuid, p_producto_id uuid, p_delta numeric,
  p_precio_unitario numeric, p_descripcion text, p_nota text, p_cantidad_anterior numeric DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
  v_despachado BOOLEAN;
  v_pi RECORD;
  v_costo NUMERIC;
BEGIN
  IF p_producto_id IS NULL OR COALESCE(p_delta, 0) = 0 THEN RETURN; END IF;

  SELECT id, serie, numero, pedido_id INTO v_comp FROM comprobantes WHERE id = p_comprobante_id;

  v_despachado := v_comp.pedido_id IS NULL OR EXISTS (
    SELECT 1 FROM movimientos_stock
     WHERE referencia_tipo = 'pedido' AND referencia_id = v_comp.pedido_id AND tipo = 'salida');

  IF v_despachado THEN
    SELECT costo_promedio INTO v_costo FROM stock WHERE producto_id = p_producto_id;
    UPDATE stock SET cantidad = cantidad - p_delta, updated_at = NOW() WHERE producto_id = p_producto_id;
    IF NOT FOUND THEN
      INSERT INTO stock (producto_id, cantidad, cantidad_reservada, updated_at)
      VALUES (p_producto_id, -p_delta, 0, NOW());
    END IF;
    INSERT INTO movimientos_stock (tipo, referencia_tipo, referencia_id, producto_id, cantidad, costo_unitario, notas, created_by)
    VALUES (
      CASE WHEN p_delta > 0 THEN 'salida' ELSE 'entrada' END::tipo_movimiento_stock,
      'comprobante_edicion', p_comprobante_id, p_producto_id, ABS(p_delta), v_costo,
      'Edición de ' || v_comp.serie || '-' || v_comp.numero
        || CASE WHEN p_delta > 0 THEN ': se vendió más' ELSE ': volvió al almacén' END
        || COALESCE(' · ' || NULLIF(TRIM(p_nota), ''), ''),
      auth.uid());
    RETURN;
  END IF;

  -- Sin despachar todavía: se corrige la línea del pedido.
  SELECT * INTO v_pi FROM pedidos_items
   WHERE pedido_id = v_comp.pedido_id AND producto_id = p_producto_id
   ORDER BY (cantidad = p_cantidad_anterior) DESC NULLS LAST, id
   LIMIT 1;

  IF NOT FOUND THEN
    IF p_delta > 0 THEN
      -- force_reserva: un producto agregado no puede trabar la edición por stock.
      INSERT INTO pedidos_items (pedido_id, producto_id, cantidad, precio_unitario, subtotal, force_reserva, descripcion_libre)
      VALUES (v_comp.pedido_id, p_producto_id, p_delta, p_precio_unitario,
              ROUND(p_delta * p_precio_unitario, 2), TRUE, NULLIF(TRIM(p_descripcion), ''));
    END IF;
    RETURN;
  END IF;

  IF v_pi.cantidad + p_delta <= 0 THEN
    DELETE FROM pedidos_items WHERE id = v_pi.id;  -- su trigger libera la reserva
  ELSE
    UPDATE pedidos_items
       SET cantidad = v_pi.cantidad + p_delta,
           subtotal = ROUND((v_pi.cantidad + p_delta) * v_pi.precio_unitario, 2)
     WHERE id = v_pi.id;
    UPDATE stock SET cantidad_reservada = GREATEST(0, cantidad_reservada + p_delta), updated_at = NOW()
     WHERE producto_id = p_producto_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.ajustar_stock_por_edicion(uuid, uuid, numeric, numeric, text, text, numeric) FROM PUBLIC, anon, authenticated;

-- ── 2. Agregar una línea al comprobante ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agregar_item_comprobante(
  p_comprobante_id uuid, p_producto_id uuid, p_cantidad numeric, p_precio_unitario numeric,
  p_descripcion text DEFAULT NULL, p_nota text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_comp RECORD;
  v_prod RECORD;
  v_desc TEXT;
  v_item_id UUID;
  v_suma NUMERIC;
  v_total NUMERIC;
  v_igv NUMERIC;
  v_subtotal NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permisos para editar comprobantes (requiere administrador/gerente/facturador)';
  END IF;

  SELECT * INTO v_comp FROM comprobantes WHERE id = p_comprobante_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante % no existe', p_comprobante_id; END IF;
  IF v_comp.enviado_sunat AND v_comp.sunat_modo = 'produccion' THEN
    RAISE EXCEPTION 'No se puede editar: el comprobante ya fue declarado a SUNAT';
  END IF;
  IF v_comp.estado = 'anulado' THEN RAISE EXCEPTION 'No se puede editar un comprobante anulado'; END IF;
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad tiene que ser mayor que cero'; END IF;
  IF COALESCE(p_precio_unitario, -1) < 0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;

  SELECT id, codigo, nombre, descripcion INTO v_prod FROM productos WHERE id = p_producto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El producto no existe'; END IF;
  v_desc := COALESCE(NULLIF(TRIM(p_descripcion), ''), NULLIF(TRIM(v_prod.descripcion), ''), v_prod.nombre);

  INSERT INTO comprobantes_items (comprobante_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, igv_porcentaje)
  VALUES (p_comprobante_id, p_producto_id, v_desc, p_cantidad, p_precio_unitario,
          ROUND(p_cantidad * p_precio_unitario, 2),
          CASE WHEN v_comp.igv > 0 THEN igv_vigente() ELSE 0 END)
  RETURNING id INTO v_item_id;

  INSERT INTO comprobantes_ediciones (comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota)
  VALUES (p_comprobante_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
    'item.agregado', NULL, 'cant=' || p_cantidad || ' precio=' || p_precio_unitario,
    v_item_id, v_desc, p_nota);

  PERFORM ajustar_stock_por_edicion(p_comprobante_id, p_producto_id, p_cantidad, p_precio_unitario, v_desc, p_nota, NULL);

  -- Totales: misma regla que editar y eliminar (los precios ya incluyen IGV).
  SELECT COALESCE(SUM(subtotal), 0) INTO v_suma FROM comprobantes_items WHERE comprobante_id = p_comprobante_id;
  IF v_comp.igv > 0 THEN
    v_total := v_suma;
    v_igv := ROUND(v_total - (v_total / (1 + igv_vigente() / 100)), 2);
    v_subtotal := v_total - v_igv;
  ELSE
    v_total := v_suma; v_igv := 0; v_subtotal := v_suma;
  END IF;
  UPDATE comprobantes
     SET subtotal = v_subtotal, igv = v_igv, total = v_total, editado = TRUE, editado_at = NOW()
   WHERE id = p_comprobante_id;

  RETURN jsonb_build_object('ok', true, 'item_id', v_item_id, 'subtotal', v_subtotal, 'igv', v_igv, 'total', v_total);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.agregar_item_comprobante(uuid, uuid, numeric, numeric, text, text) TO authenticated;

-- ── 3. Editar y quitar líneas también mueven el stock ──────────────────────
DO $cambio$
DECLARE
  v_src TEXT;
  v_nuevo TEXT;
BEGIN
  SELECT pg_get_functiondef('public.editar_comprobante_item'::regproc) INTO v_src;
  v_nuevo := replace(v_src,
    E'  WHERE id = p_item_id;\n\n  -- Suma de subtotales',
    E'  WHERE id = p_item_id;\n\n  -- El stock acompaña la diferencia de cantidad (migración 121).\n'
    || E'  PERFORM ajustar_stock_por_edicion(v_item.comp_id, v_item.producto_id, p_cantidad - v_item.cantidad,\n'
    || E'    p_precio_unitario, p_descripcion, p_nota, v_item.cantidad);\n\n  -- Suma de subtotales');
  IF v_nuevo = v_src THEN RAISE EXCEPTION 'editar_comprobante_item: no se encontró dónde enganchar el stock'; END IF;
  EXECUTE v_nuevo;

  SELECT pg_get_functiondef('public.eliminar_item_comprobante'::regproc) INTO v_src;
  v_nuevo := replace(v_src,
    'DELETE FROM comprobantes_items WHERE id = p_item_id;',
    E'DELETE FROM comprobantes_items WHERE id = p_item_id;\n\n'
    || E'  -- Lo que se quita del comprobante vuelve al stock (migración 121).\n'
    || E'  PERFORM ajustar_stock_por_edicion(v_item.comp_id, v_item.producto_id, -v_item.cantidad,\n'
    || E'    v_item.precio_unitario, v_item.descripcion, p_motivo, v_item.cantidad);');
  IF v_nuevo = v_src THEN RAISE EXCEPTION 'eliminar_item_comprobante: no se encontró dónde enganchar el stock'; END IF;
  EXECUTE v_nuevo;
END
$cambio$;

COMMIT;
