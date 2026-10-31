-- Notas de débito y de crédito del proveedor sobre una compra ya aplicada.
--
-- Daniel, 31/10/2026: Ti-Cay facturó el queso cheddar President (F001-119512)
-- a S/ 6.40 y después emitió la nota de débito F001-00000082 por la
-- diferencia: el precio correcto era S/ 7.50 (504 u. × 1.10 = S/ 554.40). La
-- compra ya estaba aplicada y no había dónde registrar la nota.
--
-- Cómo se maneja:
--   * La factura original no se toca: es el documento tal como lo emitió el
--     proveedor. La nota es un comprobante propio (08 débito, 07 crédito) que
--     la referencia, y entra al Registro de compras y al SIRE.
--   * La diferencia es parte del costo de compra. La que corresponde a las
--     unidades que siguen en stock sube (o baja) el costo promedio; la de las
--     unidades ya vendidas va al costo de ventas (queda registrada en la nota).
--   * En el kárdex queda un movimiento de "ajuste" con cantidad 0 y el costo
--     nuevo: cambia el valor, no las unidades.
--
-- Los precios son con IGV, igual que las compras (compras_items.precio_unitario
-- y el costo promedio van con IGV en este sistema).

-- ── Tablas ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notas_proveedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('debito', 'credito')),
  compra_id UUID NOT NULL REFERENCES public.compras(id) ON DELETE RESTRICT,
  proveedor_id UUID REFERENCES public.proveedores(id),
  numero TEXT NOT NULL,
  fecha_emision DATE NOT NULL,
  motivo TEXT NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL,
  igv NUMERIC(12, 2) NOT NULL,
  total NUMERIC(12, 2) NOT NULL,
  -- Con signo: positivo sube el costo (débito), negativo lo baja (crédito).
  importe_a_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
  importe_a_costo_ventas NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'aplicada' CHECK (estado IN ('aplicada', 'anulada')),
  motivo_anulacion TEXT,
  anulada_at TIMESTAMPTZ,
  anulada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Un mismo documento del proveedor no se registra dos veces (salvo anulado).
CREATE UNIQUE INDEX IF NOT EXISTS notas_proveedor_doc_unico
  ON public.notas_proveedor (proveedor_id, tipo, UPPER(REPLACE(numero, ' ', '')))
  WHERE estado = 'aplicada';
CREATE INDEX IF NOT EXISTS notas_proveedor_compra ON public.notas_proveedor (compra_id);
CREATE INDEX IF NOT EXISTS notas_proveedor_fecha ON public.notas_proveedor (fecha_emision);

CREATE TABLE IF NOT EXISTS public.notas_proveedor_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id UUID NOT NULL REFERENCES public.notas_proveedor(id) ON DELETE CASCADE,
  compra_item_id UUID NOT NULL REFERENCES public.compras_items(id) ON DELETE RESTRICT,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad NUMERIC(14, 4) NOT NULL CHECK (cantidad > 0),
  precio_facturado NUMERIC(14, 4) NOT NULL,
  precio_correcto NUMERIC(14, 4) NOT NULL CHECK (precio_correcto >= 0),
  diferencia_unitaria NUMERIC(14, 4) NOT NULL,
  importe NUMERIC(12, 2) NOT NULL,
  unidades_en_stock NUMERIC(14, 4) NOT NULL DEFAULT 0,
  importe_a_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
  importe_a_costo_ventas NUMERIC(12, 2) NOT NULL DEFAULT 0,
  costo_anterior NUMERIC(12, 4),
  costo_nuevo NUMERIC(12, 4)
);
CREATE INDEX IF NOT EXISTS notas_proveedor_items_nota ON public.notas_proveedor_items (nota_id);

ALTER TABLE public.notas_proveedor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_proveedor_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notas_proveedor_select ON public.notas_proveedor;
CREATE POLICY notas_proveedor_select ON public.notas_proveedor FOR SELECT
  USING (has_role(VARIADIC ARRAY['gerente', 'administrador', 'almacenero', 'contador']));
DROP POLICY IF EXISTS notas_proveedor_items_select ON public.notas_proveedor_items;
CREATE POLICY notas_proveedor_items_select ON public.notas_proveedor_items FOR SELECT
  USING (has_role(VARIADIC ARRAY['gerente', 'administrador', 'almacenero', 'contador']));
-- Se escriben solo por las funciones de abajo.

-- ── Mover el costo de un producto ───────────────────────────────────────────
-- Reparte un importe (con signo) sobre el stock actual: lo que corresponde a
-- unidades que siguen en stock cambia el costo promedio; el resto va al costo
-- de ventas. Devuelve lo que hizo, para guardarlo en la nota.
CREATE OR REPLACE FUNCTION public._ajustar_costo_producto(
  p_producto_id uuid, p_diferencia_unitaria numeric, p_unidades numeric,
  p_referencia_id uuid, p_nota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock NUMERIC; v_costo NUMERIC; v_en_stock NUMERIC; v_a_stock NUMERIC;
  v_nuevo NUMERIC; v_total NUMERIC;
BEGIN
  v_total := ROUND(p_diferencia_unitaria * p_unidades, 2);
  SELECT cantidad, costo_promedio INTO v_stock, v_costo FROM stock WHERE producto_id = p_producto_id FOR UPDATE;
  v_stock := COALESCE(v_stock, 0); v_costo := COALESCE(v_costo, 0);
  v_en_stock := LEAST(p_unidades, GREATEST(v_stock, 0));
  v_a_stock := ROUND(p_diferencia_unitaria * v_en_stock, 2);
  v_nuevo := v_costo;
  IF v_en_stock > 0 THEN
    v_nuevo := v_costo + (p_diferencia_unitaria * v_en_stock) / v_stock;
    -- Una rebaja no puede dejar el costo negativo: lo que sobra, al costo de ventas.
    IF v_nuevo < 0 THEN
      v_a_stock := ROUND(-v_costo * v_stock, 2);
      v_nuevo := 0;
    END IF;
    UPDATE stock SET costo_promedio = v_nuevo, updated_at = NOW() WHERE producto_id = p_producto_id;
    UPDATE productos SET costo_promedio = v_nuevo WHERE id = p_producto_id;
    INSERT INTO movimientos_stock (producto_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id, notas, created_by)
    VALUES (p_producto_id, 'ajuste', 0, v_nuevo, 'nota_proveedor', p_referencia_id,
            p_nota || ': costo ' || TO_CHAR(v_costo, 'FM999990.00') || ' → ' || TO_CHAR(v_nuevo, 'FM999990.00')
              || ' (' || TO_CHAR(v_en_stock, 'FM9999990.##') || ' u. en stock)', auth.uid());
  END IF;
  RETURN jsonb_build_object('en_stock', v_en_stock, 'a_stock', v_a_stock, 'a_costo_ventas', v_total - v_a_stock,
                            'costo_anterior', v_costo, 'costo_nuevo', v_nuevo);
END;
$function$;
REVOKE ALL ON FUNCTION public._ajustar_costo_producto(uuid, numeric, numeric, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Registrar la nota ───────────────────────────────────────────────────────
-- p_items: [{ "compra_item_id": uuid, "cantidad": n, "precio_correcto": n }]
-- p_total_documento: el total impreso en la nota, para comprobar que lo
-- cargado coincide con el papel.
CREATE OR REPLACE FUNCTION public.registrar_nota_proveedor(
  p_compra_id uuid, p_tipo text, p_numero text, p_fecha date, p_motivo text,
  p_items jsonb, p_total_documento numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT; v_compra RECORD; v_it jsonb; v_ci RECORD; v_cant NUMERIC; v_precio NUMERIC; v_dif NUMERIC;
  v_nota_id UUID; v_total NUMERIC := 0; v_abs NUMERIC; v_base NUMERIC; v_igv_pct NUMERIC;
  v_r jsonb; v_a_stock NUMERIC := 0; v_a_cv NUMERIC := 0; v_numero TEXT; v_vistos UUID[] := '{}';
  v_doc TEXT; v_detalle jsonb := '[]'::jsonb;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'almacenero') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o almacén pueden registrar notas del proveedor';
  END IF;
  IF p_tipo NOT IN ('debito', 'credito') THEN RAISE EXCEPTION 'La nota debe ser de débito o de crédito'; END IF;
  v_numero := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_numero, '')), '\s+', '', 'g'));
  IF v_numero = '' THEN RAISE EXCEPTION 'Falta el número de la nota (por ejemplo F001-00000082)'; END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN RAISE EXCEPTION 'Falta el motivo de la nota'; END IF;
  IF p_fecha IS NULL OR p_fecha > (NOW() AT TIME ZONE 'America/Lima')::date + 1 THEN
    RAISE EXCEPTION 'Fecha de la nota inválida';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto a la nota';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La compra no existe'; END IF;
  v_doc := COALESCE(v_compra.numero_factura_proveedor, 'sin número');
  IF v_compra.documento_interno THEN
    RAISE EXCEPTION 'La compra % es un documento interno: no admite notas de débito o crédito', v_doc;
  END IF;
  IF v_compra.estado::text IN ('anulado', 'anulada') THEN RAISE EXCEPTION 'La compra % está anulada', v_doc; END IF;
  IF v_compra.estado::text <> 'aplicada' THEN
    RAISE EXCEPTION 'La compra % todavía no está aplicada (está %): corrige el precio en la misma compra antes de aplicarla',
      v_doc, v_compra.estado;
  END IF;
  IF EXISTS (SELECT 1 FROM notas_proveedor WHERE proveedor_id = v_compra.proveedor_id AND tipo = p_tipo
               AND estado = 'aplicada' AND UPPER(REPLACE(numero, ' ', '')) = v_numero) THEN
    RAISE EXCEPTION 'La nota % de este proveedor ya está registrada', v_numero;
  END IF;

  INSERT INTO notas_proveedor (tipo, compra_id, proveedor_id, numero, fecha_emision, motivo, subtotal, igv, total, created_by)
  VALUES (p_tipo, p_compra_id, v_compra.proveedor_id, v_numero, p_fecha, TRIM(p_motivo), 0, 0, 0, auth.uid())
  RETURNING id INTO v_nota_id;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT ci.*, p.codigo, COALESCE(NULLIF(TRIM(p.descripcion), ''), p.nombre) AS producto
      INTO v_ci
      FROM compras_items ci JOIN productos p ON p.id = ci.producto_id
     WHERE ci.id = (v_it->>'compra_item_id')::uuid AND ci.compra_id = p_compra_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uno de los productos no pertenece a la compra %', v_doc; END IF;
    IF v_ci.id = ANY(v_vistos) THEN RAISE EXCEPTION '% está repetido en la nota', v_ci.producto; END IF;
    v_vistos := v_vistos || v_ci.id;

    v_cant := (v_it->>'cantidad')::numeric;
    v_precio := (v_it->>'precio_correcto')::numeric;
    IF v_cant IS NULL OR v_cant <= 0 THEN RAISE EXCEPTION 'Cantidad inválida en %', v_ci.producto; END IF;
    IF v_cant > COALESCE(v_ci.cantidad_recibida, v_ci.cantidad) THEN
      RAISE EXCEPTION '%: la cantidad (%) supera lo comprado (%)', v_ci.producto, trim_scale(v_cant), trim_scale(COALESCE(v_ci.cantidad_recibida, v_ci.cantidad));
    END IF;
    IF v_precio IS NULL OR v_precio < 0 THEN RAISE EXCEPTION 'Precio correcto inválido en %', v_ci.producto; END IF;
    v_dif := v_precio - v_ci.precio_unitario;
    IF p_tipo = 'debito' AND v_dif <= 0 THEN
      RAISE EXCEPTION '%: en una nota de débito el precio correcto (%) tiene que ser mayor al facturado (%)', v_ci.producto, trim_scale(v_precio), trim_scale(v_ci.precio_unitario);
    END IF;
    IF p_tipo = 'credito' AND v_dif >= 0 THEN
      RAISE EXCEPTION '%: en una nota de crédito el precio correcto (%) tiene que ser menor al facturado (%)', v_ci.producto, trim_scale(v_precio), trim_scale(v_ci.precio_unitario);
    END IF;

    v_r := _ajustar_costo_producto(v_ci.producto_id, v_dif, v_cant, v_nota_id,
             CASE WHEN p_tipo = 'debito' THEN 'Nota de débito ' ELSE 'Nota de crédito ' END || v_numero || ' (' || v_doc || ')');
    INSERT INTO notas_proveedor_items (nota_id, compra_item_id, producto_id, cantidad, precio_facturado, precio_correcto,
      diferencia_unitaria, importe, unidades_en_stock, importe_a_stock, importe_a_costo_ventas, costo_anterior, costo_nuevo)
    VALUES (v_nota_id, v_ci.id, v_ci.producto_id, v_cant, v_ci.precio_unitario, v_precio, v_dif, ROUND(v_cant * v_dif, 2),
      (v_r->>'en_stock')::numeric, (v_r->>'a_stock')::numeric, (v_r->>'a_costo_ventas')::numeric,
      (v_r->>'costo_anterior')::numeric, (v_r->>'costo_nuevo')::numeric);
    v_total := v_total + ROUND(v_cant * v_dif, 2);
    v_a_stock := v_a_stock + (v_r->>'a_stock')::numeric;
    v_a_cv := v_a_cv + (v_r->>'a_costo_ventas')::numeric;
    v_detalle := v_detalle || jsonb_build_object('producto', v_ci.producto, 'costo_anterior', ROUND((v_r->>'costo_anterior')::numeric, 4),
      'costo_nuevo', ROUND((v_r->>'costo_nuevo')::numeric, 4), 'en_stock', (v_r->>'en_stock')::numeric);
  END LOOP;

  v_abs := ABS(v_total);
  IF p_total_documento IS NULL OR ABS(v_abs - p_total_documento) > 0.05 THEN
    RAISE EXCEPTION 'Lo cargado suma S/ % y la nota dice S/ %. Revisa cantidades y precios', TO_CHAR(v_abs, 'FM999999990.00'),
      TO_CHAR(COALESCE(p_total_documento, 0), 'FM999999990.00');
  END IF;
  -- El total manda: es lo que está impreso. Base e IGV se desglosan de él.
  v_abs := ROUND(p_total_documento, 2);
  IF v_compra.incluir_igv THEN
    v_igv_pct := COALESCE(igv_vigente(), 18);
    v_base := ROUND(v_abs / (1 + v_igv_pct / 100.0), 2);
  ELSE
    v_base := v_abs;
  END IF;
  UPDATE notas_proveedor
     SET subtotal = v_base, igv = v_abs - v_base, total = v_abs,
         importe_a_stock = v_a_stock, importe_a_costo_ventas = v_a_cv
   WHERE id = v_nota_id;

  RETURN jsonb_build_object('id', v_nota_id, 'numero', v_numero, 'subtotal', v_base, 'igv', v_abs - v_base, 'total', v_abs,
    'a_stock', v_a_stock, 'a_costo_ventas', v_a_cv, 'productos', v_detalle);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registrar_nota_proveedor(uuid, text, text, date, text, jsonb, numeric) TO authenticated;

-- ── Anular una nota mal cargada ─────────────────────────────────────────────
-- Devuelve el costo: la parte que había ido al stock se revierte sobre el
-- stock actual (lo que ya no esté, al costo de ventas).
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

  FOR v_it IN SELECT * FROM notas_proveedor_items WHERE nota_id = p_nota_id LOOP
    IF v_it.unidades_en_stock > 0 AND v_it.importe_a_stock <> 0 THEN
      v_r := _ajustar_costo_producto(v_it.producto_id, -v_it.importe_a_stock / v_it.unidades_en_stock,
               v_it.unidades_en_stock, p_nota_id, 'Anulación de la nota ' || v_nota.numero);
    END IF;
  END LOOP;

  UPDATE notas_proveedor SET estado = 'anulada', motivo_anulacion = TRIM(p_motivo), anulada_at = NOW(), anulada_por = auth.uid()
   WHERE id = p_nota_id;
  RETURN jsonb_build_object('id', p_nota_id, 'numero', v_nota.numero, 'anulada', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.anular_nota_proveedor(uuid, text) TO authenticated;

-- ── Registro de compras: las notas van como documento propio ───────────────
CREATE OR REPLACE FUNCTION public.registro_compras(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'El registro de compras es solo para gerencia';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;
  IF p_hasta - p_desde > 400 THEN RAISE EXCEPTION 'El rango no puede pasar de un año'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(f ORDER BY f.fecha, f.documento) FROM (
      SELECT co.id, co.fecha, COALESCE(co.numero_factura_proveedor, '—') AS documento,
             CASE WHEN co.documento_interno THEN 'interno'
                  WHEN co.regulariza_internos THEN 'regulariza'
                  ELSE 'factura' END AS tipo,
             co.estado::text AS estado,
             COALESCE(pr.razon_social, '—') AS proveedor, COALESCE(pr.ruc, '') AS ruc,
             COALESCE(co.subtotal, 0) AS base, COALESCE(co.igv, 0) AS igv, COALESCE(co.total, 0) AS total,
             (SELECT COUNT(*) FROM compras_items ci WHERE ci.compra_id = co.id) AS lineas,
             NULL::text AS referencia
        FROM compras co
        LEFT JOIN proveedores pr ON pr.id = co.proveedor_id
       WHERE co.fecha BETWEEN p_desde AND p_hasta
      UNION ALL
      -- Las notas de crédito restan: van con signo negativo.
      SELECT np.id, np.fecha_emision, np.numero,
             CASE WHEN np.tipo = 'debito' THEN 'nota_debito' ELSE 'nota_credito' END,
             np.estado,
             COALESCE(pr.razon_social, '—'), COALESCE(pr.ruc, ''),
             CASE WHEN np.tipo = 'credito' THEN -np.subtotal ELSE np.subtotal END,
             CASE WHEN np.tipo = 'credito' THEN -np.igv ELSE np.igv END,
             CASE WHEN np.tipo = 'credito' THEN -np.total ELSE np.total END,
             (SELECT COUNT(*) FROM notas_proveedor_items i WHERE i.nota_id = np.id),
             co.numero_factura_proveedor
        FROM notas_proveedor np
        JOIN compras co ON co.id = np.compra_id
        LEFT JOIN proveedores pr ON pr.id = np.proveedor_id
       WHERE np.fecha_emision BETWEEN p_desde AND p_hasta
    ) f), '[]'::jsonb);
END;
$function$;

-- ── SIRE: las notas con su tipo de comprobante (07 crédito, 08 débito) ─────
CREATE OR REPLACE FUNCTION public.sire_registro_compras(p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  filas AS (
    SELECT
      co.fecha,
      '01' AS tipo_cpe,  -- factura (las compras registradas son con factura)
      -- Parse serie-numero del campo libre numero_factura_proveedor "F001-00012345"
      COALESCE(NULLIF(SPLIT_PART(co.numero_factura_proveedor, '-', 1), ''), '-') AS serie,
      COALESCE(NULLIF(SPLIT_PART(co.numero_factura_proveedor, '-', 2), ''), co.numero_factura_proveedor, '-') AS numero,
      '6' AS tipo_doc_proveedor,
      COALESCE(pr.ruc, '-') AS ruc_proveedor,
      COALESCE(pr.razon_social, 'SIN PROVEEDOR') AS razon_social,
      co.subtotal AS base_imponible,
      co.igv,
      co.total,
      co.estado::text AS estado,
      co.id
    FROM compras co
    LEFT JOIN proveedores pr ON pr.id = co.proveedor_id
    CROSS JOIN rango r
    WHERE co.fecha BETWEEN r.desde AND r.hasta
      -- Un documento interno no es comprobante: no se informa a SUNAT.
      AND NOT co.documento_interno
    UNION ALL
    SELECT
      np.fecha_emision,
      CASE WHEN np.tipo = 'debito' THEN '08' ELSE '07' END,
      COALESCE(NULLIF(SPLIT_PART(np.numero, '-', 1), ''), '-'),
      COALESCE(NULLIF(SPLIT_PART(np.numero, '-', 2), ''), np.numero, '-'),
      '6',
      COALESCE(pr.ruc, '-'),
      COALESCE(pr.razon_social, 'SIN PROVEEDOR'),
      CASE WHEN np.tipo = 'credito' THEN -np.subtotal ELSE np.subtotal END,
      CASE WHEN np.tipo = 'credito' THEN -np.igv ELSE np.igv END,
      CASE WHEN np.tipo = 'credito' THEN -np.total ELSE np.total END,
      np.estado,
      np.id
    FROM notas_proveedor np
    LEFT JOIN proveedores pr ON pr.id = np.proveedor_id
    CROSS JOIN rango r
    WHERE np.fecha_emision BETWEEN r.desde AND r.hasta
  )
  SELECT jsonb_build_object(
    'periodo', LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0'),
    'filas', COALESCE((SELECT jsonb_agg(row_to_json(f) ORDER BY f.fecha, f.serie, f.numero) FROM filas f), '[]'::jsonb),
    -- Las compras anuladas quedan como 'anulado' y las notas como 'anulada':
    -- antes solo se excluía 'anulada' y una compra anulada habría sumado.
    'total_base', COALESCE((SELECT SUM(base_imponible) FROM filas WHERE estado NOT IN ('anulado', 'anulada')), 0),
    'total_igv', COALESCE((SELECT SUM(igv) FROM filas WHERE estado NOT IN ('anulado', 'anulada')), 0),
    'total_total', COALESCE((SELECT SUM(total) FROM filas WHERE estado NOT IN ('anulado', 'anulada')), 0),
    'cantidad', (SELECT COUNT(*) FROM filas)
  );
$function$;
