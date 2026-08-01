-- ─────────────────────────────────────────────────────────────────────────────
-- 082: Precio promedio de venta para valorizar cuotas + privacidad del vendedor
--
-- Reunión con Daniel y Christopher:
--
-- 1) "¿Qué precio debe jalar? El precio promedio, porque siempre va a variar
--     cada mes". Christopher lo llamó "venta promedio". Se usa el precio
--     promedio de venta REAL del mes anterior (total vendido / cantidad
--     vendida), con el precio de lista B como respaldo si el producto no se
--     vendió ese mes.
--
-- 2) "El vendedor solamente quiero que tenga acceso a sus cuotas mensuales,
--     más no la venta de todos... tenemos vendedores que se van y vienen y no
--     quisiera que vea todo el movimiento que hay dentro".
--     → pwa_mis_cuotas deja de exponer los totales del equipo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Precio promedio de venta real de un producto en un mes dado
CREATE OR REPLACE FUNCTION precio_promedio_venta(
  p_producto_id UUID,
  p_anio INT,
  p_mes INT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(SUM(ci.cantidad), 0) > 0
    THEN ROUND(SUM(ci.subtotal) / SUM(ci.cantidad), 4)
    ELSE NULL
  END
  FROM comprobantes c
  JOIN comprobantes_items ci ON ci.comprobante_id = c.id
  WHERE ci.producto_id = p_producto_id
    AND c.estado <> 'anulado'
    AND c.tipo::text <> 'nota_credito'
    AND c.fecha_emision >= make_date(p_anio, p_mes, 1)
    AND c.fecha_emision < make_date(p_anio, p_mes, 1) + INTERVAL '1 month';
$$;

GRANT EXECUTE ON FUNCTION precio_promedio_venta TO authenticated;

COMMENT ON FUNCTION precio_promedio_venta IS
  'Precio promedio de venta real (sin IGV) de un producto en un mes: total vendido / cantidad vendida.';

-- ── Matriz de carga: ahora sugiere el PRECIO PROMEDIO del mes anterior
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
  -- Precio promedio de venta real del mes anterior (todos los vendedores)
  promedio AS (
    SELECT
      ci.producto_id,
      ROUND(SUM(ci.subtotal) / NULLIF(SUM(ci.cantidad), 0), 4) AS precio
    FROM comprobantes c
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    CROSS JOIN periodo_ant pa
    WHERE c.estado <> 'anulado'
      AND c.tipo::text <> 'nota_credito'
      AND c.fecha_emision >= make_date(pa.anio, pa.mes, 1)
      AND c.fecha_emision < make_date(pa.anio, pa.mes, 1) + INTERVAL '1 month'
      AND ci.producto_id IS NOT NULL
    GROUP BY ci.producto_id
  ),
  -- Respaldo: lista B (trabajo normal) si el producto no se vendió el mes pasado
  lista_b AS (
    SELECT lpi.producto_id, lpi.precio
    FROM lista_precio_items lpi
    JOIN listas_precio lp ON lp.id = lpi.lista_precio_id
    WHERE lp.nombre::text = 'B' AND lpi.activo
  ),
  filas AS (
    SELECT
      pr.id            AS producto_id,
      pr.codigo,
      pr.nombre        AS descripcion,
      f.id             AS familia_id,
      COALESCE(f.codigo, 'ZZ')          AS linea_codigo,
      COALESCE(f.nombre, 'SIN FAMILIA') AS linea_nombre,
      COALESCE(cp.cuota_cantidad, 0) AS cuota_cantidad,
      COALESCE(cp.cuota_valor, 0)    AS cuota_valor,
      COALESCE(pm.precio, lb.precio, 0) AS precio_ref,
      (pm.precio IS NOT NULL)           AS precio_es_promedio
    FROM productos pr
    LEFT JOIN familias f ON f.id = pr.familia_id
    LEFT JOIN cuotas_vendedor_producto cp
      ON cp.producto_id = pr.id AND cp.vendedor_id = p_vendedor_id
      AND cp.anio = p_anio AND cp.mes = p_mes
    LEFT JOIN promedio pm ON pm.producto_id = pr.id
    LEFT JOIN lista_b  lb ON lb.producto_id = pr.id
    WHERE pr.activo
  )
  SELECT jsonb_build_object(
    'anio', p_anio, 'mes', p_mes, 'vendedor_id', p_vendedor_id,
    'periodo_precio', (SELECT anio::text || '-' || LPAD(mes::text, 2, '0') FROM periodo_ant),
    'productos', COALESCE(jsonb_agg(jsonb_build_object(
      'producto_id', producto_id,
      'codigo', codigo,
      'descripcion', descripcion,
      'familia_id', familia_id,
      'linea_codigo', linea_codigo,
      'linea_nombre', linea_nombre,
      'cuota_cantidad', cuota_cantidad,
      'cuota_valor', cuota_valor,
      'precio_ref', precio_ref,
      'precio_es_promedio', precio_es_promedio
    ) ORDER BY linea_codigo, descripcion), '[]'::jsonb)
  ) FROM filas;
$$;

GRANT EXECUTE ON FUNCTION cuotas_producto_matriz TO authenticated;

-- ── PWA del vendedor: ya no devuelve los totales del equipo
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
      pr.nombre AS descripcion,
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
