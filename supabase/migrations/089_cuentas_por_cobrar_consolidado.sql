-- ─────────────────────────────────────────────────────────────────────────────
-- 089: Cuentas por cobrar CONSOLIDADO de todos los vendedores
--
-- Daniel: "necesito de todos los vendedores, que agrupe todo de todos, para
-- saber cuánto tengo por cobrar", con selector de fecha y una versión simple
-- para imprimir en la menor cantidad de hojas posible.
--
-- Hasta ahora solo existía el reporte por vendedor, uno por uno.
--
-- El saldo sale de: total del comprobante − lo aplicado desde cobranzas.
-- Los días vencidos se cuentan desde la fecha de emisión más los días de
-- crédito del cliente.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cuentas_por_cobrar_consolidado(
  p_desde DATE DEFAULT NULL,
  p_hasta DATE DEFAULT NULL,
  p_vendedor_id UUID DEFAULT NULL
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;
  IF v_rol NOT IN ('administrador', 'gerente', 'contador', 'caja', 'facturador') THEN
    RAISE EXCEPTION 'Sin permiso para ver las cuentas por cobrar';
  END IF;

  WITH aplicado AS (
    SELECT ca.comprobante_id, SUM(ca.monto_aplicado) AS monto
    FROM cobros_aplicaciones ca
    WHERE ca.comprobante_id IS NOT NULL
    GROUP BY ca.comprobante_id
  ),
  docs AS (
    SELECT
      c.id,
      c.cliente_id,
      cl.razon_social AS cliente,
      COALESCE(cl.ruc, cl.dni, '—') AS documento,
      cl.telefono,
      COALESCE(cl.credito_dias, 0) AS credito_dias,
      cl.vendedor_id,
      c.serie || '-' || c.numero AS comprobante,
      c.fecha_emision,
      c.total,
      COALESCE(a.monto, 0) AS abonado,
      c.total - COALESCE(a.monto, 0) AS saldo,
      -- Días vencidos: 0 mientras esté dentro del plazo de crédito
      GREATEST(0, (CURRENT_DATE - (c.fecha_emision + COALESCE(cl.credito_dias, 0)))) AS dias_vencido
    FROM comprobantes c
    JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN aplicado a ON a.comprobante_id = c.id
    WHERE c.estado <> 'anulado'
      AND c.tipo::text <> 'nota_credito'
      AND (p_desde IS NULL OR c.fecha_emision >= p_desde)
      AND (p_hasta IS NULL OR c.fecha_emision <= p_hasta)
      AND (p_vendedor_id IS NULL OR cl.vendedor_id = p_vendedor_id)
      AND c.total - COALESCE(a.monto, 0) > 0.009
  ),
  por_cliente AS (
    SELECT
      cliente_id, cliente, documento, telefono, vendedor_id,
      COUNT(*) AS documentos,
      SUM(total) AS facturado,
      SUM(abonado) AS abonado,
      SUM(saldo) AS saldo,
      SUM(saldo) FILTER (WHERE dias_vencido > 0) AS vencido,
      MAX(dias_vencido) AS max_dias
    FROM docs
    GROUP BY cliente_id, cliente, documento, telefono, vendedor_id
  ),
  por_vendedor AS (
    SELECT
      COALESCE(pc.vendedor_id::text, 'sin-vendedor') AS vendedor_key,
      COALESCE(pr.full_name, pr.email, 'SIN VENDEDOR ASIGNADO') AS vendedor,
      COUNT(*) AS clientes,
      SUM(pc.saldo) AS saldo,
      SUM(pc.vencido) AS vencido,
      jsonb_agg(jsonb_build_object(
        'cliente', pc.cliente,
        'documento', pc.documento,
        'telefono', pc.telefono,
        'documentos', pc.documentos,
        'facturado', ROUND(pc.facturado, 2),
        'abonado', ROUND(pc.abonado, 2),
        'saldo', ROUND(pc.saldo, 2),
        'vencido', ROUND(COALESCE(pc.vencido, 0), 2),
        'max_dias', pc.max_dias
      ) ORDER BY pc.saldo DESC) AS detalle
    FROM por_cliente pc
    LEFT JOIN profiles pr ON pr.id = pc.vendedor_id
    GROUP BY pc.vendedor_id, pr.full_name, pr.email
  )
  SELECT jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'generado_at', NOW(),
    'vendedores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', vendedor_key, 'vendedor', vendedor,
        'clientes', clientes,
        'saldo', ROUND(saldo, 2),
        'vencido', ROUND(COALESCE(vencido, 0), 2),
        'detalle', detalle
      ) ORDER BY saldo DESC) FROM por_vendedor
    ), '[]'::jsonb),
    'totales', jsonb_build_object(
      'clientes',   (SELECT COUNT(*) FROM por_cliente),
      'documentos', (SELECT COUNT(*) FROM docs),
      'facturado',  (SELECT COALESCE(ROUND(SUM(total), 2), 0) FROM docs),
      'abonado',    (SELECT COALESCE(ROUND(SUM(abonado), 2), 0) FROM docs),
      'saldo',      (SELECT COALESCE(ROUND(SUM(saldo), 2), 0) FROM docs),
      'vencido',    (SELECT COALESCE(ROUND(SUM(saldo), 2), 0) FROM docs WHERE dias_vencido > 0)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION cuentas_por_cobrar_consolidado TO authenticated;
