-- =============================================================================
-- Migración 017: agregar DNI a profiles
-- =============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dni TEXT;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_dni_unique;
ALTER TABLE profiles ADD CONSTRAINT profiles_dni_unique UNIQUE (dni);

COMMENT ON COLUMN profiles.dni IS
  'DNI del usuario (vendedor, repartidor, etc.). Opcional para roles administrativos.';
