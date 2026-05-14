-- Migración 021: Soporte para proveedores extranjeros (importadores)
-- Permite registrar proveedores de Chile, Argentina u otros países
-- cuyo identificador fiscal (RUT, CUIT, etc.) no cumple con el formato RUC peruano.

ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS pais TEXT NOT NULL DEFAULT 'PE';

COMMENT ON COLUMN proveedores.pais IS
  'Código país ISO 3166-1 alpha-2: PE=Perú, CL=Chile, AR=Argentina, OT=Otro. Determina el formato esperado del campo ruc (RUC/RUT/CUIT/ID fiscal libre).';

-- Reemplazar UNIQUE(ruc) por UNIQUE(ruc, pais) para evitar colisiones
-- entre identificadores numéricamente iguales pero de jurisdicciones distintas.
ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_ruc_unique;

ALTER TABLE proveedores
  ADD CONSTRAINT proveedores_ruc_pais_unique UNIQUE (ruc, pais);
