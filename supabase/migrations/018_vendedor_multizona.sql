-- =============================================================================
-- Migración 018: Vendedor con múltiples zonas (M:N)
-- -----------------------------------------------------------------------------
-- Mantiene profiles.zona_id como "zona principal" para no romper código existente,
-- y agrega profile_zonas para zonas adicionales.
-- =============================================================================

CREATE TABLE IF NOT EXISTS profile_zonas (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  zona_id    UUID NOT NULL REFERENCES zonas(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, zona_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_zonas_profile ON profile_zonas(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_zonas_zona    ON profile_zonas(zona_id);

ALTER TABLE profile_zonas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_zonas_select_all" ON profile_zonas;
CREATE POLICY "profile_zonas_select_all" ON profile_zonas
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "profile_zonas_write_admin" ON profile_zonas;
CREATE POLICY "profile_zonas_write_admin" ON profile_zonas
  FOR ALL USING (has_role('gerente', 'administrador'));

-- Backfill: copiar zona_id existente a la tabla M:N
INSERT INTO profile_zonas (profile_id, zona_id)
SELECT id, zona_id
FROM profiles
WHERE zona_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Vista helper: zonas asignadas concatenadas (para queries rápidas)
CREATE OR REPLACE VIEW v_profile_zonas_resumen AS
SELECT
  p.id AS profile_id,
  p.full_name,
  p.role,
  COUNT(pz.zona_id) AS total_zonas,
  COALESCE(STRING_AGG(z.nombre, ', ' ORDER BY z.nombre), '') AS zonas_nombres,
  ARRAY_AGG(pz.zona_id) FILTER (WHERE pz.zona_id IS NOT NULL) AS zonas_ids
FROM profiles p
LEFT JOIN profile_zonas pz ON pz.profile_id = p.id
LEFT JOIN zonas z ON z.id = pz.zona_id
GROUP BY p.id;

COMMENT ON VIEW v_profile_zonas_resumen IS
  'Resumen de zonas asignadas por usuario (vendedores/repartidores con múltiples zonas).';
