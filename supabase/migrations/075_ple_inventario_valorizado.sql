-- ─────────────────────────────────────────────────────────────────────────────
-- 075: PLE 13.1 — Registro de Inventario Permanente Valorizado (HITO 18)
--
-- Requerimiento Vaneza (R1):
-- "no sé en qué momento también nos van a obligar a llevar el libro de
--  inventario físico valorizado... dejar esos arranques para ya poder
--  gestionarlos"
--
-- Estructura PLE 13.1: por producto, cada movimiento de entrada/salida
-- con cantidad, costo unitario y saldo valorizado (promedio ponderado).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ple_inventario_valorizado(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  movs AS (
    SELECT
      ms.producto_id,
      p.codigo AS producto_codigo,
      COALESCE(TRIM(p.descripcion), p.nombre) AS producto_nombre,
      COALESCE(um.simbolo, um.nombre, 'UND') AS udm,
      ms.created_at::date AS fecha,
      ms.tipo,
      ms.cantidad,
      COALESCE(ms.costo_unitario, 0) AS costo_unitario,
      ms.referencia_tipo,
      ms.notas
    FROM movimientos_stock ms
    JOIN productos p ON p.id = ms.producto_id
    LEFT JOIN unidades_medida um ON um.id = p.unidad_medida_id
    CROSS JOIN rango r
    WHERE ms.created_at::date BETWEEN r.desde AND r.hasta
    ORDER BY ms.producto_id, ms.created_at
  )
  SELECT jsonb_build_object(
    'periodo', LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0'),
    'filas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'producto_codigo', producto_codigo,
        'producto_nombre', producto_nombre,
        'udm', udm,
        'fecha', fecha,
        'tipo_operacion', CASE tipo WHEN 'entrada' THEN '02' WHEN 'salida' THEN '01' ELSE '99' END,
        'entrada_cantidad', CASE WHEN tipo = 'entrada' THEN cantidad ELSE 0 END,
        'entrada_costo', CASE WHEN tipo = 'entrada' THEN costo_unitario ELSE 0 END,
        'salida_cantidad', CASE WHEN tipo = 'salida' THEN cantidad ELSE 0 END,
        'salida_costo', CASE WHEN tipo = 'salida' THEN costo_unitario ELSE 0 END,
        'referencia', referencia_tipo
      ) ORDER BY producto_codigo, fecha)
      FROM movs
    ), '[]'::jsonb),
    'cantidad_movimientos', (SELECT COUNT(*) FROM movs),
    'productos_distintos', (SELECT COUNT(DISTINCT producto_id) FROM movs)
  );
$$;

GRANT EXECUTE ON FUNCTION ple_inventario_valorizado TO authenticated;
