-- ─────────────────────────────────────────────────────────────────────────────
-- 045: Fix enum categoria_caja_movimiento — falta valor cobro_retroactivo
--
-- La migración 044 intentó usar 'cobro_retroactivo' como categoría al
-- migrar cobros huérfanos, pero el enum no lo tenía registrado. Resultado:
-- "invalid input value for enum categoria_caja_movimiento: cobro_retroactivo".
--
-- Agregamos el valor al enum existente.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE categoria_caja_movimiento ADD VALUE IF NOT EXISTS 'cobro_retroactivo';
