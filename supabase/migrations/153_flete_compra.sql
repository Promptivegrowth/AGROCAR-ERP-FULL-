-- Flete (y otros gastos de traer la mercadería) prorrateado al costo de la compra.
--
-- Daniel, 31/10/2026: El Catalán le facturó aparte el transporte del mondongo
-- (F003-3962, "SERVICIO DE TRANSPORTE", S/ 1,592.25 con detracción de S/ 64)
-- y antes ese flete lo prorrateaba a mano en el costo. A veces el flete viene
-- con factura, otras con recibo por honorarios y otras sin comprobante.
--
-- Cómo se maneja:
--   * El flete se registra aparte, enganchado a la compra que trajo: la factura
--     de la mercadería no se toca.
--   * El total se reparte entre los productos de la compra según lo RECIBIDO,
--     por valor (lo de siempre) o por cantidad (útil cuando todo va en kilos).
--   * Cada parte sube el costo como una nota de débito: lo que corresponde a
--     unidades que siguen en stock sube el costo promedio; lo ya vendido va al
--     costo de ventas. En el kárdex queda un "ajuste" con cantidad 0.
--   * Va con IGV, igual que todo costo en este sistema (compras y costo
--     promedio son con IGV).
--   * Factura: entra al Registro de compras y al SIRE como comprobante 01, con
--     su base e IGV (crédito fiscal). Recibo por honorarios o sin comprobante:
--     no tienen IGV ni van al SIRE; en el Registro de compras de gerencia suman
--     con lo "sin factura".
--   * La detracción se guarda como dato (lo que se deposita en el Banco de la
--     Nación); el sistema no lleva cuentas por pagar a proveedores.

-- ── Tablas ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gastos_compra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id UUID NOT NULL REFERENCES public.compras(id) ON DELETE RESTRICT,
  comprobante TEXT NOT NULL CHECK (comprobante IN ('factura', 'recibo_honorarios', 'ninguno')),
  proveedor_id UUID REFERENCES public.proveedores(id),
  numero TEXT,
  fecha_emision DATE NOT NULL,
  concepto TEXT NOT NULL,
  base_prorrateo TEXT NOT NULL CHECK (base_prorrateo IN ('valor', 'cantidad')),
  subtotal NUMERIC(12, 2) NOT NULL,
  igv NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL CHECK (total > 0),
  detraccion NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (detraccion >= 0),
  importe_a_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
  importe_a_costo_ventas NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'aplicada' CHECK (estado IN ('aplicada', 'anulada')),
  motivo_anulacion TEXT,
  anulada_at TIMESTAMPTZ,
  anulada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Un mismo comprobante no se registra dos veces (salvo anulado).
CREATE UNIQUE INDEX IF NOT EXISTS gastos_compra_doc_unico
  ON public.gastos_compra (proveedor_id, comprobante, numero)
  WHERE estado = 'aplicada' AND comprobante <> 'ninguno';
CREATE INDEX IF NOT EXISTS gastos_compra_compra ON public.gastos_compra (compra_id);
CREATE INDEX IF NOT EXISTS gastos_compra_fecha ON public.gastos_compra (fecha_emision);

CREATE TABLE IF NOT EXISTS public.gastos_compra_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id UUID NOT NULL REFERENCES public.gastos_compra(id) ON DELETE CASCADE,
  compra_item_id UUID NOT NULL REFERENCES public.compras_items(id) ON DELETE RESTRICT,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad NUMERIC(14, 4) NOT NULL,           -- lo recibido
  base_reparto NUMERIC(14, 4) NOT NULL,       -- valor o cantidad, según base_prorrateo
  importe NUMERIC(12, 2) NOT NULL,            -- la parte del flete
  por_unidad NUMERIC(14, 6) NOT NULL,
  unidades_en_stock NUMERIC(14, 4) NOT NULL DEFAULT 0,
  importe_a_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
  importe_a_costo_ventas NUMERIC(12, 2) NOT NULL DEFAULT 0,
  costo_anterior NUMERIC(12, 4),
  costo_nuevo NUMERIC(12, 4)
);
CREATE INDEX IF NOT EXISTS gastos_compra_items_gasto ON public.gastos_compra_items (gasto_id);

ALTER TABLE public.gastos_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos_compra_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gastos_compra_select ON public.gastos_compra;
CREATE POLICY gastos_compra_select ON public.gastos_compra FOR SELECT
  USING (has_role(VARIADIC ARRAY['gerente', 'administrador', 'almacenero', 'contador']));
DROP POLICY IF EXISTS gastos_compra_items_select ON public.gastos_compra_items;
CREATE POLICY gastos_compra_items_select ON public.gastos_compra_items FOR SELECT
  USING (has_role(VARIADIC ARRAY['gerente', 'administrador', 'almacenero', 'contador']));
-- Se escriben solo por las funciones de abajo.

-- ── El ajuste de costo dice de dónde viene ─────────────────────────────────
-- Igual que en la migración 150, con el tipo de referencia del kárdex como
-- parámetro (las notas siguen llamándola con 5 argumentos).
DROP FUNCTION IF EXISTS public._ajustar_costo_producto(uuid, numeric, numeric, uuid, text);
CREATE OR REPLACE FUNCTION public._ajustar_costo_producto(
  p_producto_id uuid, p_diferencia_unitaria numeric, p_unidades numeric,
  p_referencia_id uuid, p_nota text, p_referencia_tipo text DEFAULT 'nota_proveedor')
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
    VALUES (p_producto_id, 'ajuste', 0, v_nuevo, p_referencia_tipo, p_referencia_id,
            p_nota || ': costo ' || TO_CHAR(v_costo, 'FM999990.00') || ' → ' || TO_CHAR(v_nuevo, 'FM999990.00')
              || ' (' || TO_CHAR(v_en_stock, 'FM9999990.##') || ' u. en stock)', auth.uid());
  END IF;
  RETURN jsonb_build_object('en_stock', v_en_stock, 'a_stock', v_a_stock, 'a_costo_ventas', v_total - v_a_stock,
                            'costo_anterior', v_costo, 'costo_nuevo', v_nuevo);
END;
$function$;
REVOKE ALL ON FUNCTION public._ajustar_costo_producto(uuid, numeric, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ── Registrar el flete ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_gasto_compra(
  p_compra_id uuid, p_comprobante text, p_proveedor_id uuid, p_numero text, p_fecha date,
  p_concepto text, p_base_prorrateo text, p_total numeric, p_detraccion numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT; v_compra RECORD; v_prov RECORD; v_numero TEXT; v_doc TEXT; v_gasto_id UUID;
  v_total NUMERIC; v_base NUMERIC; v_igv NUMERIC; v_suma NUMERIC; v_n INT; v_i INT := 0;
  v_ci RECORD; v_peso NUMERIC; v_importe NUMERIC; v_asignado NUMERIC := 0; v_por_u NUMERIC;
  v_r jsonb; v_a_stock NUMERIC := 0; v_a_cv NUMERIC := 0; v_it_stock NUMERIC; v_detalle jsonb := '[]'::jsonb;
  v_etiqueta TEXT;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'almacenero') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o almacén pueden registrar el flete de una compra';
  END IF;
  IF p_comprobante NOT IN ('factura', 'recibo_honorarios', 'ninguno') THEN
    RAISE EXCEPTION 'El comprobante debe ser factura, recibo por honorarios o ninguno';
  END IF;
  IF p_base_prorrateo NOT IN ('valor', 'cantidad') THEN RAISE EXCEPTION 'El reparto debe ser por valor o por cantidad'; END IF;
  IF COALESCE(TRIM(p_concepto), '') = '' THEN RAISE EXCEPTION 'Falta el concepto (por ejemplo, Flete)'; END IF;
  IF p_fecha IS NULL OR p_fecha > (NOW() AT TIME ZONE 'America/Lima')::date + 1 THEN RAISE EXCEPTION 'Fecha inválida'; END IF;
  v_total := ROUND(COALESCE(p_total, 0), 2);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Falta el total del comprobante'; END IF;

  v_numero := NULLIF(UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_numero, '')), '\s+', '', 'g')), '');
  IF p_comprobante <> 'ninguno' THEN
    IF v_numero IS NULL THEN RAISE EXCEPTION 'Falta el número del comprobante (por ejemplo F003-3962)'; END IF;
    IF p_proveedor_id IS NULL THEN RAISE EXCEPTION 'Elige quién emitió el comprobante'; END IF;
  END IF;
  IF p_proveedor_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM proveedores WHERE id = p_proveedor_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El proveedor no existe'; END IF;
    IF p_comprobante = 'factura' AND COALESCE(LENGTH(TRIM(v_prov.ruc)), 0) <> 11 THEN
      RAISE EXCEPTION '% no tiene RUC registrado: una factura requiere RUC', v_prov.razon_social;
    END IF;
  END IF;
  IF COALESCE(p_detraccion, 0) < 0 OR COALESCE(p_detraccion, 0) >= v_total THEN RAISE EXCEPTION 'Detracción inválida'; END IF;
  IF COALESCE(p_detraccion, 0) > 0 AND p_comprobante <> 'factura' THEN
    RAISE EXCEPTION 'La detracción solo va en una factura';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La compra no existe'; END IF;
  v_doc := COALESCE(v_compra.numero_factura_proveedor, 'sin número');
  IF v_compra.estado::text IN ('anulado', 'anulada') THEN RAISE EXCEPTION 'La compra % está anulada', v_doc; END IF;
  IF v_compra.estado::text <> 'aplicada' THEN
    RAISE EXCEPTION 'La compra % todavía no está aplicada (está %): primero valida la recepción y aplícala', v_doc, v_compra.estado;
  END IF;
  IF v_numero IS NOT NULL AND p_comprobante <> 'ninguno' AND EXISTS (
       SELECT 1 FROM gastos_compra WHERE proveedor_id = p_proveedor_id AND comprobante = p_comprobante
          AND numero = v_numero AND estado = 'aplicada') THEN
    RAISE EXCEPTION 'El comprobante % de este proveedor ya está registrado', v_numero;
  END IF;

  -- Factura: el total impreso manda; base e IGV se desglosan de él.
  IF p_comprobante = 'factura' THEN
    v_base := ROUND(v_total / (1 + COALESCE(igv_vigente(), 18) / 100.0), 2);
    v_igv := v_total - v_base;
  ELSE
    v_base := v_total; v_igv := 0;
  END IF;

  -- Lo que se reparte: lo recibido de cada línea.
  SELECT COUNT(*), SUM(CASE WHEN p_base_prorrateo = 'valor'
                            THEN COALESCE(cantidad_recibida, cantidad) * precio_unitario
                            ELSE COALESCE(cantidad_recibida, cantidad) END)
    INTO v_n, v_suma
    FROM compras_items WHERE compra_id = p_compra_id AND COALESCE(cantidad_recibida, cantidad) > 0;
  IF COALESCE(v_n, 0) = 0 OR COALESCE(v_suma, 0) <= 0 THEN
    RAISE EXCEPTION 'La compra % no tiene productos recibidos sobre los que repartir el flete', v_doc;
  END IF;

  v_etiqueta := INITCAP(TRIM(p_concepto)) || COALESCE(' ' || v_numero, '') || ' (' || v_doc || ')';
  INSERT INTO gastos_compra (compra_id, comprobante, proveedor_id, numero, fecha_emision, concepto, base_prorrateo,
                             subtotal, igv, total, detraccion, created_by)
  VALUES (p_compra_id, p_comprobante, p_proveedor_id, v_numero, p_fecha, TRIM(p_concepto), p_base_prorrateo,
          v_base, v_igv, v_total, ROUND(COALESCE(p_detraccion, 0), 2), auth.uid())
  RETURNING id INTO v_gasto_id;

  FOR v_ci IN
    SELECT ci.*, COALESCE(ci.cantidad_recibida, ci.cantidad) AS recibido,
           COALESCE(NULLIF(TRIM(p.descripcion), ''), p.nombre) AS producto
      FROM compras_items ci JOIN productos p ON p.id = ci.producto_id
     WHERE ci.compra_id = p_compra_id AND COALESCE(ci.cantidad_recibida, ci.cantidad) > 0
     ORDER BY ci.id
  LOOP
    v_i := v_i + 1;
    v_peso := CASE WHEN p_base_prorrateo = 'valor' THEN v_ci.recibido * v_ci.precio_unitario ELSE v_ci.recibido END;
    -- La última línea se lleva el redondeo: las partes suman exacto el total.
    v_importe := CASE WHEN v_i = v_n THEN v_total - v_asignado ELSE ROUND(v_total * v_peso / v_suma, 2) END;
    v_asignado := v_asignado + v_importe;
    v_por_u := v_importe / v_ci.recibido;
    v_r := _ajustar_costo_producto(v_ci.producto_id, v_por_u, v_ci.recibido, v_gasto_id, v_etiqueta, 'gasto_compra');
    v_it_stock := (v_r->>'a_stock')::numeric;
    INSERT INTO gastos_compra_items (gasto_id, compra_item_id, producto_id, cantidad, base_reparto, importe, por_unidad,
      unidades_en_stock, importe_a_stock, importe_a_costo_ventas, costo_anterior, costo_nuevo)
    VALUES (v_gasto_id, v_ci.id, v_ci.producto_id, v_ci.recibido, v_peso, v_importe, v_por_u,
      (v_r->>'en_stock')::numeric, v_it_stock, v_importe - v_it_stock,
      (v_r->>'costo_anterior')::numeric, (v_r->>'costo_nuevo')::numeric);
    v_a_stock := v_a_stock + v_it_stock;
    v_a_cv := v_a_cv + v_importe - v_it_stock;
    v_detalle := v_detalle || jsonb_build_object('producto', v_ci.producto, 'importe', v_importe,
      'costo_anterior', ROUND((v_r->>'costo_anterior')::numeric, 4), 'costo_nuevo', ROUND((v_r->>'costo_nuevo')::numeric, 4));
  END LOOP;

  UPDATE gastos_compra SET importe_a_stock = v_a_stock, importe_a_costo_ventas = v_a_cv WHERE id = v_gasto_id;
  RETURN jsonb_build_object('id', v_gasto_id, 'numero', v_numero, 'subtotal', v_base, 'igv', v_igv, 'total', v_total,
    'a_stock', v_a_stock, 'a_costo_ventas', v_a_cv, 'productos', v_detalle);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registrar_gasto_compra(uuid, text, uuid, text, date, text, text, numeric, numeric) TO authenticated;

-- ── Anular un flete mal cargado ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_gasto_compra(p_gasto_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT; v_g RECORD; v_it RECORD;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administración o gerencia pueden anular el flete de una compra';
  END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN RAISE EXCEPTION 'Indica el motivo de la anulación'; END IF;
  SELECT * INTO v_g FROM gastos_compra WHERE id = p_gasto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El registro no existe'; END IF;
  IF v_g.estado = 'anulada' THEN RAISE EXCEPTION 'Ya está anulado'; END IF;

  FOR v_it IN SELECT * FROM gastos_compra_items WHERE gasto_id = p_gasto_id LOOP
    IF v_it.unidades_en_stock > 0 AND v_it.importe_a_stock <> 0 THEN
      PERFORM _ajustar_costo_producto(v_it.producto_id, -v_it.importe_a_stock / v_it.unidades_en_stock,
               v_it.unidades_en_stock, p_gasto_id,
               'Anulación de ' || LOWER(v_g.concepto) || COALESCE(' ' || v_g.numero, ''), 'gasto_compra');
    END IF;
  END LOOP;

  UPDATE gastos_compra SET estado = 'anulada', motivo_anulacion = TRIM(p_motivo), anulada_at = NOW(), anulada_por = auth.uid()
   WHERE id = p_gasto_id;
  RETURN jsonb_build_object('id', p_gasto_id, 'anulada', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.anular_gasto_compra(uuid, text) TO authenticated;

-- ── Revertir una compra con flete: primero se anula el flete ───────────────
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
  SELECT string_agg(COALESCE(numero, concepto), ', ') INTO v_notas FROM gastos_compra WHERE compra_id = p_compra_id AND estado = 'aplicada';
  IF v_notas IS NOT NULL THEN
    RAISE EXCEPTION 'La compra tiene flete registrado (%): anúlalo antes de revertirla', v_notas;
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

-- ── Registro de compras de gerencia: el flete como documento propio ────────
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
      UNION ALL
      -- Flete: con factura suma con las facturas; con recibo o sin comprobante, con lo sin factura.
      SELECT g.id, g.fecha_emision,
             COALESCE(g.numero, 'Sin comprobante') || ' · ' || g.concepto,
             CASE WHEN g.comprobante = 'factura' THEN 'flete' ELSE 'flete_sin_factura' END,
             g.estado,
             COALESCE(pr.razon_social, '—'), COALESCE(pr.ruc, ''),
             g.subtotal, g.igv, g.total,
             (SELECT COUNT(*) FROM gastos_compra_items i WHERE i.gasto_id = g.id),
             co.numero_factura_proveedor
        FROM gastos_compra g
        JOIN compras co ON co.id = g.compra_id
        LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
       WHERE g.fecha_emision BETWEEN p_desde AND p_hasta
    ) f), '[]'::jsonb);
END;
$function$;

-- ── SIRE: la factura del flete es un comprobante 01 más ────────────────────
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
    UNION ALL
    -- Flete con factura (el recibo por honorarios no va al registro de compras).
    SELECT
      g.fecha_emision, '01',
      COALESCE(NULLIF(SPLIT_PART(g.numero, '-', 1), ''), '-'),
      COALESCE(NULLIF(SPLIT_PART(g.numero, '-', 2), ''), g.numero, '-'),
      '6',
      COALESCE(pr.ruc, '-'),
      COALESCE(pr.razon_social, 'SIN PROVEEDOR'),
      g.subtotal, g.igv, g.total,
      g.estado,
      g.id
    FROM gastos_compra g
    LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
    CROSS JOIN rango r
    WHERE g.comprobante = 'factura' AND g.fecha_emision BETWEEN r.desde AND r.hasta
  )
  SELECT jsonb_build_object(
    'periodo', LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0'),
    'filas', COALESCE((SELECT jsonb_agg(row_to_json(f) ORDER BY f.fecha, f.serie, f.numero) FROM filas f), '[]'::jsonb),
    -- Las compras anuladas quedan como 'anulado' y las notas y fletes como 'anulada'.
    'total_base', COALESCE((SELECT SUM(base_imponible) FROM filas WHERE estado NOT IN ('anulado', 'anulada')), 0),
    'total_igv', COALESCE((SELECT SUM(igv) FROM filas WHERE estado NOT IN ('anulado', 'anulada')), 0),
    'total_total', COALESCE((SELECT SUM(total) FROM filas WHERE estado NOT IN ('anulado', 'anulada')), 0),
    'cantidad', (SELECT COUNT(*) FROM filas)
  );
$function$;
