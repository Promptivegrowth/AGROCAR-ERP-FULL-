-- ─────────────────────────────────────────────────────────────────────────────
-- 080: Cuotas por PRODUCTO dentro de cada familia + reporte ALCANCE DE OBJETIVOS
--
-- Pedido de Daniel (modelo del sistema anterior, reporte "ALCANCE DE OBJETIVOS"):
--   VENDEDOR: 001 - DANIEL CAICHIHUA BACA        PERIODO: 202501
--   LINEA: 01 - CERDEÑA
--   CODIGO | DESCRIPCION | CANT.REAL | CANT.CUOTA | ALC.CANT | VALOR REAL | VALOR CUOTA | ALC.VALOR
--   ... subtotal por línea ... TOTAL GENERAL
--
-- Es decir: la cuota se asigna a NIVEL DE PRODUCTO, con DOBLE medición
-- (cantidad y valor), y el reporte agrupa por familia (= "línea") mostrando
-- el % de alcance de cada producto, de cada línea y el total general.
--
-- La cuota por familia (cuotas_vendedor_familia, migración 057) se mantiene y
-- pasa a ser el ROLLUP automático de las cuotas por producto — así la PWA del
-- vendedor y el reporte de cumplimiento siguen cuadrando sin doble digitación.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Código de línea para las familias (LINEA: 01 - CERDEÑA)
ALTER TABLE familias ADD COLUMN IF NOT EXISTS codigo TEXT;

COMMENT ON COLUMN familias.codigo IS
  'Código de línea usado en el reporte Alcance de Objetivos (ej: 01, 02, 03).';

-- Numeración inicial por orden alfabético si aún no tienen código
WITH numeradas AS (
  SELECT id, LPAD((ROW_NUMBER() OVER (ORDER BY nombre))::text, 2, '0') AS nuevo
  FROM familias WHERE codigo IS NULL
)
UPDATE familias f SET codigo = n.nuevo FROM numeradas n WHERE f.id = n.id;

-- ── 2. Tabla de cuotas por producto
CREATE TABLE IF NOT EXISTS cuotas_vendedor_producto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  producto_id    UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  anio           INT NOT NULL CHECK (anio BETWEEN 2024 AND 2100),
  mes            INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  cuota_cantidad NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (cuota_cantidad >= 0),
  cuota_valor    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cuota_valor >= 0),
  notas          TEXT,
  created_by     UUID REFERENCES profiles(id),
  updated_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_cuota_vendedor_producto_mes UNIQUE (vendedor_id, producto_id, anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_cuotas_prod_periodo  ON cuotas_vendedor_producto (anio, mes);
CREATE INDEX IF NOT EXISTS idx_cuotas_prod_vendedor ON cuotas_vendedor_producto (vendedor_id, anio, mes);

COMMENT ON TABLE cuotas_vendedor_producto IS
  'Cuota mensual por vendedor y producto, en cantidad (unidades/kg) y valor (S/ sin IGV).';

ALTER TABLE cuotas_vendedor_producto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cuotas_prod_select ON cuotas_vendedor_producto;
CREATE POLICY cuotas_prod_select ON cuotas_vendedor_producto FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS cuotas_prod_write ON cuotas_vendedor_producto;
CREATE POLICY cuotas_prod_write ON cuotas_vendedor_producto FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente'])
);

-- ── 3. Rollup: cuota por familia = suma de cuotas de sus productos
-- Solo pisa las familias que tienen al menos una cuota de producto cargada,
-- para no borrar cuotas de familia digitadas a mano.
CREATE OR REPLACE FUNCTION sincronizar_cuota_familia_desde_productos(
  p_anio INT,
  p_mes INT,
  p_vendedor_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INT := 0;
BEGIN
  INSERT INTO cuotas_vendedor_familia (
    vendedor_id, familia_id, anio, mes, cuota_monto, created_by, updated_by
  )
  SELECT cp.vendedor_id, pr.familia_id, p_anio, p_mes,
         SUM(cp.cuota_valor), v_uid, v_uid
  FROM cuotas_vendedor_producto cp
  JOIN productos pr ON pr.id = cp.producto_id
  WHERE cp.anio = p_anio AND cp.mes = p_mes
    AND pr.familia_id IS NOT NULL
    AND (p_vendedor_id IS NULL OR cp.vendedor_id = p_vendedor_id)
  GROUP BY cp.vendedor_id, pr.familia_id
  ON CONFLICT (vendedor_id, familia_id, anio, mes) DO UPDATE
    SET cuota_monto = EXCLUDED.cuota_monto,
        updated_by  = v_uid,
        updated_at  = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION sincronizar_cuota_familia_desde_productos TO authenticated;

-- ── 4. Upsert masivo de cuotas por producto de UN vendedor en el mes
-- p_cuotas: [{producto_id, cuota_cantidad, cuota_valor}, ...]
-- Las filas con cantidad y valor en 0 se ELIMINAN (limpieza de la matriz).
CREATE OR REPLACE FUNCTION upsert_cuotas_producto_mes(
  p_anio INT,
  p_mes INT,
  p_vendedor_id UUID,
  p_cuotas JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_item JSONB;
  v_prod UUID;
  v_cant NUMERIC;
  v_val  NUMERIC;
  v_guardadas INT := 0;
  v_borradas  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;
  IF v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administrador o gerencia pueden asignar cuotas';
  END IF;

  IF p_vendedor_id IS NULL THEN RAISE EXCEPTION 'Debe indicar el vendedor'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_cuotas, '[]'::jsonb)) LOOP
    v_prod := (v_item->>'producto_id')::UUID;
    v_cant := COALESCE((v_item->>'cuota_cantidad')::NUMERIC, 0);
    v_val  := COALESCE((v_item->>'cuota_valor')::NUMERIC, 0);

    IF v_prod IS NULL THEN CONTINUE; END IF;

    IF v_cant = 0 AND v_val = 0 THEN
      DELETE FROM cuotas_vendedor_producto
      WHERE vendedor_id = p_vendedor_id AND producto_id = v_prod
        AND anio = p_anio AND mes = p_mes;
      IF FOUND THEN v_borradas := v_borradas + 1; END IF;
    ELSE
      INSERT INTO cuotas_vendedor_producto (
        vendedor_id, producto_id, anio, mes, cuota_cantidad, cuota_valor,
        created_by, updated_by
      ) VALUES (
        p_vendedor_id, v_prod, p_anio, p_mes, v_cant, v_val, v_uid, v_uid
      )
      ON CONFLICT (vendedor_id, producto_id, anio, mes) DO UPDATE
        SET cuota_cantidad = EXCLUDED.cuota_cantidad,
            cuota_valor    = EXCLUDED.cuota_valor,
            updated_by     = v_uid,
            updated_at     = NOW();
      v_guardadas := v_guardadas + 1;
    END IF;
  END LOOP;

  -- Recalcular la cuota por familia de este vendedor (rollup)
  PERFORM sincronizar_cuota_familia_desde_productos(p_anio, p_mes, p_vendedor_id);

  -- Familias que se quedaron sin ninguna cuota de producto → cuota 0
  UPDATE cuotas_vendedor_familia cf
  SET cuota_monto = 0, updated_by = v_uid, updated_at = NOW()
  WHERE cf.vendedor_id = p_vendedor_id AND cf.anio = p_anio AND cf.mes = p_mes
    AND NOT EXISTS (
      SELECT 1 FROM cuotas_vendedor_producto cp
      JOIN productos pr ON pr.id = cp.producto_id
      WHERE cp.vendedor_id = p_vendedor_id AND cp.anio = p_anio AND cp.mes = p_mes
        AND pr.familia_id = cf.familia_id
    );

  RETURN jsonb_build_object('guardadas', v_guardadas, 'borradas', v_borradas);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_cuotas_producto_mes TO authenticated;

-- ── 5. Copiar las cuotas de producto del mes anterior
CREATE OR REPLACE FUNCTION copiar_cuotas_producto_mes_anterior(
  p_anio INT,
  p_mes INT,
  p_vendedor_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_anio_ant INT;
  v_mes_ant INT;
  v_count INT;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;
  IF v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administrador o gerencia pueden copiar cuotas';
  END IF;

  IF p_mes = 1 THEN v_anio_ant := p_anio - 1; v_mes_ant := 12;
  ELSE v_anio_ant := p_anio; v_mes_ant := p_mes - 1; END IF;

  INSERT INTO cuotas_vendedor_producto (
    vendedor_id, producto_id, anio, mes, cuota_cantidad, cuota_valor,
    created_by, updated_by
  )
  SELECT vendedor_id, producto_id, p_anio, p_mes, cuota_cantidad, cuota_valor,
         v_uid, v_uid
  FROM cuotas_vendedor_producto
  WHERE anio = v_anio_ant AND mes = v_mes_ant
    AND (p_vendedor_id IS NULL OR vendedor_id = p_vendedor_id)
  ON CONFLICT (vendedor_id, producto_id, anio, mes) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM sincronizar_cuota_familia_desde_productos(p_anio, p_mes, p_vendedor_id);
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION copiar_cuotas_producto_mes_anterior TO authenticated;

-- ── 6. Matriz de carga: catálogo + cuota actual + precio de lista sugerido
-- Sirve para la pantalla donde Daniel digita las cuotas producto por producto.
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
  WITH precio_ref AS (
    -- Precio de la lista B (trabajo normal) como referencia para sugerir valor
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
      COALESCE(f.codigo, 'ZZ')  AS linea_codigo,
      COALESCE(f.nombre, 'SIN FAMILIA') AS linea_nombre,
      COALESCE(cp.cuota_cantidad, 0) AS cuota_cantidad,
      COALESCE(cp.cuota_valor, 0)    AS cuota_valor,
      COALESCE(px.precio, 0)         AS precio_ref
    FROM productos pr
    LEFT JOIN familias f ON f.id = pr.familia_id
    LEFT JOIN cuotas_vendedor_producto cp
      ON cp.producto_id = pr.id AND cp.vendedor_id = p_vendedor_id
      AND cp.anio = p_anio AND cp.mes = p_mes
    LEFT JOIN precio_ref px ON px.producto_id = pr.id
    WHERE pr.activo
  )
  SELECT jsonb_build_object(
    'anio', p_anio, 'mes', p_mes, 'vendedor_id', p_vendedor_id,
    'productos', COALESCE(jsonb_agg(jsonb_build_object(
      'producto_id', producto_id,
      'codigo', codigo,
      'descripcion', descripcion,
      'familia_id', familia_id,
      'linea_codigo', linea_codigo,
      'linea_nombre', linea_nombre,
      'cuota_cantidad', cuota_cantidad,
      'cuota_valor', cuota_valor,
      'precio_ref', precio_ref
    ) ORDER BY linea_codigo, descripcion), '[]'::jsonb)
  ) FROM filas;
$$;

GRANT EXECUTE ON FUNCTION cuotas_producto_matriz TO authenticated;

-- ── 7. REPORTE: ALCANCE DE OBJETIVOS
-- Réplica del reporte del sistema anterior: por vendedor y periodo, agrupado
-- por línea (familia), con cantidad y valor real vs cuota y sus % de alcance.
--
-- p_solo_con_datos = TRUE  → solo productos con cuota o con venta (por defecto)
-- p_solo_con_datos = FALSE → todo el catálogo activo (incluye filas en cero)
--
-- Ventas: comprobantes no anulados del mes cuyo pedido tiene ese vendedor.
-- Las notas de crédito restan (cantidad y valor).
CREATE OR REPLACE FUNCTION alcance_objetivos(
  p_anio INT,
  p_mes INT,
  p_vendedor_id UUID,
  p_solo_con_datos BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    SELECT
      ci.producto_id,
      SUM(ci.cantidad * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant_real,
      SUM(ci.subtotal * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor_real
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    CROSS JOIN rango r
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN r.desde AND r.hasta
      AND pe.vendedor_id = p_vendedor_id
      AND ci.producto_id IS NOT NULL
    GROUP BY ci.producto_id
  ),
  filas AS (
    SELECT
      COALESCE(f.codigo, 'ZZ') AS linea_codigo,
      COALESCE(f.nombre, 'SIN FAMILIA') AS linea_nombre,
      COALESCE(f.id::text, 'sin-familia') AS linea_key,
      pr.codigo,
      pr.nombre AS descripcion,
      COALESCE(v.cant_real, 0)   AS cant_real,
      COALESCE(cp.cuota_cantidad, 0) AS cant_cuota,
      COALESCE(v.valor_real, 0)  AS valor_real,
      COALESCE(cp.cuota_valor, 0)    AS valor_cuota
    FROM productos pr
    LEFT JOIN familias f ON f.id = pr.familia_id
    LEFT JOIN cuotas_vendedor_producto cp
      ON cp.producto_id = pr.id AND cp.vendedor_id = p_vendedor_id
      AND cp.anio = p_anio AND cp.mes = p_mes
    LEFT JOIN ventas v ON v.producto_id = pr.id
    WHERE (pr.activo OR COALESCE(v.cant_real, 0) <> 0)
      AND (
        NOT p_solo_con_datos
        OR COALESCE(cp.cuota_cantidad, 0) <> 0
        OR COALESCE(cp.cuota_valor, 0) <> 0
        OR COALESCE(v.cant_real, 0) <> 0
        OR COALESCE(v.valor_real, 0) <> 0
      )
  ),
  lineas AS (
    SELECT
      linea_key, linea_codigo, linea_nombre,
      SUM(cant_real) AS tot_cant_real,
      SUM(cant_cuota) AS tot_cant_cuota,
      SUM(valor_real) AS tot_valor_real,
      SUM(valor_cuota) AS tot_valor_cuota,
      jsonb_agg(jsonb_build_object(
        'codigo', codigo,
        'descripcion', descripcion,
        'cant_real', ROUND(cant_real, 2),
        'cant_cuota', ROUND(cant_cuota, 2),
        'alc_cant', CASE WHEN cant_cuota > 0
          THEN ROUND(cant_real / cant_cuota * 100, 2) ELSE NULL END,
        'valor_real', ROUND(valor_real, 2),
        'valor_cuota', ROUND(valor_cuota, 2),
        'alc_valor', CASE WHEN valor_cuota > 0
          THEN ROUND(valor_real / valor_cuota * 100, 2) ELSE NULL END
      ) ORDER BY descripcion) AS productos
    FROM filas
    GROUP BY linea_key, linea_codigo, linea_nombre
  )
  SELECT jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'periodo', p_anio::text || LPAD(p_mes::text, 2, '0'),
    'vendedor_id', p_vendedor_id,
    'vendedor_nombre', COALESCE(v_vendedor, '—'),
    'lineas', COALESCE(jsonb_agg(jsonb_build_object(
      'codigo', linea_codigo,
      'nombre', linea_nombre,
      'productos', productos,
      'tot_cant_real', ROUND(tot_cant_real, 2),
      'tot_cant_cuota', ROUND(tot_cant_cuota, 2),
      'tot_valor_real', ROUND(tot_valor_real, 2),
      'tot_valor_cuota', ROUND(tot_valor_cuota, 2),
      'alc_valor', CASE WHEN tot_valor_cuota > 0
        THEN ROUND(tot_valor_real / tot_valor_cuota * 100, 2) ELSE NULL END
    ) ORDER BY linea_codigo), '[]'::jsonb),
    'total_valor_real', COALESCE(ROUND(SUM(tot_valor_real), 2), 0),
    'total_valor_cuota', COALESCE(ROUND(SUM(tot_valor_cuota), 2), 0),
    'alc_total', CASE WHEN COALESCE(SUM(tot_valor_cuota), 0) > 0
      THEN ROUND(SUM(tot_valor_real) / SUM(tot_valor_cuota) * 100, 2) ELSE NULL END
  ) INTO v_result
  FROM lineas;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION alcance_objetivos TO authenticated;

-- ── 8. PWA: el vendedor autenticado ve SU alcance de objetivos
-- Reutiliza alcance_objetivos con su propio auth.uid().
CREATE OR REPLACE FUNCTION pwa_mi_alcance_objetivos(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  RETURN alcance_objetivos(p_anio, p_mes, v_uid, TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION pwa_mi_alcance_objetivos TO authenticated;

-- ── 9. pwa_mis_cuotas ahora incluye el DETALLE POR PRODUCTO de cada familia
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
  -- Venta real del vendedor por producto (NC resta)
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
  -- Detalle producto: los que tienen cuota o venta
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
  -- Familias del vendedor: cuota (rollup de productos) + venta real
  mis_filas AS (
    SELECT
      d.familia_key,
      d.familia,
      d.familia_codigo,
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
  -- Familias con cuota cargada solo a nivel familia (sin detalle de producto)
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
  ),
  equipo AS (
    SELECT
      COALESCE((SELECT SUM(cuota_monto) FROM cuotas_vendedor_familia
                WHERE anio = p_anio AND mes = p_mes), 0) AS cuota_total,
      COALESCE((
        SELECT SUM(ci.subtotal * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END)
        FROM comprobantes c
        JOIN pedidos pe ON pe.id = c.pedido_id
        JOIN comprobantes_items ci ON ci.comprobante_id = c.id
        JOIN productos pr ON pr.id = ci.producto_id
        CROSS JOIN rango r
        WHERE c.estado <> 'anulado'
          AND c.fecha_emision BETWEEN r.desde AND r.hasta
          AND pe.vendedor_id IS NOT NULL AND pr.familia_id IS NOT NULL
      ), 0) AS vendido_total
  )
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
    'mi_vendido_total', COALESCE((SELECT ROUND(SUM(vendido), 2) FROM todas), 0),
    'equipo_cuota_total',   (SELECT ROUND(cuota_total, 2) FROM equipo),
    'equipo_vendido_total', (SELECT ROUND(vendido_total, 2) FROM equipo)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION pwa_mis_cuotas TO authenticated;
