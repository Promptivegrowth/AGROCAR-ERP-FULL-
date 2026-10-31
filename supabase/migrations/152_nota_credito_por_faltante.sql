-- Nota de crédito del proveedor por un faltante en la recepción.
--
-- Daniel, 31/10/2026: El Catalán facturó 3,223.00 kg de mondongo (E001-5) y
-- llegaron 3,184.51 kg; el proveedor emitió la nota de crédito E001-4 por los
-- 38.49 kg (S/ 407.99).
--
-- El faltante ya se maneja al recibir: "Validar recepción" con lo que llegó y,
-- al aplicar, entra al stock solo lo recibido al costo correcto y se genera una
-- nota de crédito interna (notas_credito_compras) por la diferencia, para
-- reclamar. Lo que faltaba es el documento del proveedor: no tenía dónde
-- registrarse, así que no llegaba al Registro de compras ni al SIRE (el
-- crédito fiscal quedaba S/ 62.24 más alto) y la nota interna no se cerraba.
--
-- registrar_nota_faltante registra la nota real (07, en negativo en el
-- Registro de compras) contra lo que faltó y NO toca stock ni costo: eso ya
-- quedó bien al recibir. Cuando cubre el faltante, la nota interna queda
-- "regularizada" con el número del proveedor.
--
-- De paso, el costo del producto (productos.costo_promedio, el que usan la
-- utilidad y los pedidos) se recalculaba al REGISTRAR la compra, con la
-- cantidad FACTURADA, aunque todavía no hubiera llegado nada, y no se
-- deshacía si la compra se anulaba. Ahora sigue al costo del inventario
-- (stock.costo_promedio) al aplicar y al revertir.

ALTER TABLE public.notas_proveedor ADD COLUMN IF NOT EXISTS motivo_tipo TEXT NOT NULL DEFAULT 'precio';
ALTER TABLE public.notas_proveedor DROP CONSTRAINT IF EXISTS notas_proveedor_motivo_tipo_check;
ALTER TABLE public.notas_proveedor ADD CONSTRAINT notas_proveedor_motivo_tipo_check CHECK (motivo_tipo IN ('precio', 'faltante'));

ALTER TABLE public.notas_credito_compras ADD COLUMN IF NOT EXISTS nota_proveedor_id UUID REFERENCES public.notas_proveedor(id) ON DELETE SET NULL;
ALTER TABLE public.notas_credito_compras DROP CONSTRAINT IF EXISTS notas_credito_compras_estado_check;
ALTER TABLE public.notas_credito_compras ADD CONSTRAINT notas_credito_compras_estado_check
  CHECK (estado IN ('emitida', 'anulada', 'regularizada'));

-- ── Registrar la nota por faltante ──────────────────────────────────────────
-- p_items: [{ "compra_item_id": uuid, "cantidad": n }]  (cantidad = lo que acredita)
CREATE OR REPLACE FUNCTION public.registrar_nota_faltante(
  p_compra_id uuid, p_numero text, p_fecha date, p_motivo text, p_items jsonb, p_total_documento numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT; v_compra RECORD; v_it jsonb; v_ci RECORD; v_cant NUMERIC; v_pend NUMERIC; v_nota_id UUID;
  v_total NUMERIC := 0; v_abs NUMERIC; v_base NUMERIC; v_numero TEXT; v_doc TEXT; v_vistos UUID[] := '{}';
  v_faltante_total NUMERIC; v_acreditado NUMERIC; v_regularizada BOOLEAN := FALSE;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'almacenero') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o almacén pueden registrar notas del proveedor';
  END IF;
  v_numero := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_numero, '')), '\s+', '', 'g'));
  IF v_numero = '' THEN RAISE EXCEPTION 'Falta el número de la nota (por ejemplo E001-4)'; END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN RAISE EXCEPTION 'Falta el motivo de la nota'; END IF;
  IF p_fecha IS NULL OR p_fecha > (NOW() AT TIME ZONE 'America/Lima')::date + 1 THEN RAISE EXCEPTION 'Fecha de la nota inválida'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto a la nota';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La compra no existe'; END IF;
  v_doc := COALESCE(v_compra.numero_factura_proveedor, 'sin número');
  IF v_compra.documento_interno THEN RAISE EXCEPTION 'La compra % es un documento interno: no admite notas', v_doc; END IF;
  IF v_compra.estado::text IN ('anulado', 'anulada') THEN RAISE EXCEPTION 'La compra % está anulada', v_doc; END IF;
  IF v_compra.estado::text <> 'aplicada' THEN
    RAISE EXCEPTION 'La compra % todavía no está aplicada (está %): primero valida la recepción con lo que llegó y aplícala', v_doc, v_compra.estado;
  END IF;
  IF EXISTS (SELECT 1 FROM notas_proveedor WHERE proveedor_id = v_compra.proveedor_id AND tipo = 'credito'
               AND estado = 'aplicada' AND UPPER(REPLACE(numero, ' ', '')) = v_numero) THEN
    RAISE EXCEPTION 'La nota % de este proveedor ya está registrada', v_numero;
  END IF;

  INSERT INTO notas_proveedor (tipo, motivo_tipo, compra_id, proveedor_id, numero, fecha_emision, motivo, subtotal, igv, total, created_by)
  VALUES ('credito', 'faltante', p_compra_id, v_compra.proveedor_id, v_numero, p_fecha, TRIM(p_motivo), 0, 0, 0, auth.uid())
  RETURNING id INTO v_nota_id;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT ci.*, COALESCE(NULLIF(TRIM(p.descripcion), ''), p.nombre) AS producto INTO v_ci
      FROM compras_items ci JOIN productos p ON p.id = ci.producto_id
     WHERE ci.id = (v_it->>'compra_item_id')::uuid AND ci.compra_id = p_compra_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los productos no pertenece a la compra %', v_doc; END IF;
    IF v_ci.id = ANY(v_vistos) THEN RAISE EXCEPTION '% está repetido en la nota', v_ci.producto; END IF;
    v_vistos := v_vistos || v_ci.id;
    v_cant := (v_it->>'cantidad')::numeric;
    IF v_cant IS NULL OR v_cant <= 0 THEN RAISE EXCEPTION 'Cantidad inválida en %', v_ci.producto; END IF;
    -- Lo que faltó y todavía no tiene nota del proveedor
    v_pend := v_ci.cantidad - COALESCE(v_ci.cantidad_recibida, v_ci.cantidad)
      - COALESCE((SELECT SUM(i.cantidad) FROM notas_proveedor_items i JOIN notas_proveedor n ON n.id = i.nota_id
                   WHERE i.compra_item_id = v_ci.id AND n.estado = 'aplicada' AND n.motivo_tipo = 'faltante'), 0);
    IF v_pend <= 0 THEN
      RAISE EXCEPTION '%: no tiene faltante pendiente (se facturó % y se recibió %)', v_ci.producto,
        trim_scale(v_ci.cantidad), trim_scale(COALESCE(v_ci.cantidad_recibida, v_ci.cantidad));
    END IF;
    IF v_cant > v_pend + 0.0001 THEN
      RAISE EXCEPTION '%: la nota acredita % pero el faltante pendiente es %', v_ci.producto, trim_scale(v_cant), trim_scale(v_pend);
    END IF;
    INSERT INTO notas_proveedor_items (nota_id, compra_item_id, producto_id, cantidad, precio_facturado, precio_correcto,
      diferencia_unitaria, importe, unidades_en_stock, importe_a_stock, importe_a_costo_ventas)
    VALUES (v_nota_id, v_ci.id, v_ci.producto_id, v_cant, v_ci.precio_unitario, v_ci.precio_unitario,
      -v_ci.precio_unitario, -ROUND(v_cant * v_ci.precio_unitario, 2), 0, 0, 0);
    v_total := v_total + ROUND(v_cant * v_ci.precio_unitario, 2);
  END LOOP;

  IF p_total_documento IS NULL OR ABS(v_total - p_total_documento) > 0.05 THEN
    RAISE EXCEPTION 'Lo cargado suma S/ % y la nota dice S/ %. Revisa las cantidades', TO_CHAR(v_total, 'FM999999990.00'),
      TO_CHAR(COALESCE(p_total_documento, 0), 'FM999999990.00');
  END IF;
  v_abs := ROUND(p_total_documento, 2);
  v_base := CASE WHEN v_compra.incluir_igv THEN ROUND(v_abs / (1 + COALESCE(igv_vigente(), 18) / 100.0), 2) ELSE v_abs END;
  UPDATE notas_proveedor SET subtotal = v_base, igv = v_abs - v_base, total = v_abs WHERE id = v_nota_id;

  -- La nota interna del faltante queda regularizada cuando las notas del
  -- proveedor cubren todo lo que faltó.
  SELECT COALESCE(SUM(ci.cantidad - COALESCE(ci.cantidad_recibida, ci.cantidad)), 0) INTO v_faltante_total
    FROM compras_items ci WHERE ci.compra_id = p_compra_id;
  SELECT COALESCE(SUM(i.cantidad), 0) INTO v_acreditado
    FROM notas_proveedor_items i JOIN notas_proveedor n ON n.id = i.nota_id
   WHERE n.compra_id = p_compra_id AND n.estado = 'aplicada' AND n.motivo_tipo = 'faltante';
  IF v_acreditado >= v_faltante_total - 0.0001 THEN
    UPDATE notas_credito_compras SET estado = 'regularizada', nota_proveedor_id = v_nota_id
     WHERE compra_id = p_compra_id AND estado = 'emitida';
    v_regularizada := FOUND;
  END IF;

  RETURN jsonb_build_object('id', v_nota_id, 'numero', v_numero, 'subtotal', v_base, 'igv', v_abs - v_base, 'total', v_abs,
    'regulariza_interna', v_regularizada);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registrar_nota_faltante(uuid, text, date, text, jsonb, numeric) TO authenticated;

-- ── Anular: la nota interna vuelve a quedar pendiente ───────────────────────
CREATE OR REPLACE FUNCTION public.anular_nota_proveedor(p_nota_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT; v_nota RECORD; v_it RECORD; v_r jsonb;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administración o gerencia pueden anular una nota del proveedor';
  END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN RAISE EXCEPTION 'Indica el motivo de la anulación'; END IF;
  SELECT * INTO v_nota FROM notas_proveedor WHERE id = p_nota_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La nota no existe'; END IF;
  IF v_nota.estado = 'anulada' THEN RAISE EXCEPTION 'La nota % ya está anulada', v_nota.numero; END IF;

  -- Solo las de precio movieron el costo (las de faltante no tocan nada).
  FOR v_it IN SELECT * FROM notas_proveedor_items WHERE nota_id = p_nota_id LOOP
    IF v_it.unidades_en_stock > 0 AND v_it.importe_a_stock <> 0 THEN
      v_r := _ajustar_costo_producto(v_it.producto_id, -v_it.importe_a_stock / v_it.unidades_en_stock,
               v_it.unidades_en_stock, p_nota_id, 'Anulación de la nota ' || v_nota.numero);
    END IF;
  END LOOP;

  UPDATE notas_credito_compras SET estado = 'emitida', nota_proveedor_id = NULL
   WHERE nota_proveedor_id = p_nota_id AND estado = 'regularizada';
  UPDATE notas_proveedor SET estado = 'anulada', motivo_anulacion = TRIM(p_motivo), anulada_at = NOW(), anulada_por = auth.uid()
   WHERE id = p_nota_id;
  RETURN jsonb_build_object('id', p_nota_id, 'numero', v_nota.numero, 'anulada', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.anular_nota_proveedor(uuid, text) TO authenticated;

-- ── El costo del producto sigue al inventario, al aplicar y al revertir ─────
DROP TRIGGER IF EXISTS trg_actualizar_costo_compras ON public.compras_items;

CREATE OR REPLACE FUNCTION public.aplicar_compra(p_compra_id uuid)
 RETURNS TABLE(nota_credito_id uuid, nota_credito_total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_compra RECORD;
BEGIN
  SELECT id, estado, regulariza_internos INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  IF v_compra.regulariza_internos THEN
    IF v_compra.estado <> 'recibida' THEN
      RAISE EXCEPTION 'Solo se puede aplicar una compra en estado recibida (estado actual: %)', v_compra.estado;
    END IF;
    -- La mercadería ya entró con los documentos internos: no se toca el stock.
    UPDATE compras SET estado = 'aplicada' WHERE id = p_compra_id;
    RETURN QUERY SELECT NULL::uuid, 0::numeric;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM _aplicar_compra_con_stock(p_compra_id);
  -- El costo del producto queda igual al del inventario (lo recibido, no lo facturado).
  UPDATE productos p SET costo_promedio = s.costo_promedio
    FROM stock s
   WHERE s.producto_id = p.id
     AND p.id IN (SELECT producto_id FROM compras_items WHERE compra_id = p_compra_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.aplicar_compra(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revertir_compra(p_compra_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_compra RECORD;
  v_notas TEXT;
BEGIN
  SELECT id, estado, regulariza_internos INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  SELECT string_agg(numero, ', ') INTO v_notas FROM notas_proveedor WHERE compra_id = p_compra_id AND estado = 'aplicada';
  IF v_notas IS NOT NULL THEN
    RAISE EXCEPTION 'La compra tiene notas del proveedor vigentes (%): anúlalas antes de revertirla', v_notas;
  END IF;
  IF v_compra.regulariza_internos THEN
    IF v_compra.estado <> 'aplicada' THEN
      RAISE EXCEPTION 'Solo se puede revertir una compra aplicada (estado actual: %)', v_compra.estado;
    END IF;
    UPDATE compras SET estado = 'registrada' WHERE id = p_compra_id;
    RETURN;
  END IF;
  PERFORM _revertir_compra_con_stock(p_compra_id);
  UPDATE productos p SET costo_promedio = s.costo_promedio
    FROM stock s
   WHERE s.producto_id = p.id
     AND p.id IN (SELECT producto_id FROM compras_items WHERE compra_id = p_compra_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.revertir_compra(uuid) TO authenticated;
