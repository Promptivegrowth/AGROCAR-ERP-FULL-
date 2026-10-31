-- Dashboard → Zonificado: el selector "Sin IGV / Con IGV" estaba al revés.
--
-- comprobantes_items.subtotal ya viene con IGV (las líneas suman el total
-- impreso; la base imponible es comprobantes.subtotal). La función lo trataba
-- como base: "Sin IGV" (lo que abre por defecto) mostraba montos con IGV y
-- "Con IGV" les sumaba el 18 % otra vez. Con octubre 2026: "sin IGV" decía
-- S/ 620,396.05 en vez de S/ 525,758.83, y "con IGV" S/ 732,068.69.
--
-- Ahora "Con IGV" suma lo impreso (monto_linea_venta, migración 148) y "Sin
-- IGV" la base imponible de cada comprobante, repartida entre sus líneas.

CREATE OR REPLACE FUNCTION public.dashboard_zonificado(p_desde date, p_hasta date, p_tipo_comp text DEFAULT NULL::text, p_vendedor_id uuid DEFAULT NULL::uuid, p_con_igv boolean DEFAULT false, p_agrupar_por text DEFAULT 'zona'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_result JSONB;
  v_por_distrito BOOLEAN := (p_agrupar_por = 'distrito');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;
  IF v_rol NOT IN ('administrador', 'gerente', 'contador', 'caja', 'facturador') THEN
    RAISE EXCEPTION 'Sin permiso para ver el análisis zonificado';
  END IF;

  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'Debe indicar el rango de fechas';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'La fecha final no puede ser anterior a la inicial';
  END IF;

  WITH
  -- Cada zona resuelve a qué grupo pertenece según lo que se pidió
  grupo_zona AS (
    SELECT
      z.id AS zona_id,
      CASE WHEN v_por_distrito
           THEN COALESCE(NULLIF(TRIM(z.distrito), ''), 'Sin distrito')
           ELSE z.id::text END AS grupo_key,
      CASE WHEN v_por_distrito
           THEN COALESCE(NULLIF(TRIM(z.distrito), ''), 'Sin distrito')
           ELSE z.nombre END AS grupo_nombre,
      z.centro_lat, z.centro_lng, z.centro_aproximado
    FROM zonas z
  ),
  -- Punto del mapa por grupo: la zona tal cual, o el promedio del distrito
  grupo_punto AS (
    SELECT
      grupo_key,
      MIN(grupo_nombre) AS grupo_nombre,
      AVG(centro_lat) FILTER (WHERE centro_lat IS NOT NULL) AS lat,
      AVG(centro_lng) FILTER (WHERE centro_lng IS NOT NULL) AS lng,
      BOOL_AND(COALESCE(centro_aproximado, TRUE))
        FILTER (WHERE centro_lat IS NOT NULL) AS aproximado
    FROM grupo_zona
    GROUP BY grupo_key
  ),
  -- Ítems vendidos en el rango, ya con signo, monto y grupo resueltos
  items AS (
    SELECT
      ci.producto_id,
      c.cliente_id,
      COALESCE(gz.grupo_key, 'sin-zona') AS grupo_key,
      ci.cantidad * (CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant,
      -- La línea ya viene CON IGV (suma el total impreso). Sin IGV se lleva a
      -- la base imponible con la proporción base/total de su comprobante.
      (CASE WHEN p_con_igv
            THEN public.monto_linea_venta(ci.subtotal, ci.comprobante_id)
            ELSE public.monto_linea_venta(ci.subtotal, ci.comprobante_id)
                 * COALESCE(c.subtotal / NULLIF(c.total, 0), 1) END)
        * (CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS monto
    FROM comprobantes c
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    LEFT JOIN pedidos pe ON pe.id = c.pedido_id
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN grupo_zona gz ON gz.zona_id = cl.zona_id
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN p_desde AND p_hasta
      AND (p_vendedor_id IS NULL OR pe.vendedor_id = p_vendedor_id)
      AND (
        CASE
          WHEN p_tipo_comp IS NULL OR p_tipo_comp = '' OR p_tipo_comp = 'todos'
            THEN TRUE
          ELSE c.tipo::text = p_tipo_comp
        END
      )
  ),
  -- Panel "Categoría productos", agrupado por familia
  productos AS (
    SELECT
      pr.id AS producto_id, pr.codigo,
      nombre_producto(pr.nombre, pr.descripcion) AS nombre,
      COALESCE(f.id::text, 'sin-familia') AS familia_key,
      COALESCE(f.nombre, 'SIN FAMILIA')   AS familia,
      COALESCE(f.codigo, 'ZZ')            AS familia_codigo,
      SUM(i.monto) AS ventas,
      SUM(i.cant)  AS cantidad,
      SUM(i.cant * COALESCE(pr.peso_kg, 0)) AS peso
    FROM items i
    JOIN productos pr ON pr.id = i.producto_id
    LEFT JOIN familias f ON f.id = pr.familia_id
    GROUP BY pr.id, pr.codigo, pr.nombre, pr.descripcion, f.id, f.nombre, f.codigo
    HAVING SUM(i.monto) <> 0 OR SUM(i.cant) <> 0
  ),
  -- Visitas del rango por cliente
  visitas AS (
    SELECT g.cliente_id, COUNT(*) AS n
    FROM gps_checkins g
    WHERE g.cliente_id IS NOT NULL
      AND g.tipo::text IN ('entrada', 'visita_sin_compra')
      AND (g.created_at AT TIME ZONE 'America/Lima')::date BETWEEN p_desde AND p_hasta
      AND (p_vendedor_id IS NULL OR g.usuario_id = p_vendedor_id)
    GROUP BY g.cliente_id
  ),
  ventas_cliente AS (
    SELECT i.cliente_id, MIN(i.grupo_key) AS grupo_key, SUM(i.monto) AS ventas
    FROM items i
    WHERE i.cliente_id IS NOT NULL
    GROUP BY i.cliente_id
  ),
  -- Panel "Categoría clientes": quien compró o quien fue visitado
  clientes AS (
    SELECT
      cl.id AS cliente_id,
      cl.razon_social AS nombre,
      COALESCE(vc.grupo_key, gz.grupo_key, 'sin-zona') AS grupo_key,
      COALESCE(vc.ventas, 0) AS ventas,
      COALESCE(v.n, 0)       AS visitas
    FROM clientes cl
    LEFT JOIN ventas_cliente vc ON vc.cliente_id = cl.id
    LEFT JOIN visitas v ON v.cliente_id = cl.id
    LEFT JOIN grupo_zona gz ON gz.zona_id = cl.zona_id
    WHERE COALESCE(vc.ventas, 0) <> 0 OR COALESCE(v.n, 0) > 0
  ),
  -- Panel "Puntos de venta"
  grupos AS (
    SELECT
      i.grupo_key,
      SUM(i.monto) AS ventas,
      SUM(i.cant)  AS cantidad
    FROM items i
    GROUP BY i.grupo_key
  ),
  -- Matriz producto × grupo: alimenta el cruce al hacer clic
  matriz AS (
    SELECT i.producto_id, i.grupo_key, SUM(i.monto) AS ventas
    FROM items i
    WHERE i.producto_id IS NOT NULL
    GROUP BY i.producto_id, i.grupo_key
    HAVING SUM(i.monto) <> 0
  )
  SELECT jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'con_igv', p_con_igv, 'agrupar_por', COALESCE(p_agrupar_por, 'zona'),
    'productos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', producto_id, 'codigo', codigo, 'nombre', nombre,
        'familia_key', familia_key, 'familia', familia, 'familia_codigo', familia_codigo,
        'ventas', ROUND(ventas, 2), 'cantidad', ROUND(cantidad, 2), 'peso', ROUND(peso, 2)
      ) ORDER BY ventas DESC) FROM productos
    ), '[]'::jsonb),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cliente_id, 'nombre', nombre, 'grupo_key', grupo_key,
        'ventas', ROUND(ventas, 2), 'visitas', visitas
      ) ORDER BY ventas DESC) FROM clientes
    ), '[]'::jsonb),
    'grupos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', g.grupo_key,
        'nombre', COALESCE(gp.grupo_nombre, 'Sin zona'),
        'ventas', ROUND(g.ventas, 2),
        'lat', gp.lat, 'lng', gp.lng,
        'aproximado', COALESCE(gp.aproximado, FALSE)
      ) ORDER BY g.ventas DESC)
      FROM grupos g LEFT JOIN grupo_punto gp ON gp.grupo_key = g.grupo_key
    ), '[]'::jsonb),
    'matriz', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'p', producto_id, 'g', grupo_key, 'v', ROUND(ventas, 2)
      )) FROM matriz
    ), '[]'::jsonb),
    'totales', jsonb_build_object(
      'ventas',   COALESCE((SELECT ROUND(SUM(ventas), 2) FROM productos), 0),
      'cantidad', COALESCE((SELECT ROUND(SUM(cantidad), 2) FROM productos), 0),
      'peso',     COALESCE((SELECT ROUND(SUM(peso), 2) FROM productos), 0),
      'visitas',  COALESCE((SELECT SUM(visitas) FROM clientes), 0)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
