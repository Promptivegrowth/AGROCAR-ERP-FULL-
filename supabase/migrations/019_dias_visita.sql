-- =============================================================================
-- Migración 019: Días de visita programados al cliente
-- =============================================================================

-- Array de días de visita: 'lun','mar','mie','jue','vie','sab','dom'
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dias_visita TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE solicitudes_cliente ADD COLUMN IF NOT EXISTS dias_visita TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN clientes.dias_visita IS
  'Días de la semana programados para visitar al cliente. Valores válidos: lun, mar, mie, jue, vie, sab, dom.';

-- CHECK: solo días válidos
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_dias_visita_validos;
ALTER TABLE clientes ADD CONSTRAINT clientes_dias_visita_validos CHECK (
  dias_visita <@ ARRAY['lun','mar','mie','jue','vie','sab','dom']::TEXT[]
);

ALTER TABLE solicitudes_cliente DROP CONSTRAINT IF EXISTS solicitudes_cliente_dias_visita_validos;
ALTER TABLE solicitudes_cliente ADD CONSTRAINT solicitudes_cliente_dias_visita_validos CHECK (
  dias_visita <@ ARRAY['lun','mar','mie','jue','vie','sab','dom']::TEXT[]
);

-- Índice GIN para búsquedas rápidas tipo "WHERE 'lun' = ANY(dias_visita)"
CREATE INDEX IF NOT EXISTS idx_clientes_dias_visita ON clientes USING GIN (dias_visita);
