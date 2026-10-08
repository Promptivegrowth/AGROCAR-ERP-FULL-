-- Liquidación de un día: cada cobro con su cliente, cobrador y comprobantes.
--
-- Daniel, 07/10/2026: en Caja → Acumulado por fechas, tocar un día y ver quién
-- cobró y a qué cliente, para verificar los pagos. Leído con los permisos de
-- cada tabla, el rol "caja" no ve clientes, perfiles ni comprobantes, y el
-- detalle salía con "Sin asignar" y todo "a cuenta". Esta función entrega el
-- detalle completo a quienes manejan caja.

CREATE OR REPLACE FUNCTION public.liquidacion_dia(p_fecha date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'caja', 'contador') THEN
    RAISE EXCEPTION 'Sin permiso para ver la liquidación';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.created_at, x.id) FROM (
      SELECT co.id, co.numero, co.created_at, co.cobrador_id,
             COALESCE(cl.razon_social, co.cliente_externo_nombre, 'CLIENTE VARIOS') AS cliente,
             COALESCE(pf.full_name, 'Sin asignar') AS cobrador,
             COALESCE(co.efectivo, 0) AS efectivo, COALESCE(co.yape, 0) AS yape, COALESCE(co.plin, 0) AS plin,
             COALESCE(co.transferencia, 0) AS transferencia, COALESCE(co.total, 0) AS total,
             co.nro_operacion, co.notas,
             COALESCE((SELECT string_agg(
                         CASE WHEN a.es_a_cuenta OR c.id IS NULL THEN 'a cuenta ' || to_char(a.monto_aplicado, 'FM999990.00')
                              ELSE c.serie || '-' || (c.numero::bigint)::text END, ', ' ORDER BY a.created_at)
                         FROM cobros_aplicaciones a LEFT JOIN comprobantes c ON c.id = a.comprobante_id
                        WHERE a.cobro_id = co.id), '—') AS aplicado
        FROM cobros co
        LEFT JOIN clientes cl ON cl.id = co.cliente_id
        LEFT JOIN profiles pf ON pf.id = co.cobrador_id
       WHERE co.fecha = p_fecha
    ) x), '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.liquidacion_dia(date) TO authenticated;
