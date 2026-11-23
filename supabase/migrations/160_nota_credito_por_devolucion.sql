-- Nota de crédito del proveedor por DEVOLUCIÓN de mercadería.
--
-- Javier, 23/11/2026: devolvieron a Ti-Cay 501 QUESO EDAM X 500GR (compra
-- F001-120076, ya aplicada) y Ti-Cay emitió la nota de crédito F004-00016881
-- por S/ 6,212.40. El formulario de notas solo tenía nota por diferencia de
-- precio (mueve el costo) y por faltante (no mueve stock: lo que no llegó
-- nunca entró). Una devolución es mercadería que SÍ entró y vuelve al
-- proveedor: tiene que salir del stock.
--
-- registrar_nota_devolucion:
--   * Las unidades devueltas salen del stock al precio de compra (con IGV,
--     como todo costo del sistema). El costo promedio de lo que queda se
--     recalcula sacando ese valor; si el stock queda en cero o negativo, el
--     costo no se toca. Queda una "salida" en el kárdex con referencia
--     devolucion_proveedor.
--   * No se puede devolver más de lo recibido menos lo ya devuelto.
--   * La nota entra al Registro de compras y al SIRE como 07, restando (igual
--     que las demás notas de crédito).
--   * Anularla devuelve las unidades al stock.

ALTER TABLE public.notas_proveedor DROP CONSTRAINT IF EXISTS notas_proveedor_motivo_tipo_check;
ALTER TABLE public.notas_proveedor ADD CONSTRAINT notas_proveedor_motivo_tipo_check
  CHECK (motivo_tipo IN ('precio', 'faltante', 'devolucion'));

-- ── Mover unidades del stock por una devolución (o su anulación) ───────────
-- p_cantidad > 0 sale del stock; < 0 vuelve. Devuelve costo anterior y nuevo.
CREATE OR REPLACE FUNCTION public._stock_devolucion_proveedor(
  p_producto_id uuid, p_lote_id uuid, p_cantidad numeric, p_precio numeric,
  p_nota_id uuid, p_nota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_stock NUMERIC; v_costo NUMERIC; v_nuevo NUMERIC; v_quedan NUMERIC;
BEGIN
  SELECT cantidad, costo_promedio INTO v_stock, v_costo FROM stock WHERE producto_id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO stock (producto_id, cantidad, cantidad_reservada, costo_promedio, updated_at)
    VALUES (p_producto_id, 0, 0, p_precio, NOW());
    v_stock := 0; v_costo := p_precio;
  END IF;
  v_stock := COALESCE(v_stock, 0); v_costo := COALESCE(v_costo, 0);
  v_quedan := v_stock - p_cantidad;
  -- El valor que sale (o vuelve) es el de la compra: el promedio de lo que queda
  -- se recalcula con eso. Sin stock positivo, el costo se deja como estaba.
  v_nuevo := CASE WHEN v_stock > 0 AND v_quedan > 0
                  THEN GREATEST((v_stock * v_costo - p_cantidad * p_precio) / v_quedan, 0)
                  ELSE v_costo END;

  UPDATE stock SET cantidad = v_quedan, costo_promedio = v_nuevo, updated_at = NOW() WHERE producto_id = p_producto_id;
  UPDATE productos SET costo_promedio = v_nuevo WHERE id = p_producto_id;
  IF p_lote_id IS NOT NULL THEN
    UPDATE lotes SET cantidad_actual = GREATEST(0, cantidad_actual - p_cantidad), updated_at = NOW() WHERE id = p_lote_id;
  END IF;
  INSERT INTO movimientos_stock (producto_id, lote_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id, notas, created_by)
  VALUES (p_producto_id, p_lote_id,
          CASE WHEN p_cantidad > 0 THEN 'salida' ELSE 'entrada' END::tipo_movimiento_stock,
          ABS(p_cantidad), p_precio, 'devolucion_proveedor', p_nota_id, p_nota, auth.uid());
  RETURN jsonb_build_object('costo_anterior', v_costo, 'costo_nuevo', v_nuevo, 'stock_anterior', v_stock, 'stock_nuevo', v_quedan);
END;
$function$;
REVOKE ALL ON FUNCTION public._stock_devolucion_proveedor(uuid, uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Registrar la nota por devolución ───────────────────────────────────────
-- p_items: [{ "compra_item_id": uuid, "cantidad": n }]  (cantidad = lo devuelto)
CREATE OR REPLACE FUNCTION public.registrar_nota_devolucion(
  p_compra_id uuid, p_numero text, p_fecha date, p_motivo text, p_items jsonb, p_total_documento numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT; v_compra RECORD; v_it jsonb; v_ci RECORD; v_cant NUMERIC; v_devuelto NUMERIC;
  v_nota_id UUID; v_total NUMERIC := 0; v_abs NUMERIC; v_base NUMERIC; v_numero TEXT; v_doc TEXT;
  v_vistos UUID[] := '{}'; v_r jsonb; v_detalle jsonb := '[]'::jsonb; v_importe NUMERIC;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'almacenero') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o almacén pueden registrar notas del proveedor';
  END IF;
  v_numero := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_numero, '')), '\s+', '', 'g'));
  IF v_numero = '' THEN RAISE EXCEPTION 'Falta el número de la nota (por ejemplo F004-00016881)'; END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN RAISE EXCEPTION 'Falta el motivo de la nota'; END IF;
  IF p_fecha IS NULL OR p_fecha > (NOW() AT TIME ZONE 'America/Lima')::date + 1 THEN RAISE EXCEPTION 'Fecha de la nota inválida'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Marca al menos un producto devuelto';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La compra no existe'; END IF;
  v_doc := COALESCE(v_compra.numero_factura_proveedor, 'sin número');
  IF v_compra.documento_interno THEN RAISE EXCEPTION 'La compra % es un documento interno: no admite notas del proveedor', v_doc; END IF;
  IF v_compra.estado::text IN ('anulado', 'anulada') THEN RAISE EXCEPTION 'La compra % está anulada', v_doc; END IF;
  IF v_compra.estado::text <> 'aplicada' THEN
    RAISE EXCEPTION 'La compra % todavía no está aplicada (está %): lo que no se quedó se corrige en la recepción', v_doc, v_compra.estado;
  END IF;
  IF EXISTS (SELECT 1 FROM notas_proveedor WHERE proveedor_id = v_compra.proveedor_id AND tipo = 'credito'
               AND estado = 'aplicada' AND UPPER(REPLACE(numero, ' ', '')) = v_numero) THEN
    RAISE EXCEPTION 'La nota % de este proveedor ya está registrada', v_numero;
  END IF;

  INSERT INTO notas_proveedor (tipo, motivo_tipo, compra_id, proveedor_id, numero, fecha_emision, motivo, subtotal, igv, total, created_by)
  VALUES ('credito', 'devolucion', p_compra_id, v_compra.proveedor_id, v_numero, p_fecha, TRIM(p_motivo), 0, 0, 0, auth.uid())
  RETURNING id INTO v_nota_id;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT ci.*, COALESCE(NULLIF(TRIM(p.descripcion), ''), p.nombre) AS producto INTO v_ci
      FROM compras_items ci JOIN productos p ON p.id = ci.producto_id
     WHERE ci.id = (v_it->>'compra_item_id')::uuid AND ci.compra_id = p_compra_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los productos no pertenece a la compra %', v_doc; END IF;
    IF v_ci.id = ANY(v_vistos) THEN RAISE EXCEPTION '% está repetido en la nota', v_ci.producto; END IF;
    v_vistos := v_vistos || v_ci.id;

    v_cant := (v_it->>'cantidad')::numeric;
    IF v_cant IS NULL OR v_cant <= 0 THEN RAISE EXCEPTION 'Cantidad devuelta inválida en %', v_ci.producto; END IF;
    SELECT COALESCE(SUM(i.cantidad), 0) INTO v_devuelto
      FROM notas_proveedor_items i JOIN notas_proveedor n ON n.id = i.nota_id
     WHERE i.compra_item_id = v_ci.id AND n.estado = 'aplicada' AND n.motivo_tipo = 'devolucion';
    IF v_cant > COALESCE(v_ci.cantidad_recibida, v_ci.cantidad) - v_devuelto + 0.0001 THEN
      RAISE EXCEPTION '%: se devuelven % pero se recibieron % (ya devuelto: %)', v_ci.producto, trim_scale(v_cant),
        trim_scale(COALESCE(v_ci.cantidad_recibida, v_ci.cantidad)), trim_scale(v_devuelto);
    END IF;

    v_importe := ROUND(v_cant * v_ci.precio_unitario, 2);
    v_r := _stock_devolucion_proveedor(v_ci.producto_id, v_ci.lote_id, v_cant, v_ci.precio_unitario, v_nota_id,
             'Devolución al proveedor · nota de crédito ' || v_numero || ' (' || v_doc || ')');
    -- importe_a_stock queda en 0: el valor salió con las unidades (no es un
    -- ajuste de costo como en las notas por precio).
    INSERT INTO notas_proveedor_items (nota_id, compra_item_id, producto_id, cantidad, precio_facturado, precio_correcto,
      diferencia_unitaria, importe, unidades_en_stock, importe_a_stock, importe_a_costo_ventas, costo_anterior, costo_nuevo)
    VALUES (v_nota_id, v_ci.id, v_ci.producto_id, v_cant, v_ci.precio_unitario, 0, -v_ci.precio_unitario, -v_importe,
      0, 0, 0, (v_r->>'costo_anterior')::numeric, (v_r->>'costo_nuevo')::numeric);
    v_total := v_total + v_importe;
    v_detalle := v_detalle || jsonb_build_object('producto', v_ci.producto, 'cantidad', v_cant,
      'stock_anterior', (v_r->>'stock_anterior')::numeric, 'stock_nuevo', (v_r->>'stock_nuevo')::numeric,
      'costo_anterior', ROUND((v_r->>'costo_anterior')::numeric, 4), 'costo_nuevo', ROUND((v_r->>'costo_nuevo')::numeric, 4));
  END LOOP;

  IF p_total_documento IS NULL OR ABS(v_total - p_total_documento) > 0.05 THEN
    RAISE EXCEPTION 'Lo devuelto suma S/ % y la nota dice S/ %. Revisa las cantidades', TO_CHAR(v_total, 'FM999999990.00'),
      TO_CHAR(COALESCE(p_total_documento, 0), 'FM999999990.00');
  END IF;
  v_abs := ROUND(p_total_documento, 2);
  v_base := CASE WHEN v_compra.incluir_igv THEN ROUND(v_abs / (1 + COALESCE(igv_vigente(), 18) / 100.0), 2) ELSE v_abs END;
  UPDATE notas_proveedor SET subtotal = v_base, igv = v_abs - v_base, total = v_abs,
         importe_a_stock = -v_abs, importe_a_costo_ventas = 0
   WHERE id = v_nota_id;

  RETURN jsonb_build_object('id', v_nota_id, 'numero', v_numero, 'subtotal', v_base, 'igv', v_abs - v_base, 'total', v_abs,
    'productos', v_detalle);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registrar_nota_devolucion(uuid, text, date, text, jsonb, numeric) TO authenticated;

-- ── Anular: lo devuelto vuelve al stock ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_nota_proveedor(p_nota_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT; v_nota RECORD; v_it RECORD; v_r jsonb; v_lote UUID;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administración o gerencia pueden anular una nota del proveedor';
  END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN RAISE EXCEPTION 'Indica el motivo de la anulación'; END IF;
  SELECT * INTO v_nota FROM notas_proveedor WHERE id = p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La nota no existe'; END IF;
  IF v_nota.estado = 'anulada' THEN RAISE EXCEPTION 'La nota % ya está anulada', v_nota.numero; END IF;

  IF v_nota.motivo_tipo = 'devolucion' THEN
    -- Lo devuelto vuelve a entrar, al mismo precio con que salió.
    FOR v_it IN SELECT * FROM notas_proveedor_items WHERE nota_id = p_nota_id LOOP
      SELECT lote_id INTO v_lote FROM compras_items WHERE id = v_it.compra_item_id;
      v_r := _stock_devolucion_proveedor(v_it.producto_id, v_lote, -v_it.cantidad, v_it.precio_facturado, p_nota_id,
               'Anulación de la nota de crédito por devolución ' || v_nota.numero);
    END LOOP;
  ELSE
    -- Solo las de precio movieron el costo (las de faltante no tocan nada).
    FOR v_it IN SELECT * FROM notas_proveedor_items WHERE nota_id = p_nota_id LOOP
      IF v_it.unidades_en_stock > 0 AND v_it.importe_a_stock <> 0 THEN
        v_r := _ajustar_costo_producto(v_it.producto_id, -v_it.importe_a_stock / v_it.unidades_en_stock,
                 v_it.unidades_en_stock, p_nota_id, 'Anulación de la nota ' || v_nota.numero);
      END IF;
    END LOOP;
  END IF;

  UPDATE notas_credito_compras SET estado = 'emitida', nota_proveedor_id = NULL
   WHERE nota_proveedor_id = p_nota_id AND estado = 'regularizada';
  UPDATE notas_proveedor SET estado = 'anulada', motivo_anulacion = TRIM(p_motivo), anulada_at = NOW(), anulada_por = auth.uid()
   WHERE id = p_nota_id;
  RETURN jsonb_build_object('id', p_nota_id, 'numero', v_nota.numero, 'anulada', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.anular_nota_proveedor(uuid, text) TO authenticated;
