-- =============================================================================
-- Migración 010: Eliminar `codigo`, agregar `tipo_comprobante_preferido`
-- -----------------------------------------------------------------------------
-- Cambios:
-- 1. Nuevo campo `tipo_comprobante_preferido` en clientes (factura|boleta|nota_pedido_interna)
-- 2. CHECK: factura solo si el cliente tiene RUC (norma SUNAT)
-- 3. CHECK: cliente debe tener RUC o DNI (al menos uno)
-- 4. UNIQUE en DNI (además del UNIQUE existente en RUC)
-- 5. Trigger auto-asignación del tipo_comprobante_preferido según presencia de RUC
-- 6. Backfill de datos existentes
-- 7. Eliminar constraint y columna `codigo`
--
-- Regla SUNAT 2026 (verificada contra orientacion.sunat.gob.pe/02-factura):
--   - Cliente con RUC (cualquier prefijo: 10/15/17/20) → puede recibir factura
--   - Cliente solo con DNI → solo boleta (factura no permitida por ley)
-- =============================================================================

-- 1. Agregar columna `tipo_comprobante_preferido`
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS tipo_comprobante_preferido tipo_comprobante NOT NULL DEFAULT 'boleta';

COMMENT ON COLUMN clientes.tipo_comprobante_preferido IS
  'Tipo de comprobante preseleccionado al emitir. factura solo permitida si el cliente tiene RUC.';

-- 2. Backfill: aplicar regla a clientes existentes ANTES de imponer constraints
UPDATE clientes
SET tipo_comprobante_preferido = CASE
  WHEN ruc IS NOT NULL AND ruc <> '' THEN 'factura'::tipo_comprobante
  ELSE 'boleta'::tipo_comprobante
END;

-- 3. CHECK: factura requiere RUC (regla SUNAT)
ALTER TABLE clientes
  DROP CONSTRAINT IF EXISTS clientes_factura_requiere_ruc;
ALTER TABLE clientes
  ADD CONSTRAINT clientes_factura_requiere_ruc
  CHECK (tipo_comprobante_preferido <> 'factura' OR (ruc IS NOT NULL AND ruc <> ''));

-- 4. CHECK: al menos RUC o DNI debe estar presente
-- (Antes de aplicar, asegurar que clientes existentes cumplen)
UPDATE clientes
SET dni = 'SIN-DOC-' || SUBSTRING(id::TEXT, 1, 8)
WHERE (ruc IS NULL OR ruc = '') AND (dni IS NULL OR dni = '');

ALTER TABLE clientes
  DROP CONSTRAINT IF EXISTS clientes_doc_requerido;
ALTER TABLE clientes
  ADD CONSTRAINT clientes_doc_requerido
  CHECK (
    (ruc IS NOT NULL AND ruc <> '')
    OR (dni IS NOT NULL AND dni <> '')
  );

-- 5. UNIQUE en DNI (permite NULL para clientes con solo RUC)
-- Normalizar DNIs vacíos a NULL primero
UPDATE clientes SET dni = NULL WHERE dni = '';

ALTER TABLE clientes
  DROP CONSTRAINT IF EXISTS clientes_dni_unique;
ALTER TABLE clientes
  ADD CONSTRAINT clientes_dni_unique UNIQUE (dni);

-- 6. Trigger: autoasignar tipo_comprobante_preferido en INSERT si no viene dado
CREATE OR REPLACE FUNCTION asignar_tipo_comprobante_preferido()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo auto-asignar si viene el default (o no se especificó explícitamente)
  -- En UPDATE respeta el valor explícito del usuario.
  IF TG_OP = 'INSERT' THEN
    -- Si hay RUC y el tipo es el default 'boleta', preferir factura.
    IF NEW.ruc IS NOT NULL AND NEW.ruc <> '' AND NEW.tipo_comprobante_preferido = 'boleta' THEN
      NEW.tipo_comprobante_preferido := 'factura';
    END IF;
    -- Si solo tiene DNI y por error viene factura, forzar boleta (seguridad)
    IF (NEW.ruc IS NULL OR NEW.ruc = '') AND NEW.tipo_comprobante_preferido = 'factura' THEN
      NEW.tipo_comprobante_preferido := 'boleta';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_tipo_comprobante ON clientes;
CREATE TRIGGER trg_asignar_tipo_comprobante
  BEFORE INSERT ON clientes
  FOR EACH ROW
  EXECUTE FUNCTION asignar_tipo_comprobante_preferido();

-- 7. Eliminar columna `codigo` y su constraint
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_codigo_unique;
ALTER TABLE clientes DROP COLUMN IF EXISTS codigo;

-- 8. Índice útil para búsquedas por documento
CREATE INDEX IF NOT EXISTS idx_clientes_ruc ON clientes(ruc) WHERE ruc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_dni ON clientes(dni) WHERE dni IS NOT NULL;
