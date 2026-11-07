-- Alcance de objetivos y cumplimiento de cuotas por rango de fechas, con la
-- venta directa de los repartidores aparte ("venta adicional").
--
-- Daniel, 06/11/2026: "incluir en los reportes la venta directa de los
-- repartidores para poder diferenciar cuánto es la venta adicional mensual o
-- por fecha desde hasta"; alcance de objetivos y cumplimiento de cuotas, con
-- desde-hasta.
--
-- Venta adicional = comprobantes de pedidos cuyo vendedor es un repartidor
-- (las ventas directas en ruta). Los repartidores no tienen cuota: su venta
-- se muestra aparte y no entra al % de cumplimiento de los vendedores.
--
-- La cuota de un rango es la cuota COMPLETA de cada mes que el rango toca,
-- como ya hacía alcance_objetivos_rango (Daniel, 15/10).

-- ── Alcance por rango: grupo (vendedores / repartidores) y catálogo completo ──
DROP FUNCTION IF EXISTS public.alcance_objetivos_rango(date, date, uuid, uuid);
CREATE OR REPLACE FUNCTION public.alcance_objetivos_rango(
  p_desde date, p_hasta date, p_vendedor_id uuid DEFAULT NULL, p_familia_id uuid DEFAULT NULL,
  p_solo_con_datos boolean DEFAULT true, p_grupo text DEFAULT NULL)
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
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;
  IF p_grupo IS NOT NULL AND p_grupo NOT IN ('vendedores', 'repartidores') THEN RAISE EXCEPTION 'Grupo inválido'; END IF;

  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;
  -- Los mismos roles que entran al dashboard; cada uno puede ver lo suyo.
  IF COALESCE(v_rol, '') NOT IN ('administrador','gerente','contador','caja','facturador','almacenero')
     AND p_vendedor_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Sin permiso para ver el alcance de objetivos';
  END IF;

  IF p_vendedor_id IS NOT NULL THEN
    SELECT COALESCE(full_name, email) INTO v_vendedor FROM profiles WHERE id = p_vendedor_id;
  ELSE
    v_vendedor := CASE p_grupo WHEN 'vendedores' THEN 'SOLO VENDEDORES'
                               WHEN 'repartidores' THEN 'REPARTIDORES (VENTA ADICIONAL)'
                               ELSE 'TODOS (VENDEDORES Y REPARTIDORES)' END;
  END IF;

  WITH ventas AS (
    SELECT
      ci.producto_id,
      SUM(ci.cantidad * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS cant_real,
      SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id) * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END) AS valor_real
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    LEFT JOIN profiles vp ON vp.id = pe.vendedor_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN p_desde AND p_hasta
      AND ci.producto_id IS NOT NULL
      AND (p_vendedor_id IS NULL OR pe.vendedor_id = p_vendedor_id)
      AND (p_grupo IS NULL
        OR (p_grupo = 'vendedores' AND vp.role::text = 'vendedor')
        OR (p_grupo = 'repartidores' AND vp.role::text = 'repartidor'))
    GROUP BY ci.producto_id
  ),
  cuotas AS (
    SELECT cp.producto_id, SUM(cp.cuota_cantidad) AS cant_cuota, SUM(cp.cuota_valor) AS valor_cuota
    FROM cuotas_vendedor_producto cp
    LEFT JOIN profiles vp ON vp.id = cp.vendedor_id
    WHERE make_date(cp.anio, cp.mes, 1) <= p_hasta
      AND (make_date(cp.anio, cp.mes, 1) + INTERVAL '1 month - 1 day')::date >= p_desde
      AND (p_vendedor_id IS NULL OR cp.vendedor_id = p_vendedor_id)
      AND (p_grupo IS NULL
        OR (p_grupo = 'vendedores' AND vp.role::text = 'vendedor')
        OR (p_grupo = 'repartidores' AND vp.role::text = 'repartidor'))
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
      AND (NOT COALESCE(p_solo_con_datos, true)
        OR COALESCE(q.cant_cuota, 0) <> 0 OR COALESCE(q.valor_cuota, 0) <> 0
        OR COALESCE(v.cant_real, 0) <> 0 OR COALESCE(v.valor_real, 0) <> 0)
  ),
  lineas AS (
    SELECT
      linea_key, linea_codigo, linea_nombre,
      SUM(cant_real) AS tot_cant_real, SUM(cant_cuota) AS tot_cant_cuota,
      SUM(valor_real) AS tot_valor_real, SUM(valor_cuota) AS tot_valor_cuota,
      jsonb_agg(jsonb_build_object(
        'codigo', codigo, 'descripcion', descripcion,
        'cant_real', ROUND(cant_real, 2), 'cant_cuota', ROUND(cant_cuota, 2),
        'alc_cant', CASE WHEN cant_cuota > 0 THEN ROUND(cant_real / cant_cuota * 100, 2) ELSE NULL END,
        'valor_real', ROUND(valor_real, 2), 'valor_cuota', ROUND(valor_cuota, 2),
        'alc_valor', CASE WHEN valor_cuota > 0 THEN ROUND(valor_real / valor_cuota * 100, 2) ELSE NULL END
      ) ORDER BY descripcion) AS productos
    FROM filas
    GROUP BY linea_key, linea_codigo, linea_nombre
  )
  SELECT jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'periodo', TO_CHAR(p_desde, 'DD/MM/YYYY') || ' al ' || TO_CHAR(p_hasta, 'DD/MM/YYYY'),
    'vendedor_id', p_vendedor_id,
    'grupo', p_grupo,
    'vendedor_nombre', COALESCE(v_vendedor, '—'),
    'lineas', COALESCE(jsonb_agg(jsonb_build_object(
      'codigo', linea_codigo, 'nombre', linea_nombre, 'productos', productos,
      'tot_cant_real', ROUND(tot_cant_real, 2), 'tot_cant_cuota', ROUND(tot_cant_cuota, 2),
      'tot_valor_real', ROUND(tot_valor_real, 2), 'tot_valor_cuota', ROUND(tot_valor_cuota, 2),
      'alc_cant', CASE WHEN tot_cant_cuota > 0 THEN ROUND(tot_cant_real / tot_cant_cuota * 100, 2) ELSE NULL END,
      'alc_valor', CASE WHEN tot_valor_cuota > 0 THEN ROUND(tot_valor_real / tot_valor_cuota * 100, 2) ELSE NULL END
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
GRANT EXECUTE ON FUNCTION public.alcance_objetivos_rango(date, date, uuid, uuid, boolean, text) TO authenticated;

-- ── Cumplimiento de cuotas por rango, con los repartidores aparte ──────────
CREATE OR REPLACE FUNCTION public.cumplimiento_cuotas_rango(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT; v_result JSONB;
BEGIN
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid() AND activo;
  IF COALESCE(v_rol, '') NOT IN ('administrador','gerente','contador','caja','facturador','almacenero') THEN
    RAISE EXCEPTION 'Sin permiso para ver el cumplimiento de cuotas';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;

  WITH ventas AS (
    -- Venta con IGV (lo impreso) por vendedor del pedido y familia; las notas de crédito restan.
    SELECT pe.vendedor_id, p.familia_id,
      COALESCE(SUM(public.monto_linea_venta(ci.subtotal, ci.comprobante_id)
        * CASE WHEN c.tipo::text = 'nota_credito' THEN -1 ELSE 1 END), 0) AS vendido_monto,
      COUNT(DISTINCT c.id) AS comprobantes
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    JOIN comprobantes_items ci ON ci.comprobante_id = c.id
    JOIN productos p ON p.id = ci.producto_id
    WHERE c.estado <> 'anulado'
      AND c.fecha_emision BETWEEN p_desde AND p_hasta
      AND pe.vendedor_id IS NOT NULL
      AND p.familia_id IS NOT NULL
    GROUP BY pe.vendedor_id, p.familia_id
  ),
  cuotas AS (
    SELECT vendedor_id, familia_id, SUM(cuota_monto) AS cuota_monto
      FROM cuotas_vendedor_familia
     WHERE make_date(anio, mes, 1) <= p_hasta
       AND (make_date(anio, mes, 1) + INTERVAL '1 month - 1 day')::date >= p_desde
     GROUP BY vendedor_id, familia_id
  ),
  personas AS (
    -- Vendedores activos, y repartidores activos o que vendieron en el rango.
    SELECT v.id, COALESCE(v.full_name, v.email) AS nombre, v.role::text AS rol
      FROM profiles v
     WHERE (v.role::text = 'vendedor' AND COALESCE(v.activo, TRUE))
        OR (v.role::text = 'repartidor' AND (COALESCE(v.activo, TRUE) OR EXISTS (SELECT 1 FROM ventas x WHERE x.vendedor_id = v.id)))
  ),
  matriz AS (
    SELECT pz.id AS vendedor_id, pz.nombre AS vendedor_nombre, pz.rol,
           f.id AS familia_id, f.nombre AS familia_nombre,
           COALESCE(cu.cuota_monto, 0) AS cuota_monto,
           COALESCE(ve.vendido_monto, 0) AS vendido_monto,
           COALESCE(ve.comprobantes, 0) AS comprobantes
      FROM personas pz
      CROSS JOIN familias f
      LEFT JOIN cuotas cu ON cu.vendedor_id = pz.id AND cu.familia_id = f.id
      LEFT JOIN ventas ve ON ve.vendedor_id = pz.id AND ve.familia_id = f.id
  )
  SELECT jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'filas', COALESCE(jsonb_agg(jsonb_build_object(
      'vendedor_id', vendedor_id, 'vendedor_nombre', vendedor_nombre, 'rol', rol,
      'familia_id', familia_id, 'familia_nombre', familia_nombre,
      'cuota_monto', ROUND(cuota_monto, 2), 'vendido_monto', ROUND(vendido_monto, 2),
      'comprobantes', comprobantes,
      'pct_cumplimiento', CASE WHEN cuota_monto > 0 THEN ROUND((vendido_monto / cuota_monto) * 100, 1) ELSE NULL END,
      'diferencia', ROUND(vendido_monto - cuota_monto, 2)
    ) ORDER BY rol DESC, vendedor_nombre, familia_nombre), '[]'::jsonb)
  ) INTO v_result FROM matriz;
  RETURN v_result;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.cumplimiento_cuotas_rango(date, date) TO authenticated;
