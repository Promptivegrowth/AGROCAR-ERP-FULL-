-- ─────────────────────────────────────────────────────────────────────────────
-- 092: días vencidos en v_cobranzas_status
--
-- Christopher, obs. 5: la columna de días transcurridos "se mantuvo inmóvil el
-- (-1) y (1)", y debe indicar "todos los días que ya han transcurrido desde que
-- se venció".
--
-- La vista solo traía `dias_transcurridos`, que cuenta desde la emisión. De ahí
-- salían los -1 de las facturas emitidas con fecha de mañana y los 1 de las de
-- anteayer: un número que no dice nada sobre la cobranza.
--
-- Se agrega `dias_vencido`, que cuenta desde el vencimiento y vale 0 mientras
-- la factura esté en plazo. Es el mismo cálculo que ya usa
-- cuentas_por_cobrar_consolidado, puesto en la vista para que el tablero, el
-- reporte y cualquier consulta futura cuenten los días igual.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_cobranzas_status AS
WITH aplicado AS (
  SELECT ca.comprobante_id, SUM(ca.monto_aplicado) AS cobrado
  FROM cobros_aplicaciones ca
  WHERE ca.comprobante_id IS NOT NULL
  GROUP BY ca.comprobante_id
),
base AS (
  SELECT
    c.id,
    c.tipo,
    c.serie,
    c.numero,
    c.fecha_emision,
    COALESCE(
      c.fecha_vencimiento,
      c.fecha_emision + (COALESCE(cli.credito_dias, 0) || ' days')::interval
    )::date AS vence,
    c.total,
    c.cliente_id,
    cli.razon_social AS cliente,
    cli.zona_id,
    COALESCE(cli.credito_dias, 0) AS dias_credito,
    COALESCE(ap.cobrado, 0) AS cobrado
  FROM comprobantes c
  JOIN clientes cli ON cli.id = c.cliente_id
  LEFT JOIN aplicado ap ON ap.comprobante_id = c.id
  WHERE c.estado <> 'anulado'::estado_comprobante
)
SELECT
  b.id AS comprobante_id,
  b.tipo,
  b.serie,
  b.numero,
  b.fecha_emision,
  b.vence AS fecha_vencimiento,
  b.total,
  b.cliente_id,
  b.cliente,
  b.zona_id,
  z.nombre AS zona_nombre,
  b.cobrado,
  GREATEST(b.total - b.cobrado, 0) AS saldo,
  b.dias_credito,
  CURRENT_DATE - b.fecha_emision AS dias_transcurridos,
  -- Días corridos desde el vencimiento; 0 mientras siga en plazo
  GREATEST(CURRENT_DATE - b.vence, 0) AS dias_vencido,
  CASE
    WHEN b.cobrado >= b.total - 0.009 THEN 'pago'
    WHEN b.vence < CURRENT_DATE THEN 'vencido'
    ELSE 'por_vencer'
  END AS status
FROM base b
LEFT JOIN zonas z ON z.id = b.zona_id;

COMMENT ON VIEW v_cobranzas_status IS
  'Estado de cobranza por comprobante. Lo cobrado sale de cobros_aplicaciones y los días vencidos se cuentan desde el vencimiento, igual que cuentas_por_cobrar_consolidado.';
