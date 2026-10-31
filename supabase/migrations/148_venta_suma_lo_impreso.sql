-- La venta suma lo impreso, no las líneas redondeadas.
--
-- Daniel, 29/10/2026: Gestión de vendedores y el Dashboard decían S/ 572,421.89
-- y Reportes y el reporte del equipo S/ 572,421.92. Las funciones de ventas
-- sumaban comprobantes_items.subtotal, y en productos por peso las líneas
-- redondean un céntimo distinto del total impreso (4 comprobantes en octubre:
-- B002-940, F002-146, F002-297 y B002-615; lo declarado a SUNAT ya va ajustado
-- al total, ver ajusteDeCentimos en ubl.ts).
--
-- Cada línea pasa a pesar su parte del total impreso:
--   monto = subtotal × total del comprobante / suma de sus líneas
-- Sumando todas las líneas de un comprobante da exactamente su total, y por
-- familia o producto queda repartido en proporción. Donde líneas y total ya
-- coinciden (todos menos esos 4) el factor es 1 y nada cambia.
--
-- dashboard_zonificado queda fuera: trata la línea como sin IGV y se revisa aparte.

CREATE OR REPLACE FUNCTION public.monto_linea_venta(p_subtotal numeric, p_comprobante_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    p_subtotal * c.total / NULLIF((SELECT SUM(ci.subtotal) FROM comprobantes_items ci WHERE ci.comprobante_id = p_comprobante_id), 0),
    p_subtotal)
    FROM comprobantes c WHERE c.id = p_comprobante_id
$function$;

GRANT EXECUTE ON FUNCTION public.monto_linea_venta(numeric, uuid) TO authenticated;


-- resumen_ventas_cuotas (1 reemplazo)
CREATE OR REPLACE FUNCTION public.resumen_ventas_cuotas(p_desde date, p_hasta date, p_familia_id uuid DEFAULT NULL::uuid)
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
             SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id) * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS ventas
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

-- alcance_objetivos_rango (1 reemplazo)
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
      SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id) * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor_real
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

-- alcance_objetivos (1 reemplazo)
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
      SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id) * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor_real
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

-- pwa_mis_cuotas (1 reemplazo)
CREATE OR REPLACE FUNCTION public.pwa_mis_cuotas(p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  ventas_prod AS (
    SELECT
      ci.producto_id,
      SUM(ci.cantidad * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant,
      SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id) * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    CROSS JOIN rango r
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND pe.vendedor_id = v_uid
      AND ci.producto_id IS NOT NULL
    GROUP BY ci.producto_id
  ),
  detalle AS (
    SELECT
      COALESCE(f.id::text, 'sin-familia') AS familia_key,
      COALESCE(f.nombre, 'SIN FAMILIA')   AS familia,
      COALESCE(f.codigo, 'ZZ')            AS familia_codigo,
      pr.codigo,
      nombre_producto(pr.nombre, pr.descripcion) AS descripcion,
      COALESCE(cp.cuota_cantidad, 0) AS cuota_cant,
      COALESCE(cp.cuota_valor, 0)    AS cuota_valor,
      COALESCE(vp.cant, 0)  AS vendido_cant,
      COALESCE(vp.valor, 0) AS vendido_valor
    FROM productos pr
    LEFT JOIN familias f ON f.id = pr.familia_id
    LEFT JOIN cuotas_vendedor_producto cp
      ON cp.producto_id = pr.id AND cp.vendedor_id = v_uid
      AND cp.anio = p_anio AND cp.mes = p_mes
    LEFT JOIN ventas_prod vp ON vp.producto_id = pr.id
    WHERE COALESCE(cp.cuota_valor, 0) > 0
       OR COALESCE(cp.cuota_cantidad, 0) > 0
       OR COALESCE(vp.valor, 0) <> 0
  ),
  mis_filas AS (
    SELECT
      d.familia_key, d.familia, d.familia_codigo,
      SUM(d.cuota_valor)   AS cuota,
      SUM(d.vendido_valor) AS vendido,
      jsonb_agg(jsonb_build_object(
        'codigo', d.codigo,
        'descripcion', d.descripcion,
        'cuota_cant', ROUND(d.cuota_cant, 2),
        'vendido_cant', ROUND(d.vendido_cant, 2),
        'cuota_valor', ROUND(d.cuota_valor, 2),
        'vendido_valor', ROUND(d.vendido_valor, 2),
        'pct_cant', CASE WHEN d.cuota_cant > 0
          THEN ROUND(d.vendido_cant / d.cuota_cant * 100, 1) ELSE NULL END,
        'pct_valor', CASE WHEN d.cuota_valor > 0
          THEN ROUND(d.vendido_valor / d.cuota_valor * 100, 1) ELSE NULL END
      ) ORDER BY d.descripcion) AS productos
    FROM detalle d
    GROUP BY d.familia_key, d.familia, d.familia_codigo
  ),
  solo_familia AS (
    SELECT
      f.id::text AS familia_key,
      f.nombre   AS familia,
      COALESCE(f.codigo, 'ZZ') AS familia_codigo,
      cf.cuota_monto AS cuota,
      0::NUMERIC AS vendido,
      '[]'::jsonb AS productos
    FROM cuotas_vendedor_familia cf
    JOIN familias f ON f.id = cf.familia_id
    WHERE cf.vendedor_id = v_uid AND cf.anio = p_anio AND cf.mes = p_mes
      AND cf.cuota_monto > 0
      AND f.id::text NOT IN (SELECT familia_key FROM mis_filas)
  ),
  todas AS (
    SELECT familia_key, familia, familia_codigo, cuota, vendido, productos FROM mis_filas
    UNION ALL
    SELECT familia_key, familia, familia_codigo, cuota, vendido, productos FROM solo_familia
  )
  -- Privacidad (pedido de Daniel): el vendedor NO ve la cuota ni la venta del
  -- resto del equipo. Solo lo suyo.
  SELECT jsonb_build_object(
    'anio', p_anio, 'mes', p_mes,
    'familias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'familia', familia,
        'codigo', familia_codigo,
        'cuota', ROUND(cuota, 2),
        'vendido', ROUND(vendido, 2),
        'pct', CASE WHEN cuota > 0 THEN ROUND(vendido / cuota * 100, 1) ELSE NULL END,
        'productos', productos
      ) ORDER BY familia_codigo, familia)
      FROM todas
    ), '[]'::jsonb),
    'mi_cuota_total',   COALESCE((SELECT ROUND(SUM(cuota), 2) FROM todas), 0),
    'mi_vendido_total', COALESCE((SELECT ROUND(SUM(vendido), 2) FROM todas), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- cumplimiento_cuotas_mes (1 reemplazo)
CREATE OR REPLACE FUNCTION public.cumplimiento_cuotas_mes(p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rango AS (
    SELECT
      make_date(p_anio, p_mes, 1) AS desde,
      (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  ventas AS (
    -- Subtotal sin IGV vendido por (vendedor, familia) en el mes
    -- El vendedor viene del pedido vinculado al comprobante
    SELECT
      pe.vendedor_id,
      p.familia_id,
      COALESCE(SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id)), 0) AS vendido_monto,
      COUNT(DISTINCT c.id) AS comprobantes
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    JOIN productos p ON p.id = ci.producto_id
    CROSS JOIN rango r
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND pe.vendedor_id IS NOT NULL
      AND p.familia_id IS NOT NULL
    GROUP BY pe.vendedor_id, p.familia_id
  ),
  matriz AS (
    SELECT
      v.id AS vendedor_id,
      COALESCE(v.full_name, v.email) AS vendedor_nombre,
      f.id AS familia_id,
      f.nombre AS familia_nombre,
      COALESCE(cu.cuota_monto, 0) AS cuota_monto,
      COALESCE(ve.vendido_monto, 0) AS vendido_monto,
      COALESCE(ve.comprobantes, 0) AS comprobantes
    FROM profiles v
    CROSS JOIN familias f
    LEFT JOIN cuotas_vendedor_familia cu
      ON cu.vendedor_id = v.id AND cu.familia_id = f.id
      AND cu.anio = p_anio AND cu.mes = p_mes
    LEFT JOIN ventas ve
      ON ve.vendedor_id = v.id AND ve.familia_id = f.id
    WHERE v.role = 'vendedor' AND COALESCE(v.activo, TRUE) = TRUE
  )
  SELECT jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'filas', COALESCE(jsonb_agg(jsonb_build_object(
      'vendedor_id', vendedor_id,
      'vendedor_nombre', vendedor_nombre,
      'familia_id', familia_id,
      'familia_nombre', familia_nombre,
      'cuota_monto', cuota_monto,
      'vendido_monto', vendido_monto,
      'comprobantes', comprobantes,
      'pct_cumplimiento', CASE WHEN cuota_monto > 0
        THEN ROUND((vendido_monto / cuota_monto) * 100, 1) ELSE NULL END,
      'diferencia', vendido_monto - cuota_monto
    ) ORDER BY vendedor_nombre, familia_nombre), '[]'::jsonb)
  ) FROM matriz;
$function$;

-- cuotas_producto_matriz (2 reemplazos)
CREATE OR REPLACE FUNCTION public.cuotas_producto_matriz(p_anio integer, p_mes integer, p_vendedor_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH periodo_ant AS (
    SELECT
      CASE WHEN p_mes = 1 THEN p_anio - 1 ELSE p_anio END AS anio,
      CASE WHEN p_mes = 1 THEN 12 ELSE p_mes - 1 END AS mes
  ),
  rango_ant AS (
    SELECT make_date(anio, mes, 1) AS desde,
           (make_date(anio, mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
    FROM periodo_ant
  ),
  -- Lo que ESTE vendedor vendió el mes pasado, como referencia para la cuota
  vendido_ant AS (
    SELECT
      ci.producto_id,
      SUM(ci.cantidad * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant,
      SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id) * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    CROSS JOIN rango_ant r
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND pe.vendedor_id = p_vendedor_id
      AND ci.producto_id IS NOT NULL
    GROUP BY ci.producto_id
  ),
  -- Precio promedio de venta real del mes anterior (todos los vendedores)
  promedio AS (
    SELECT ci.producto_id,
           ROUND(SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id)) / NULLIF(SUM(ci.cantidad), 0), 4) AS precio
    FROM comprobantes c
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    CROSS JOIN rango_ant r
    WHERE c.estado <> 'anulado'
      AND c.tipo::text <> 'nota_credito'
      AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND ci.producto_id IS NOT NULL
    GROUP BY ci.producto_id
  ),
  lista_b AS (
    SELECT lpi.producto_id, lpi.precio
    FROM lista_precio_items lpi
    JOIN listas_precio lp ON lp.id = lpi.lista_precio_id
    WHERE lp.nombre::text = 'B' AND lpi.activo
  ),
  filas AS (
    SELECT
      pr.id AS producto_id,
      pr.codigo,
      nombre_producto(pr.nombre, pr.descripcion) AS descripcion,
      pr.nombre AS categoria,
      f.id AS familia_id,
      COALESCE(f.codigo, 'ZZ')          AS linea_codigo,
      COALESCE(f.nombre, 'SIN FAMILIA') AS linea_nombre,
      COALESCE(cp.cuota_cantidad, 0) AS cuota_cantidad,
      COALESCE(cp.cuota_valor, 0)    AS cuota_valor,
      COALESCE(pm.precio, lb.precio, 0) AS precio_ref,
      (pm.precio IS NOT NULL)           AS precio_es_promedio,
      COALESCE(va.cant, 0)  AS vendido_ant_cant,
      COALESCE(va.valor, 0) AS vendido_ant_valor
    FROM productos pr
    LEFT JOIN familias f ON f.id = pr.familia_id
    LEFT JOIN cuotas_vendedor_producto cp
      ON cp.producto_id = pr.id AND cp.vendedor_id = p_vendedor_id
      AND cp.anio = p_anio AND cp.mes = p_mes
    LEFT JOIN promedio pm ON pm.producto_id = pr.id
    LEFT JOIN lista_b  lb ON lb.producto_id = pr.id
    LEFT JOIN vendido_ant va ON va.producto_id = pr.id
    WHERE pr.activo
  )
  SELECT jsonb_build_object(
    'anio', p_anio, 'mes', p_mes, 'vendedor_id', p_vendedor_id,
    'periodo_precio', (SELECT anio::text || '-' || LPAD(mes::text, 2, '0') FROM periodo_ant),
    'productos', COALESCE(jsonb_agg(jsonb_build_object(
      'producto_id', producto_id,
      'codigo', codigo,
      'descripcion', descripcion,
      'categoria', categoria,
      'familia_id', familia_id,
      'linea_codigo', linea_codigo,
      'linea_nombre', linea_nombre,
      'cuota_cantidad', cuota_cantidad,
      'cuota_valor', cuota_valor,
      'precio_ref', precio_ref,
      'precio_es_promedio', precio_es_promedio,
      'vendido_ant_cant', ROUND(vendido_ant_cant, 2),
      'vendido_ant_valor', ROUND(vendido_ant_valor, 2)
    ) ORDER BY linea_codigo, descripcion), '[]'::jsonb)
  ) FROM filas;
$function$;

-- calcular_comision_vendedor (1 reemplazo)
CREATE OR REPLACE FUNCTION public.calcular_comision_vendedor(p_vendedor_id uuid, p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lineas_base AS (
    SELECT
      ci.id AS item_id,
      p.familia_id,
      f.nombre AS familia_nombre,
      public.monto_linea_venta(ci.subtotal, ci.comprobante_id) AS monto
    FROM comprobantes_items ci
    JOIN comprobantes c ON c.id = ci.comprobante_id
    LEFT JOIN pedidos pe ON pe.id = c.pedido_id
    LEFT JOIN productos p ON p.id = ci.producto_id
    LEFT JOIN familias f ON f.id = p.familia_id
    WHERE c.fecha_emision BETWEEN p_desde AND p_hasta
      AND c.estado <> 'anulado'
      AND pe.vendedor_id = p_vendedor_id
  ),
  lineas_con_regla AS (
    SELECT
      l.*,
      COALESCE(
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id = p_vendedor_id AND familia_id = l.familia_id AND activo
          ORDER BY created_at DESC LIMIT 1),
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id = p_vendedor_id AND familia_id IS NULL AND activo
          ORDER BY created_at DESC LIMIT 1),
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id IS NULL AND familia_id = l.familia_id AND activo
          ORDER BY created_at DESC LIMIT 1),
        (SELECT id FROM comisiones_reglas
          WHERE vendedor_id IS NULL AND familia_id IS NULL AND activo
          ORDER BY created_at DESC LIMIT 1)
      ) AS regla_id
    FROM lineas_base l
  ),
  lineas_completas AS (
    SELECT
      l.*,
      r.porcentaje
    FROM lineas_con_regla l
    LEFT JOIN comisiones_reglas r ON r.id = l.regla_id
  ),
  por_familia AS (
    SELECT
      familia_id,
      familia_nombre,
      SUM(monto) AS monto_familia,
      AVG(porcentaje) AS porcentaje_prom,
      ROUND(COALESCE(SUM(monto * porcentaje) / 100, 0), 2) AS comision_familia,
      BOOL_OR(regla_id IS NOT NULL) AS tiene_regla
    FROM lineas_completas
    GROUP BY familia_id, familia_nombre
  )
  SELECT jsonb_build_object(
    'vendedor_id', p_vendedor_id,
    'desde', p_desde,
    'hasta', p_hasta,
    'total_ventas', COALESCE((SELECT SUM(monto) FROM lineas_base), 0),
    'total_comision', COALESCE((
      SELECT ROUND(SUM(monto * COALESCE(porcentaje, 0)) / 100, 2)
      FROM lineas_completas WHERE regla_id IS NOT NULL
    ), 0),
    'lineas_sin_regla', (SELECT COUNT(*) FROM lineas_completas WHERE regla_id IS NULL),
    'monto_sin_regla', COALESCE(
      (SELECT SUM(monto) FROM lineas_completas WHERE regla_id IS NULL), 0),
    'desglose', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'familia_id', familia_id,
        'familia_nombre', COALESCE(familia_nombre, 'â€” Sin familia â€”'),
        'monto_ventas', monto_familia,
        'porcentaje_promedio', porcentaje_prom,
        'monto_comision', comision_familia,
        'tiene_regla', tiene_regla
      ) ORDER BY monto_familia DESC)
      FROM por_familia
    ), '[]'::jsonb)
  );
$function$;
