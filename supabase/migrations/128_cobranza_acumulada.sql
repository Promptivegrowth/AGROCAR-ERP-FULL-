-- Cobranza acumulada entre dos fechas, por medio de pago.
--
-- Daniel, 05/10/2026: "habilitar en caja también fecha desde hasta para saber
-- la cobranza acumulada en Yape, Plin, transferencia y efectivo". Caja solo
-- mostraba el día.
--
-- Se suma en la base y no en la pantalla: con ~70 cobros por día, un mes pasa
-- los mil y Supabase corta en mil filas sin avisar; la suma saldría corta.
-- Devuelve el total del rango, el detalle por cobrador y por día.

CREATE OR REPLACE FUNCTION public.cobranza_acumulada(p_desde date, p_hasta date)
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
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'caja', 'contador', 'facturador') THEN
    RAISE EXCEPTION 'Sin permiso para ver la cobranza acumulada';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango de fechas inválido';
  END IF;
  IF p_hasta - p_desde > 400 THEN
    RAISE EXCEPTION 'El rango no puede pasar de un año';
  END IF;

  RETURN (
    WITH c AS (
      SELECT co.fecha, co.cobrador_id,
             COALESCE(co.efectivo, 0) AS efectivo, COALESCE(co.yape, 0) AS yape,
             COALESCE(co.plin, 0) AS plin, COALESCE(co.transferencia, 0) AS transferencia,
             COALESCE(co.total, 0) AS total
        FROM cobros co
       WHERE co.fecha BETWEEN p_desde AND p_hasta
    )
    SELECT jsonb_build_object(
      'desde', p_desde, 'hasta', p_hasta,
      'total', (SELECT jsonb_build_object(
          'cobros', COUNT(*), 'efectivo', COALESCE(SUM(efectivo), 0), 'yape', COALESCE(SUM(yape), 0),
          'plin', COALESCE(SUM(plin), 0), 'transferencia', COALESCE(SUM(transferencia), 0),
          'total', COALESCE(SUM(total), 0)) FROM c),
      'por_cobrador', COALESCE((SELECT jsonb_agg(x ORDER BY x.total DESC) FROM (
          SELECT c.cobrador_id, COALESCE(p.full_name, 'Sin asignar') AS cobrador, p.role::text AS rol,
                 COUNT(*) AS cobros, SUM(c.efectivo) AS efectivo, SUM(c.yape) AS yape, SUM(c.plin) AS plin,
                 SUM(c.transferencia) AS transferencia, SUM(c.total) AS total
            FROM c LEFT JOIN profiles p ON p.id = c.cobrador_id
           GROUP BY c.cobrador_id, p.full_name, p.role) x), '[]'::jsonb),
      'por_dia', COALESCE((SELECT jsonb_agg(x ORDER BY x.fecha) FROM (
          SELECT c.fecha, COUNT(*) AS cobros, SUM(c.efectivo) AS efectivo, SUM(c.yape) AS yape,
                 SUM(c.plin) AS plin, SUM(c.transferencia) AS transferencia, SUM(c.total) AS total
            FROM c GROUP BY c.fecha) x), '[]'::jsonb)
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cobranza_acumulada(date, date) TO authenticated;

-- El rol "caja" no podía leer cobros: la pantalla de Caja le salía vacía
-- (0 cobros del día) aunque es justamente el rol para esa pantalla. Hasta hoy
-- no se notó porque quienes atienden la caja tienen rol administrador.
DROP POLICY IF EXISTS cobros_select ON public.cobros;
CREATE POLICY cobros_select ON public.cobros FOR SELECT TO public
  USING (has_role(VARIADIC ARRAY['gerente'::text, 'administrador'::text, 'facturador'::text, 'contador'::text,
                                 'vendedor'::text, 'repartidor'::text, 'caja'::text]));
