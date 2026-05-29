-- ─────────────────────────────────────────────────────────────────────────────
-- 032: Plantillas recurrentes de despacho
--
-- Cada vehículo puede tener N zonas habituales por día. Cuando un operador
-- abre Despacho, los pedidos cuya zona coincida con la plantilla del día
-- actual se pre-asignan automáticamente al vehículo correspondiente.
--
-- Esto reduce el "no conozco las direcciones" porque el sistema sabe que
-- el camión Z7K-755 SIEMPRE atiende Alto de la Alianza los lunes y miércoles.
--
-- Días de la semana: 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom'
-- (mismo formato que zonas.dias_visita en migración 028)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehiculos_zonas_habituales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  zona_id UUID NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
  dias_semana TEXT[] NOT NULL DEFAULT '{}',
  prioridad INTEGER NOT NULL DEFAULT 1,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehiculo_id, zona_id)
);

CREATE INDEX IF NOT EXISTS idx_vzh_vehiculo ON vehiculos_zonas_habituales(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_vzh_zona ON vehiculos_zonas_habituales(zona_id);
CREATE INDEX IF NOT EXISTS idx_vzh_dias ON vehiculos_zonas_habituales USING GIN (dias_semana);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION touch_vehiculos_zonas_habituales()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vzh_updated_at ON vehiculos_zonas_habituales;
CREATE TRIGGER trg_vzh_updated_at
BEFORE UPDATE ON vehiculos_zonas_habituales
FOR EACH ROW EXECUTE FUNCTION touch_vehiculos_zonas_habituales();

-- RLS
ALTER TABLE vehiculos_zonas_habituales ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier rol autenticado (cajero, vendedor, repartidor, admin)
DROP POLICY IF EXISTS vzh_select ON vehiculos_zonas_habituales;
CREATE POLICY vzh_select ON vehiculos_zonas_habituales
  FOR SELECT TO authenticated USING (true);

-- Escritura: solo admin (la planilla la configura el administrador, no el operador)
DROP POLICY IF EXISTS vzh_write ON vehiculos_zonas_habituales;
CREATE POLICY vzh_write ON vehiculos_zonas_habituales
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('administrador', 'gerente'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('administrador', 'gerente'))
  );
