-- ─────────────────────────────────────────────────────────────────────────────
-- 033: Número de operación para cobros con medios digitales
--
-- Cuando un cliente paga con Yape, Plin o Transferencia, el ERP debe registrar
-- el número de operación / código de la transacción bancaria para poder
-- conciliar después contra el extracto bancario.
--
-- Para efectivo NO aplica (queda NULL).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cobros
  ADD COLUMN IF NOT EXISTS nro_operacion TEXT;

COMMENT ON COLUMN cobros.nro_operacion IS
  'Código/nro de transacción reportado por el cliente para pagos Yape, Plin o Transferencia. Permite conciliación bancaria.';

CREATE INDEX IF NOT EXISTS idx_cobros_nro_operacion
  ON cobros (nro_operacion)
  WHERE nro_operacion IS NOT NULL;
