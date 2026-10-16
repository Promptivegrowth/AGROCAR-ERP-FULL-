-- resumen_ventas_cuotas: también quien vendió sin ser vendedor, y "sin vendedor".
--
-- Verificación del 15/10/2026: con "Todos los vendedores", el Dashboard sumaba
-- S/ 269,154.93 y su tabla (y Alcance "todos") S/ 299,993.89. La diferencia eran
-- ventas reales hechas por repartidores en ruta (VICTOR CHUCUYA S/ 16,219.18,
-- WALTER QUISPE S/ 12,447.38) y 5 pedidos sin vendedor (S/ 2,172.40): la 146
-- solo listaba perfiles con rol vendedor. Ahora salen todos los que tienen venta
-- o cuota en el rango, más una fila "SIN VENDEDOR"; los vendedores activos
-- aparecen siempre, aunque estén en cero. Gestión de vendedores sigue mostrando
-- solo a los vendedores (toma sus filas por id).
CREATE OR REPLACE FUNCTION public.resumen_ventas_cuotas(p_desde date, p_hasta date, p_familia_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador','gerente','contador','caja','facturador','almacenero') THEN
    RAISE EXCEPTION 'Sin permiso para ver ventas y cuotas por vendedor';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;

  RETURN COALESCE((
    WITH ventas AS (
      SELECT pe.vendedor_id,
             SUM(ci.subtotal * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS ventas
        FROM comprobantes c
        JOIN pedidos pe ON pe.id = c.pedido_id
        JOIN comprobantes_items ci ON ci.comprobante_id = c.id
        LEFT JOIN productos pr ON pr.id = ci.producto_id
       WHERE c.estado <> 'anulado'
         AND c.fecha_emision BETWEEN p_desde AND p_hasta
         AND (p_familia_id IS NULL OR pr.familia_id = p_familia_id)
       GROUP BY pe.vendedor_id
    ),
    -- La cuota es mensual y se toma COMPLETA en cada mes que el rango toca.
    cuotas AS (
      SELECT cf.vendedor_id, SUM(cf.cuota_monto) AS cuota
        FROM cuotas_vendedor_familia cf
       WHERE make_date(cf.anio, cf.mes, 1) <= p_hasta
         AND (make_date(cf.anio, cf.mes, 1) + INTERVAL '1 month - 1 day')::date >= p_desde
         AND (p_familia_id IS NULL OR cf.familia_id = p_familia_id)
       GROUP BY cf.vendedor_id
    ),
    cobros_r AS (
      SELECT cobrador_id AS vendedor_id, SUM(total) AS cobrado
        FROM cobros WHERE fecha BETWEEN p_desde AND p_hasta
       GROUP BY cobrador_id
    ),
    -- Quiénes salen: los vendedores activos siempre; los demás si vendieron o
    -- tienen cuota; y la venta sin vendedor como su propia fila.
    personas AS (
      SELECT id FROM profiles WHERE role::text = 'vendedor' AND activo
      UNION SELECT vendedor_id FROM ventas WHERE vendedor_id IS NOT NULL
      UNION SELECT vendedor_id FROM cuotas WHERE vendedor_id IS NOT NULL
    ),
    filas AS (
      SELECT p.id AS vendedor_id, COALESCE(p.full_name, p.email) AS nombre, p.role::text AS rol,
             COALESCE(ve.ventas, 0) AS ventas, COALESCE(cu.cuota, 0) AS cuota, COALESCE(co.cobrado, 0) AS cobrado
        FROM personas x
        JOIN profiles p ON p.id = x.id
        LEFT JOIN ventas ve ON ve.vendedor_id = p.id
        LEFT JOIN cuotas cu ON cu.vendedor_id = p.id
        LEFT JOIN cobros_r co ON co.vendedor_id = p.id
      UNION ALL
      SELECT NULL, 'SIN VENDEDOR', NULL, ve.ventas, 0, 0
        FROM ventas ve WHERE ve.vendedor_id IS NULL AND ve.ventas <> 0
    )
    SELECT jsonb_agg(jsonb_build_object(
             'vendedor_id', vendedor_id,
             'nombre', nombre,
             'rol', rol,
             'ventas', ROUND(ventas, 2),
             'cuota', ROUND(cuota, 2),
             'cobrado', ROUND(cobrado, 2)
           ) ORDER BY (rol IS DISTINCT FROM 'vendedor'), nombre)
      FROM filas
  ), '[]'::jsonb);
END;
$function$;
