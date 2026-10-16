-- Cuotas y ventas por vendedor: una sola fuente para las tres pantallas.
--
-- Daniel, 15/10/2026: para DANIEL CAICHIHUA en octubre, Alcance de objetivos
-- decía S/ 49,744.07, Gestión de vendedores S/ 45,967.70 y el Dashboard de
-- cuotas S/ 45,611.70; y el Dashboard mostraba una cuota de S/ 48,892 cuando
-- la asignada es S/ 101,043.91.
--
--   * La venta correcta es la de Alcance: comprobantes no anulados (facturas,
--     boletas y documentos internos; las notas de crédito restan) por fecha de
--     emisión, del vendedor del pedido. Gestión dejaba afuera los comprobantes
--     de pedidos creados el mes anterior (3 por S/ 3,776.38) y el Dashboard
--     sumaba pedidos por fecha de pedido.
--   * El Dashboard prorrateaba la cuota mensual por los días del rango (15/31).
--     La cuota es la asignada al mes, completa.
--
-- resumen_ventas_cuotas() da venta, cuota y cobrado por vendedor con esa regla;
-- la usan el Dashboard y Gestión de vendedores. alcance_objetivos_rango usa la
-- cuota completa de cada mes que toca el rango. alcance_objetivos acepta
-- "todos los vendedores" (p_vendedor_id NULL) para el objetivo general.

-- ── 1. Venta, cuota y cobrado por vendedor ────────────────────────────────
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
    )
    SELECT jsonb_agg(jsonb_build_object(
             'vendedor_id', v.id,
             'nombre', COALESCE(v.full_name, v.email),
             'ventas', ROUND(COALESCE(ve.ventas, 0), 2),
             'cuota', ROUND(COALESCE(cu.cuota, 0), 2),
             'cobrado', ROUND(COALESCE(co.cobrado, 0), 2)
           ) ORDER BY v.full_name)
      FROM profiles v
      LEFT JOIN ventas ve ON ve.vendedor_id = v.id
      LEFT JOIN cuotas cu ON cu.vendedor_id = v.id
      LEFT JOIN cobros_r co ON co.vendedor_id = v.id
     WHERE v.role::text = 'vendedor' AND v.activo
  ), '[]'::jsonb);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.resumen_ventas_cuotas(date, date, uuid) TO authenticated;

-- ── 2. Alcance por rango: cuota completa del mes ──────────────────────────
CREATE OR REPLACE FUNCTION public.alcance_objetivos_rango(p_desde date, p_hasta date, p_vendedor_id uuid DEFAULT NULL::uuid, p_familia_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Cuota del rango: la cuota COMPLETA de cada mes que el rango toca (Daniel,
  -- 15/10: antes se prorrateaba por días y no se veía la cuota asignada).
  cuotas AS (
    SELECT
      cp.producto_id,
      SUM(cp.cuota_cantidad) AS cant_cuota,
      SUM(cp.cuota_valor)    AS valor_cuota
    FROM cuotas_vendedor_producto cp
    WHERE make_date(cp.anio, cp.mes, 1) <= p_hasta
      AND (make_date(cp.anio, cp.mes, 1) + INTERVAL '1 month - 1 day')::date >= p_desde
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
$function$;

-- ── 3. Alcance mensual: también "todos los vendedores" ────────────────────
CREATE OR REPLACE FUNCTION public.alcance_objetivos(p_anio integer, p_mes integer, p_vendedor_id uuid, p_solo_con_datos boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_vendedor TEXT;
  v_rol TEXT;
BEGIN
  -- El objetivo general (todos los vendedores) es información de gerencia.
  IF p_vendedor_id IS NULL THEN
    SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
    IF v_rol IS NULL OR v_rol NOT IN ('administrador','gerente','contador','caja','facturador','almacenero') THEN
      RAISE EXCEPTION 'Sin permiso para ver el alcance de todos los vendedores';
    END IF;
    v_vendedor := 'TODOS LOS VENDEDORES';
  ELSE
    SELECT COALESCE(full_name, email) INTO v_vendedor FROM profiles WHERE id = p_vendedor_id;
  END IF;

  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  ventas AS (
    SELECT ci.producto_id,
      SUM(ci.cantidad * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant_real,
      SUM(ci.subtotal * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor_real
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    CROSS JOIN rango r
    WHERE c.estado <> 'anulado' AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND (p_vendedor_id IS NULL OR pe.vendedor_id = p_vendedor_id) AND ci.producto_id IS NOT NULL
    GROUP BY ci.producto_id
  ),
  cuotas AS (
    SELECT producto_id, SUM(cuota_cantidad) AS cuota_cantidad, SUM(cuota_valor) AS cuota_valor
      FROM cuotas_vendedor_producto
     WHERE anio = p_anio AND mes = p_mes AND (p_vendedor_id IS NULL OR vendedor_id = p_vendedor_id)
     GROUP BY producto_id
  ),
  filas AS (
    SELECT
      COALESCE(f.codigo, 'ZZ') AS linea_codigo,
      COALESCE(f.nombre, 'SIN FAMILIA') AS linea_nombre,
      COALESCE(f.id::text, 'sin-familia') AS linea_key,
      pr.codigo,
      nombre_producto(pr.nombre, pr.descripcion) AS descripcion,
      COALESCE(v.cant_real, 0) AS cant_real,
      COALESCE(cp.cuota_cantidad, 0) AS cant_cuota,
      COALESCE(v.valor_real, 0) AS valor_real,
      COALESCE(cp.cuota_valor, 0) AS valor_cuota
    FROM productos pr
    LEFT JOIN familias f ON f.id = pr.familia_id
    LEFT JOIN cuotas cp ON cp.producto_id = pr.id
    LEFT JOIN ventas v ON v.producto_id = pr.id
    WHERE (pr.activo OR COALESCE(v.cant_real, 0) <> 0)
      AND (NOT p_solo_con_datos
        OR COALESCE(cp.cuota_cantidad, 0) <> 0 OR COALESCE(cp.cuota_valor, 0) <> 0
        OR COALESCE(v.cant_real, 0) <> 0 OR COALESCE(v.valor_real, 0) <> 0)
  ),
  lineas AS (
    SELECT linea_key, linea_codigo, linea_nombre,
      SUM(cant_real) AS tot_cant_real, SUM(cant_cuota) AS tot_cant_cuota,
      SUM(valor_real) AS tot_valor_real, SUM(valor_cuota) AS tot_valor_cuota,
      jsonb_agg(jsonb_build_object(
        'codigo', codigo, 'descripcion', descripcion,
        'cant_real', ROUND(cant_real, 2), 'cant_cuota', ROUND(cant_cuota, 2),
        'alc_cant', CASE WHEN cant_cuota > 0 THEN ROUND(cant_real / cant_cuota * 100, 2) ELSE NULL END,
        'valor_real', ROUND(valor_real, 2), 'valor_cuota', ROUND(valor_cuota, 2),
        'alc_valor', CASE WHEN valor_cuota > 0 THEN ROUND(valor_real / valor_cuota * 100, 2) ELSE NULL END
      ) ORDER BY descripcion) AS productos
    FROM filas GROUP BY linea_key, linea_codigo, linea_nombre
  )
  SELECT jsonb_build_object(
    'anio', p_anio, 'mes', p_mes,
    'periodo', p_anio::text || LPAD(p_mes::text, 2, '0'),
    'vendedor_id', p_vendedor_id, 'vendedor_nombre', COALESCE(v_vendedor, '—'),
    'lineas', COALESCE(jsonb_agg(jsonb_build_object(
      'codigo', linea_codigo, 'nombre', linea_nombre, 'productos', productos,
      'tot_cant_real', ROUND(tot_cant_real, 2), 'tot_cant_cuota', ROUND(tot_cant_cuota, 2),
      'tot_valor_real', ROUND(tot_valor_real, 2), 'tot_valor_cuota', ROUND(tot_valor_cuota, 2),
      'alc_valor', CASE WHEN tot_valor_cuota > 0
        THEN ROUND(tot_valor_real / tot_valor_cuota * 100, 2) ELSE NULL END
    ) ORDER BY linea_codigo), '[]'::jsonb),
    'total_cant_real', COALESCE(ROUND(SUM(tot_cant_real), 2), 0),
    'total_cant_cuota', COALESCE(ROUND(SUM(tot_cant_cuota), 2), 0),
    'total_valor_real', COALESCE(ROUND(SUM(tot_valor_real), 2), 0),
    'total_valor_cuota', COALESCE(ROUND(SUM(tot_valor_cuota), 2), 0),
    'alc_total', CASE WHEN COALESCE(SUM(tot_valor_cuota), 0) > 0
      THEN ROUND(SUM(tot_valor_real) / SUM(tot_valor_cuota) * 100, 2) ELSE NULL END
  ) INTO v_result FROM lineas;

  RETURN v_result;
END;
$function$;
