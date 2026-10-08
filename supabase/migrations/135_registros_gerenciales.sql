-- Registros de ventas y de compras para gerencia, entre dos fechas.
--
-- Daniel, 07/10/2026: "un reporte como registro de ventas con fecha desde
-- hasta y sumado total de facturas, boletas y documento interno para mi
-- información y tomar decisiones, y de igual manera de registro de compras".
--
-- No reemplaza al SIRE ni al PLE (mensuales, con el formato de SUNAT, para el
-- contador): esto es para gerencia, por rango libre e incluye lo que no va a
-- SUNAT (documentos internos de venta y de compra). Una fila por documento; los
-- filtros y totales los arma la pantalla.

BEGIN;

CREATE OR REPLACE FUNCTION public.registro_ventas(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'El registro de ventas es solo para gerencia';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;
  IF p_hasta - p_desde > 400 THEN RAISE EXCEPTION 'El rango no puede pasar de un año'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(f ORDER BY f.fecha, f.tipo, f.serie, f.numero) FROM (
      SELECT c.id, c.tipo::text AS tipo, c.serie, c.numero, c.fecha_emision AS fecha, c.estado::text AS estado,
             COALESCE(cl.razon_social, c.cliente_externo_nombre, 'CLIENTE VARIOS') AS cliente,
             COALESCE(NULLIF(cl.ruc, ''), NULLIF(cl.dni, ''), c.cliente_externo_doc, '') AS doc,
             COALESCE(v.full_name, '') AS vendedor,
             COALESCE(p.tipo_pago, 'contado') AS condicion,
             COALESCE(c.subtotal, 0) AS base, COALESCE(c.igv, 0) AS igv, COALESCE(c.total, 0) AS total,
             COALESCE((SELECT SUM(a.monto_aplicado) FROM cobros_aplicaciones a WHERE a.comprobante_id = c.id), 0) AS cobrado,
             c.sunat_estado, c.motivo_anulacion
        FROM comprobantes c
        LEFT JOIN clientes cl ON cl.id = c.cliente_id
        LEFT JOIN pedidos p ON p.id = c.pedido_id
        LEFT JOIN profiles v ON v.id = p.vendedor_id
       WHERE c.fecha_emision BETWEEN p_desde AND p_hasta
    ) f), '[]'::jsonb);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registro_ventas(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.registro_compras(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
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
             (SELECT COUNT(*) FROM compras_items ci WHERE ci.compra_id = co.id) AS lineas
        FROM compras co
        LEFT JOIN proveedores pr ON pr.id = co.proveedor_id
       WHERE co.fecha BETWEEN p_desde AND p_hasta
    ) f), '[]'::jsonb);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.registro_compras(date, date) TO authenticated;

COMMIT;
