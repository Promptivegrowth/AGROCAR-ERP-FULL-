-- ─────────────────────────────────────────────────────────────────────────────
-- 090: "Descripción detallada de las cuotas por producto" del dashboard sale
--      ahora del MISMO origen que el reporte Alcance de Objetivos
--
-- Christopher (obs. 5, 6 y 7):
--   5. Las columnas CANT. CUOTA, MARGEN CANT., VALOR CUOTA y MARGEN VALOR
--      salían vacías: la tabla debe estar relacionada con las cuotas ya
--      asignadas a cada vendedor.
--   6. La información debe provenir de Gestión de Vendedores → Alcance de
--      objetivos.
--   7. Mismo modelo que ese reporte: productos clasificados por familia
--      (LÍNEA 01 - CERDEÑA, LÍNEA 03 - VILSER…), con total por línea y los
--      mismos montos.
--
-- `alcance_objetivos` sirve un mes y UN vendedor. El dashboard trabaja con un
-- rango de fechas libre y puede pedir todos los vendedores a la vez, así que
-- esta es la misma consulta abierta a esos dos ejes. La venta real se lee de
-- comprobantes exactamente igual que el reporte —notas de crédito restando—
-- para que las cifras coincidan y no haya dos verdades.
--
-- La cuota es MENSUAL y el rango es libre: cada mes aporta la parte
-- proporcional a los días que el rango cubre de él. Un mes completo da factor
-- 1, o sea números idénticos al reporte; un rango a caballo entre dos meses ya
-- no infla la meta sumando los dos enteros.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION alcance_objetivos_rango(
  p_desde DATE,
  p_hasta DATE,
  p_vendedor_id UUID DEFAULT NULL,   -- NULL = todos los vendedores
  p_familia_id  UUID DEFAULT NULL    -- NULL = todas las líneas
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_vendedor TEXT;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;
  -- Los mismos roles que entran al dashboard
  IF v_rol NOT IN ('administrador','gerente','contador','caja','facturador','almacenero') THEN
    RAISE EXCEPTION 'Sin permiso para ver el alcance de objetivos';
  END IF;

  IF p_vendedor_id IS NOT NULL THEN
    SELECT COALESCE(full_name, email) INTO v_vendedor FROM profiles WHERE id = p_vendedor_id;
  END IF;

  WITH ventas AS (
    SELECT
      ci.producto_id,
      SUM(ci.cantidad * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant_real,
      SUM(ci.subtotal * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor_real
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN p_desde AND p_hasta
      AND ci.producto_id IS NOT NULL
      AND (p_vendedor_id IS NULL OR pe.vendedor_id = p_vendedor_id)
    GROUP BY ci.producto_id
  ),
  -- Cuota del rango: cada fila mes/año pesa según los días que el rango cubre
  cuotas AS (
    SELECT
      cp.producto_id,
      SUM(cp.cuota_cantidad * f.factor) AS cant_cuota,
      SUM(cp.cuota_valor    * f.factor) AS valor_cuota
    FROM cuotas_vendedor_producto cp
    CROSS JOIN LATERAL (
      SELECT
        make_date(cp.anio, cp.mes, 1) AS mes_ini,
        (make_date(cp.anio, cp.mes, 1) + INTERVAL '1 month - 1 day')::date AS mes_fin
    ) m
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN LEAST(p_hasta, m.mes_fin) < GREATEST(p_desde, m.mes_ini) THEN 0
        ELSE (LEAST(p_hasta, m.mes_fin) - GREATEST(p_desde, m.mes_ini) + 1)::NUMERIC
             / EXTRACT(DAY FROM m.mes_fin)::NUMERIC
      END AS factor
    ) f
    WHERE f.factor > 0
      AND (p_vendedor_id IS NULL OR cp.vendedor_id = p_vendedor_id)
    GROUP BY cp.producto_id
  ),
  filas AS (
    SELECT
      COALESCE(f.codigo, 'ZZ')          AS linea_codigo,
      COALESCE(f.nombre, 'SIN FAMILIA') AS linea_nombre,
      COALESCE(f.id::text, 'sin-familia') AS linea_key,
      pr.codigo,
      nombre_producto(pr.nombre, pr.descripcion) AS descripcion,
      COALESCE(v.cant_real, 0)    AS cant_real,
      COALESCE(q.cant_cuota, 0)   AS cant_cuota,
      COALESCE(v.valor_real, 0)   AS valor_real,
      COALESCE(q.valor_cuota, 0)  AS valor_cuota
    FROM productos pr
    LEFT JOIN familias f ON f.id = pr.familia_id
    LEFT JOIN cuotas q ON q.producto_id = pr.id
    LEFT JOIN ventas v ON v.producto_id = pr.id
    WHERE (pr.activo OR COALESCE(v.cant_real, 0) <> 0)
      AND (p_familia_id IS NULL OR pr.familia_id = p_familia_id)
      -- Solo lo que tiene algo que mostrar: cuota cargada o venta del rango
      AND (COALESCE(q.cant_cuota, 0) <> 0 OR COALESCE(q.valor_cuota, 0) <> 0
        OR COALESCE(v.cant_real, 0) <> 0 OR COALESCE(v.valor_real, 0) <> 0)
  ),
  lineas AS (
    SELECT
      linea_key, linea_codigo, linea_nombre,
      SUM(cant_real)   AS tot_cant_real,
      SUM(cant_cuota)  AS tot_cant_cuota,
      SUM(valor_real)  AS tot_valor_real,
      SUM(valor_cuota) AS tot_valor_cuota,
      jsonb_agg(jsonb_build_object(
        'codigo', codigo,
        'descripcion', descripcion,
        'cant_real',  ROUND(cant_real, 2),
        'cant_cuota', ROUND(cant_cuota, 2),
        'alc_cant',   CASE WHEN cant_cuota > 0
          THEN ROUND(cant_real / cant_cuota * 100, 2) ELSE NULL END,
        'valor_real',  ROUND(valor_real, 2),
        'valor_cuota', ROUND(valor_cuota, 2),
        'alc_valor',   CASE WHEN valor_cuota > 0
          THEN ROUND(valor_real / valor_cuota * 100, 2) ELSE NULL END
      ) ORDER BY descripcion) AS productos
    FROM filas
    GROUP BY linea_key, linea_codigo, linea_nombre
  )
  SELECT jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'vendedor_id', p_vendedor_id,
    'vendedor_nombre', COALESCE(v_vendedor, 'TODOS LOS VENDEDORES'),
    'lineas', COALESCE(jsonb_agg(jsonb_build_object(
      'codigo', linea_codigo,
      'nombre', linea_nombre,
      'productos', productos,
      'tot_cant_real',   ROUND(tot_cant_real, 2),
      'tot_cant_cuota',  ROUND(tot_cant_cuota, 2),
      'tot_valor_real',  ROUND(tot_valor_real, 2),
      'tot_valor_cuota', ROUND(tot_valor_cuota, 2),
      'alc_cant', CASE WHEN tot_cant_cuota > 0
        THEN ROUND(tot_cant_real / tot_cant_cuota * 100, 2) ELSE NULL END,
      'alc_valor', CASE WHEN tot_valor_cuota > 0
        THEN ROUND(tot_valor_real / tot_valor_cuota * 100, 2) ELSE NULL END
    ) ORDER BY linea_codigo), '[]'::jsonb),
    'total_cant_real',   COALESCE(ROUND(SUM(tot_cant_real), 2), 0),
    'total_cant_cuota',  COALESCE(ROUND(SUM(tot_cant_cuota), 2), 0),
    'total_valor_real',  COALESCE(ROUND(SUM(tot_valor_real), 2), 0),
    'total_valor_cuota', COALESCE(ROUND(SUM(tot_valor_cuota), 2), 0),
    'alc_total', CASE WHEN COALESCE(SUM(tot_valor_cuota), 0) > 0
      THEN ROUND(SUM(tot_valor_real) / SUM(tot_valor_cuota) * 100, 2) ELSE NULL END
  ) INTO v_result
  FROM lineas;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION alcance_objetivos_rango IS
  'Alcance de objetivos por rango de fechas y opcionalmente por vendedor y familia. Mismo cálculo que alcance_objetivos: alimenta la tabla de cuotas por producto del dashboard.';

GRANT EXECUTE ON FUNCTION alcance_objetivos_rango TO authenticated;
