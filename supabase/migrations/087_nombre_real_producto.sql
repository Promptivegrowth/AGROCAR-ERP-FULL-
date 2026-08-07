-- ─────────────────────────────────────────────────────────────────────────────
-- 087: Mostrar el NOMBRE REAL del producto, no la categoría
--
-- Daniel: "por favor el nombre del producto que aparezca".
--
-- En el catálogo de AGROCAR `productos.nombre` es la categoría genérica y el
-- nombre real vive en `productos.descripcion`:
--
--   codigo  nombre      descripcion
--   PT788I  CHORIZOS    CHORIZO FINAS HIERBAS SUR X 12UND. 1 KG. CERDEÑA
--   PT756A  CHORIZOS    CHORIZO PARRILLERO UNITARIO X 75 GR.CERDEÑA
--   PT740D  CHORIZOS    CHORIZO CON OREGANO.X.16 X 1KG.CERDEÑA
--
-- De 63 productos activos hay apenas 21 nombres distintos pero 63
-- descripciones distintas. Al mostrar `nombre` salían once filas iguales que
-- decían "CHORIZOS" y no había forma de saber a cuál asignarle la cuota.
-- Afectaba a las cuotas por producto, al reporte Alcance de Objetivos, al
-- análisis zonificado y a las cuotas del aplicativo.
--
-- De paso, la matriz de carga suma una referencia que pedía a gritos: cuánto
-- se vendió de cada producto el mes anterior, para no fijar la cuota a ciegas.
-- ─────────────────────────────────────────────────────────────────────────────

-- Nombre presentable de un producto: la descripción si la tiene, si no el nombre
CREATE OR REPLACE FUNCTION nombre_producto(p_nombre TEXT, p_descripcion TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(TRIM(p_descripcion), ''), NULLIF(TRIM(p_nombre), ''), '—');
$$;

COMMENT ON FUNCTION nombre_producto IS
  'Nombre con el que se muestra un producto: la descripción (que es el nombre real) y, si está vacía, el nombre genérico.';

-- ── Matriz de carga de cuotas: nombre real + venta del mes anterior
CREATE OR REPLACE FUNCTION cuotas_producto_matriz(
  p_anio INT,
  p_mes INT,
  p_vendedor_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      SUM(ci.subtotal * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor
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
           ROUND(SUM(ci.subtotal) / NULLIF(SUM(ci.cantidad), 0), 4) AS precio
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
$$;

GRANT EXECUTE ON FUNCTION cuotas_producto_matriz TO authenticated;

-- ── Reporte Alcance de Objetivos: nombre real en el detalle por producto
CREATE OR REPLACE FUNCTION alcance_objetivos(
  p_anio INT, p_mes INT, p_vendedor_id UUID, p_solo_con_datos BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_vendedor TEXT;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_vendedor FROM profiles WHERE id = p_vendedor_id;

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
      AND pe.vendedor_id = p_vendedor_id AND ci.producto_id IS NOT NULL
    GROUP BY ci.producto_id
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
    LEFT JOIN cuotas_vendedor_producto cp
      ON cp.producto_id = pr.id AND cp.vendedor_id = p_vendedor_id
      AND cp.anio = p_anio AND cp.mes = p_mes
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
    'total_valor_real', COALESCE(ROUND(SUM(tot_valor_real), 2), 0),
    'total_valor_cuota', COALESCE(ROUND(SUM(tot_valor_cuota), 2), 0),
    'alc_total', CASE WHEN COALESCE(SUM(tot_valor_cuota), 0) > 0
      THEN ROUND(SUM(tot_valor_real) / SUM(tot_valor_cuota) * 100, 2) ELSE NULL END
  ) INTO v_result FROM lineas;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION alcance_objetivos TO authenticated;

-- ── Análisis zonificado: nombre real en el panel de productos
CREATE OR REPLACE FUNCTION dashboard_zonificado(
  p_desde DATE,
  p_hasta DATE,
  p_tipo_comp TEXT DEFAULT NULL,
  p_vendedor_id UUID DEFAULT NULL,
  p_con_igv BOOLEAN DEFAULT FALSE,
  p_agrupar_por TEXT DEFAULT 'zona'
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
      (CASE WHEN p_con_igv
            THEN ROUND(ci.subtotal * (1 + COALESCE(ci.igv_porcentaje, 0) / 100.0), 2)
            ELSE ci.subtotal END)
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
$$;

GRANT EXECUTE ON FUNCTION dashboard_zonificado TO authenticated;

-- ── Cuotas del aplicativo: nombre real en el detalle por producto
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
  ventas_prod AS (
    SELECT
      ci.producto_id,
      SUM(ci.cantidad * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant,
      SUM(ci.subtotal * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor
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
$$;

GRANT EXECUTE ON FUNCTION pwa_mis_cuotas TO authenticated;
