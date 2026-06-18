-- ─────────────────────────────────────────────────────────────────────────────
-- 046: UNIQUE en caja_movimientos.cobro_id — antidoble cobro
--
-- Daniel pidió asegurar que el flujo de cobros huérfanos + migración no
-- genere movimientos duplicados de un mismo cobro (lo que infló los
-- ingresos en el reporte). Aunque la RPC abrir_caja_con_huerfanos usa
-- WHERE NOT EXISTS para no duplicar, agregamos defensa en profundidad:
-- un índice UNIQUE parcial sobre caja_movimientos.cobro_id (excluyendo
-- los egresos manuales donde cobro_id es NULL).
--
-- Si en el futuro alguien intenta crear dos movimientos para el mismo
-- cobro, Postgres lanzará error antes de comprometer la transacción.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_caja_mov_cobro
  ON caja_movimientos (cobro_id)
  WHERE cobro_id IS NOT NULL;

COMMENT ON INDEX uniq_caja_mov_cobro IS
  'Garantiza que cada cobro tenga máximo un movimiento de caja asociado. Evita doble contabilización al migrar huérfanos.';
