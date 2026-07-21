-- ─────────────────────────────────────────────────────────────────────────────
-- 079: PWA vendedor — mis cuotas del mes + total del equipo
--
-- Pedido de Daniel:
-- "Sigue pendiente las cuotas del mes por familia para el vendedor e
--  incluir el total de cuotas del mes de todos los vendedores.
--  En el aplicativo no pueden visualizar sus estados de cuenta por cobrar."
--
-- RPC pwa_mis_cuotas: devuelve para el vendedor AUTENTICADO sus cuotas por
-- familia con el vendido real y % de cumplimiento, más el total del equipo
-- (cuota y vendido de TODOS los vendedores del mes).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pwa_mis_cuotas(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  ventas AS (
    SELECT pe.vendedor_id, pr.familia_id, COALESCE(SUM(ci.subtotal), 0) AS vendido
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    JOIN productos pr ON pr.id = ci.producto_id
    CROSS JOIN rango r
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND pe.vendedor_id IS NOT NULL AND pr.familia_id IS NOT NULL
    GROUP BY pe.vendedor_id, pr.familia_id
  ),
  mis_filas AS (
    SELECT
      f.nombre AS familia,
      COALESCE(cu.cuota_monto, 0) AS cuota,
      COALESCE(v.vendido, 0) AS vendido
    FROM familias f
    LEFT JOIN cuotas_vendedor_familia cu
      ON cu.familia_id = f.id AND cu.vendedor_id = v_uid
      AND cu.anio = p_anio AND cu.mes = p_mes
    LEFT JOIN ventas v ON v.familia_id = f.id AND v.vendedor_id = v_uid
    WHERE COALESCE(cu.cuota_monto, 0) > 0 OR COALESCE(v.vendido, 0) > 0
  ),
  equipo AS (
    SELECT
      COALESCE((SELECT SUM(cuota_monto) FROM cuotas_vendedor_familia
                WHERE anio = p_anio AND mes = p_mes), 0) AS cuota_total,
      COALESCE((SELECT SUM(vendido) FROM ventas), 0) AS vendido_total
  )
  SELECT jsonb_build_object(
    'anio', p_anio, 'mes', p_mes,
    'familias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'familia', familia, 'cuota', cuota, 'vendido', vendido,
        'pct', CASE WHEN cuota > 0 THEN ROUND(vendido / cuota * 100, 1) ELSE NULL END
      ) ORDER BY familia)
      FROM mis_filas
    ), '[]'::jsonb),
    'mi_cuota_total', COALESCE((SELECT SUM(cuota) FROM mis_filas), 0),
    'mi_vendido_total', COALESCE((SELECT SUM(vendido) FROM mis_filas), 0),
    'equipo_cuota_total', (SELECT cuota_total FROM equipo),
    'equipo_vendido_total', (SELECT vendido_total FROM equipo)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION pwa_mis_cuotas TO authenticated;
