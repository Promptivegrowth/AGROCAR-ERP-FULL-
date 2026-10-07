-- Factura mensual que regulariza documentos internos (agua y hielo de la
-- Procesadora).
--
-- Daniel, 05/10/2026. Así trabajaba en su sistema anterior y así lo quiere:
--   1. La Procesadora de Alimentos AGROCAR S.R.L. (RUC 20602230792, otra
--      empresa) le entrega agua y hielo con un reporte de producción, sin
--      factura: se ingresa como documento interno (migración 127) y el stock
--      entra.
--   2. AGROCAR lo vende con factura, boleta o documento interno.
--   3. Al cerrar el mes cuenta cuánto vendió con factura y boleta, y la
--      Procesadora le factura solo eso.
--
-- La factura del paso 3 es una compra con comprobante —va al Registro de
-- Compras y da crédito de IGV— pero la mercadería ya entró con los documentos
-- internos: aplicarla como cualquier compra la sumaría dos veces al stock. Por
-- eso se marca "regulariza internos" y al aplicarla (o revertirla) no se toca el
-- almacén.
--
-- Y el reporte para el paso 3: liquidacion_internos(proveedor, desde, hasta).

BEGIN;

ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS regulariza_internos BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.compras.regulariza_internos IS
  'Factura que regulariza mercadería ya ingresada con documentos internos: va al Registro de Compras pero no mueve stock.';
ALTER TABLE public.compras DROP CONSTRAINT IF EXISTS compras_interno_o_regulariza;
ALTER TABLE public.compras ADD CONSTRAINT compras_interno_o_regulariza
  CHECK (NOT (documento_interno AND regulariza_internos));

-- Las funciones de siempre quedan intactas con otro nombre; las nuevas deciden.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_aplicar_compra_con_stock') THEN
    ALTER FUNCTION public.aplicar_compra(uuid) RENAME TO _aplicar_compra_con_stock;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_revertir_compra_con_stock') THEN
    ALTER FUNCTION public.revertir_compra(uuid) RENAME TO _revertir_compra_con_stock;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._aplicar_compra_con_stock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._revertir_compra_con_stock(uuid) FROM PUBLIC, anon, authenticated;

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
END;
$function$;

CREATE OR REPLACE FUNCTION public.revertir_compra(p_compra_id uuid)
 RETURNS void
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
    IF v_compra.estado <> 'aplicada' THEN
      RAISE EXCEPTION 'Solo se puede revertir una compra aplicada (estado actual: %)', v_compra.estado;
    END IF;
    UPDATE compras SET estado = 'registrada' WHERE id = p_compra_id;
    RETURN;
  END IF;
  PERFORM _revertir_compra_con_stock(p_compra_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.aplicar_compra(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_compra(uuid) TO authenticated;

-- Cierre de mes: por cada producto que el proveedor entregó con documento
-- interno, cuánto entró, cuánto se vendió con factura, con boleta y con
-- documento interno, y cuánto falta facturar (factura + boleta − lo ya
-- regularizado en el período).
CREATE OR REPLACE FUNCTION public.liquidacion_internos(p_proveedor_id uuid, p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'almacenero', 'contador', 'facturador') THEN
    RAISE EXCEPTION 'Sin permiso para ver la liquidación';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;

  RETURN (
    WITH prods AS (
      -- Los productos que entrega este proveedor (con documento interno o, como
      -- el ingreso inicial del 01/10, con una compra común).
      SELECT DISTINCT ci.producto_id
        FROM compras_items ci JOIN compras co ON co.id = ci.compra_id
       WHERE co.proveedor_id = p_proveedor_id AND co.estado <> 'anulada' AND NOT co.regulariza_internos
    ),
    ingresos AS (
      SELECT ci.producto_id, SUM(COALESCE(ci.cantidad_recibida, ci.cantidad)) AS cantidad,
             SUM(COALESCE(ci.cantidad_recibida, ci.cantidad) * ci.precio_unitario) AS importe
        FROM compras_items ci JOIN compras co ON co.id = ci.compra_id
       WHERE co.proveedor_id = p_proveedor_id AND co.documento_interno AND co.estado <> 'anulada'
         AND co.fecha BETWEEN p_desde AND p_hasta
       GROUP BY ci.producto_id
    ),
    precio AS (
      -- Precio pactado, CON IGV (así lo registra Daniel): el del último
      -- documento interno; si no hay, el de la última compra.
      SELECT DISTINCT ON (ci.producto_id) ci.producto_id, ci.precio_unitario
        FROM compras_items ci JOIN compras co ON co.id = ci.compra_id
       WHERE co.proveedor_id = p_proveedor_id AND co.estado <> 'anulada' AND NOT co.regulariza_internos
         AND co.fecha <= p_hasta
       ORDER BY ci.producto_id, co.documento_interno DESC, co.fecha DESC, co.created_at DESC
    ),
    ventas AS (
      SELECT i.producto_id,
             SUM(i.cantidad) FILTER (WHERE c.tipo::text = 'factura') AS factura,
             SUM(i.cantidad) FILTER (WHERE c.tipo::text = 'boleta') AS boleta,
             SUM(i.cantidad) FILTER (WHERE c.tipo::text = 'nota_pedido_interna') AS interno,
             SUM(i.cantidad) FILTER (WHERE c.tipo::text = 'nota_credito') AS notas_credito
        FROM comprobantes_items i JOIN comprobantes c ON c.id = i.comprobante_id
       WHERE i.producto_id IN (SELECT producto_id FROM prods)
         AND c.estado <> 'anulado' AND c.fecha_emision BETWEEN p_desde AND p_hasta
       GROUP BY i.producto_id
    ),
    regularizado AS (
      SELECT ci.producto_id, SUM(ci.cantidad) AS cantidad
        FROM compras_items ci JOIN compras co ON co.id = ci.compra_id
       WHERE co.proveedor_id = p_proveedor_id AND co.regulariza_internos AND co.estado <> 'anulada'
         AND co.fecha BETWEEN p_desde AND p_hasta
       GROUP BY ci.producto_id
    ),
    filas AS (
      SELECT p.id AS producto_id, p.codigo, COALESCE(NULLIF(TRIM(p.descripcion), ''), p.nombre) AS producto,
             um.simbolo AS unidad,
             COALESCE(ing.cantidad, 0) AS ingresado, COALESCE(ing.importe, 0) AS importe_ingresado,
             COALESCE(v.factura, 0) AS vendido_factura, COALESCE(v.boleta, 0) AS vendido_boleta,
             COALESCE(v.interno, 0) AS vendido_interno, COALESCE(v.notas_credito, 0) AS notas_credito,
             COALESCE(v.factura, 0) + COALESCE(v.boleta, 0) - COALESCE(v.notas_credito, 0) AS a_facturar,
             COALESCE(r.cantidad, 0) AS ya_facturado,
             COALESCE(v.factura, 0) + COALESCE(v.boleta, 0) - COALESCE(v.notas_credito, 0) - COALESCE(r.cantidad, 0) AS pendiente,
             COALESCE(pr.precio_unitario, 0) AS precio,
             ROUND(GREATEST(COALESCE(v.factura, 0) + COALESCE(v.boleta, 0) - COALESCE(v.notas_credito, 0) - COALESCE(r.cantidad, 0), 0)
                   * COALESCE(pr.precio_unitario, 0), 2) AS importe
        FROM prods x JOIN productos p ON p.id = x.producto_id
        LEFT JOIN unidades_medida um ON um.id = p.unidad_medida_id
        LEFT JOIN ingresos ing ON ing.producto_id = p.id
        LEFT JOIN ventas v ON v.producto_id = p.id
        LEFT JOIN regularizado r ON r.producto_id = p.id
        LEFT JOIN precio pr ON pr.producto_id = p.id
    )
    SELECT jsonb_build_object(
      'proveedor', (SELECT jsonb_build_object('id', id, 'razon_social', razon_social, 'ruc', ruc) FROM proveedores WHERE id = p_proveedor_id),
      'desde', p_desde, 'hasta', p_hasta,
      'filas', COALESCE((SELECT jsonb_agg(f ORDER BY f.producto) FROM filas f), '[]'::jsonb),
      -- Importe pendiente de facturar: el precio incluye IGV.
      'total', (SELECT ROUND(COALESCE(SUM(importe), 0), 2) FROM filas),
      'base', (SELECT ROUND(COALESCE(SUM(importe), 0) / 1.18, 2) FROM filas),
      'igv', (SELECT ROUND(COALESCE(SUM(importe), 0) - COALESCE(SUM(importe), 0) / 1.18, 2) FROM filas),
      'facturas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', co.id, 'numero', co.numero_factura_proveedor,
           'fecha', co.fecha, 'total', co.total) ORDER BY co.fecha)
         FROM compras co WHERE co.proveedor_id = p_proveedor_id AND co.regulariza_internos AND co.estado <> 'anulada'
          AND co.fecha BETWEEN p_desde AND p_hasta), '[]'::jsonb)
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.liquidacion_internos(uuid, date, date) TO authenticated;

-- Registrar la factura del proveedor que regulariza el mes: queda aplicada de
-- una vez, sin mover stock, y descuenta lo pendiente de la liquidación.
-- Precios con IGV, como los documentos internos.
CREATE OR REPLACE FUNCTION public.registrar_factura_regularizacion(
  p_proveedor_id uuid, p_numero text, p_fecha date, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_rol TEXT;
  v_id UUID;
  v_total NUMERIC := 0;
  v_it JSONB;
  v_n INT := 0;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = v_user AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'almacenero', 'contador') THEN
    RAISE EXCEPTION 'Sin permiso para registrar compras';
  END IF;
  IF COALESCE(TRIM(p_numero), '') = '' THEN RAISE EXCEPTION 'Indica el número de la factura del proveedor'; END IF;
  IF p_fecha IS NULL THEN RAISE EXCEPTION 'Indica la fecha de la factura'; END IF;
  IF EXISTS (SELECT 1 FROM compras WHERE proveedor_id = p_proveedor_id AND estado <> 'anulada'
              AND UPPER(REPLACE(numero_factura_proveedor, ' ', '')) = UPPER(REPLACE(TRIM(p_numero), ' ', ''))) THEN
    RAISE EXCEPTION 'La factura % de este proveedor ya está registrada', TRIM(p_numero);
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La factura no tiene productos'; END IF;

  INSERT INTO compras (proveedor_id, numero_factura_proveedor, fecha, subtotal, igv, total, incluir_igv,
                       moneda, estado, regulariza_internos, notas, created_by)
  VALUES (p_proveedor_id, TRIM(p_numero), p_fecha, 0, 0, 0, TRUE, 'PEN', 'aplicada', TRUE,
          'Factura que regulariza documentos internos: no mueve stock', v_user)
  RETURNING id INTO v_id;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF COALESCE((v_it->>'cantidad')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO compras_items (compra_id, producto_id, cantidad, cantidad_recibida, precio_unitario, subtotal)
    VALUES (v_id, (v_it->>'producto_id')::uuid, (v_it->>'cantidad')::numeric, (v_it->>'cantidad')::numeric,
            (v_it->>'precio_unitario')::numeric,
            ROUND((v_it->>'cantidad')::numeric * (v_it->>'precio_unitario')::numeric, 2));
    v_total := v_total + ROUND((v_it->>'cantidad')::numeric * (v_it->>'precio_unitario')::numeric, 2);
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'La factura no tiene cantidades'; END IF;

  UPDATE compras SET total = v_total, subtotal = ROUND(v_total / 1.18, 2), igv = v_total - ROUND(v_total / 1.18, 2)
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', TRIM(p_numero), 'total', v_total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.registrar_factura_regularizacion(uuid, text, date, jsonb) TO authenticated;

-- Para el selector: proveedores con compras, primero los que entregan con
-- documento interno.
DROP FUNCTION IF EXISTS public.proveedores_con_internos();
CREATE OR REPLACE FUNCTION public.proveedores_con_internos()
 RETURNS TABLE(id uuid, razon_social text, ruc text, con_internos boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pr.id, pr.razon_social::text, pr.ruc::text, bool_or(co.documento_interno) AS con_internos
    FROM proveedores pr JOIN compras co ON co.proveedor_id = pr.id
   WHERE co.estado <> 'anulada'
   GROUP BY pr.id, pr.razon_social, pr.ruc
   ORDER BY bool_or(co.documento_interno) DESC, pr.razon_social
$function$;

GRANT EXECUTE ON FUNCTION public.proveedores_con_internos() TO authenticated;

COMMIT;
