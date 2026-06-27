-- ─────────────────────────────────────────────────────────────────────────────
-- 058: Agregar roles 'chofer' y 'caja' al enum user_role
--
-- - chofer: equivalente a repartidor (PWA solo), maneja el vehículo.
--   Se separa para distinguir quien maneja (chofer) de quien reparte mercadería
--   y cobra (repartidor). En algunos casos son la misma persona.
-- - caja: rol cajero-facturador. Acceso a Caja, Cobranzas y Facturación.
--   Pensado para personal de mostrador que cobra y emite comprobantes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'chofer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'caja';
