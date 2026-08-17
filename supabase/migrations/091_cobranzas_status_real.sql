-- ─────────────────────────────────────────────────────────────────────────────
-- 091: v_cobranzas_status no veía ningún pago
--
-- El tablero de Cobranzas mostraba S/ 0.00 cobrado, 0% de cobranza y las 427
-- facturas como "por vencer", cuando en la base hay 222 comprobantes con pagos
-- por S/ 45,473.34.
--
-- Dos motivos, los dos en el LEFT JOIN que calculaba lo cobrado:
--
--   1. Sumaba de `cobros` filtrando `tipo = 'venta'`, y no existe un solo cobro
--      con ese tipo: los 193 cobros registrados son de tipo 'cobranza'.
--   2. Cruzaba por `cobros.referencia_id`, que solo tiene 4 valores y ninguno
--      apunta a un comprobante.
--
-- Los pagos se aplican a los comprobantes por `cobros_aplicaciones`, que es de
-- donde ya leen el reporte de cuentas por cobrar y la rendición. Esta vista se
-- alinea a esa misma fuente para que el sistema no tenga dos verdades sobre
-- cuánto se ha cobrado.
--
-- Se corrige también el vencimiento. Antes exigía `credito_dias > 0`, y como
-- los 379 clientes están registrados al contado, ninguna factura podía figurar
-- vencida jamás: el estado "vencido" y su filtro eran decorativos. El criterio
-- pasa a ser el mismo que ya usa cuentas_por_cobrar_consolidado (migración
-- 089): vence a los `credito_dias` de la emisión, y al contado vence ese mismo
-- día. Se respeta la fecha_vencimiento del comprobante cuando viene cargada.
--
-- El saldo no baja de cero: hay dos comprobantes con sobrepago (S/ 518.20 en
-- exceso) que restaban del total pendiente de toda la cartera.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_cobranzas_status AS
WITH aplicado AS (
  SELECT ca.comprobante_id, SUM(ca.monto_aplicado) AS cobrado
  FROM cobros_aplicaciones ca
  WHERE ca.comprobante_id IS NOT NULL
  GROUP BY ca.comprobante_id
)
SELECT
  c.id AS comprobante_id,
  c.tipo,
  c.serie,
  c.numero,
  c.fecha_emision,
  -- Si el comprobante no trae vencimiento, se deduce del crédito del cliente
  COALESCE(
    c.fecha_vencimiento,
    c.fecha_emision + (COALESCE(cli.credito_dias, 0) || ' days')::interval
  )::date AS fecha_vencimiento,
  c.total,
  c.cliente_id,
  cli.razon_social AS cliente,
  cli.zona_id,
  z.nombre AS zona_nombre,
  COALESCE(ap.cobrado, 0) AS cobrado,
  GREATEST(c.total - COALESCE(ap.cobrado, 0), 0) AS saldo,
  COALESCE(cli.credito_dias, 0) AS dias_credito,
  CURRENT_DATE - c.fecha_emision AS dias_transcurridos,
  CASE
    WHEN COALESCE(ap.cobrado, 0) >= c.total - 0.009 THEN 'pago'
    WHEN COALESCE(
           c.fecha_vencimiento,
           c.fecha_emision + (COALESCE(cli.credito_dias, 0) || ' days')::interval
         )::date < CURRENT_DATE THEN 'vencido'
    ELSE 'por_vencer'
  END AS status
FROM comprobantes c
JOIN clientes cli ON cli.id = c.cliente_id
LEFT JOIN zonas z ON z.id = cli.zona_id
LEFT JOIN aplicado ap ON ap.comprobante_id = c.id
WHERE c.estado <> 'anulado'::estado_comprobante;

COMMENT ON VIEW v_cobranzas_status IS
  'Estado de cobranza por comprobante. Lo cobrado sale de cobros_aplicaciones, la misma fuente que cuentas_por_cobrar_consolidado y la rendición.';
