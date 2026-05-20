-- Migración 024: Numeración correlativa configurable de comprobantes
--
-- Reemplaza el correlativo "fake" basado en timestamp (Date.now().slice(-8))
-- por una numeración real, atómica, configurable por el usuario al inicio.
--
-- Cada tipo de comprobante tiene UNA serie activa y un correlativo que se
-- incrementa automáticamente al emitir. El usuario puede configurar:
--   - Serie (ej. F001, B001)
--   - Correlativo inicial (útil al migrar desde otro sistema)
--   - Cantidad de dígitos del padding (8 = estándar SUNAT)

CREATE TABLE IF NOT EXISTS series_correlativos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo_comprobante    TEXT NOT NULL UNIQUE,
  serie               TEXT NOT NULL,
  correlativo_actual  INTEGER NOT NULL DEFAULT 0,
  padding_digitos     INTEGER NOT NULL DEFAULT 8,
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT series_tipo_valido CHECK (
    tipo_comprobante IN ('factura', 'boleta', 'nota_credito', 'nota_pedido_interna')
  ),
  CONSTRAINT series_padding_rango CHECK (padding_digitos BETWEEN 1 AND 10),
  CONSTRAINT series_correlativo_no_negativo CHECK (correlativo_actual >= 0)
);

COMMENT ON TABLE series_correlativos IS
  'Series y correlativos de comprobantes (SUNAT). Una sola serie activa por tipo. El correlativo se incrementa atómicamente con cada emisión via siguiente_correlativo().';
COMMENT ON COLUMN series_correlativos.correlativo_actual IS
  'Último número emitido. La próxima emisión será correlativo_actual + 1.';
COMMENT ON COLUMN series_correlativos.padding_digitos IS
  'Cantidad de dígitos del correlativo formateado (8 = estándar SUNAT, ej. 00000001).';

-- Trigger para updated_at
DROP TRIGGER IF EXISTS set_series_correlativos_updated_at ON series_correlativos;
CREATE TRIGGER set_series_correlativos_updated_at
  BEFORE UPDATE ON series_correlativos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed inicial: las series por defecto del sistema (correlativo en 0 = próxima será 1)
INSERT INTO series_correlativos (tipo_comprobante, serie, correlativo_actual, padding_digitos)
VALUES
  ('factura',              'F001', 0, 8),
  ('boleta',               'B001', 0, 8),
  ('nota_credito',         'FC01', 0, 8),
  ('nota_pedido_interna',  'T001', 0, 8)
ON CONFLICT (tipo_comprobante) DO NOTHING;

-- RLS: lectura para todos los logueados; escritura solo gerente/administrador
ALTER TABLE series_correlativos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "series_select_all" ON series_correlativos;
CREATE POLICY "series_select_all" ON series_correlativos
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "series_write_admin" ON series_correlativos;
CREATE POLICY "series_write_admin" ON series_correlativos
  FOR ALL USING (has_role(VARIADIC ARRAY['gerente', 'administrador']));

-- Función atómica para obtener el siguiente correlativo
-- Devuelve la serie y el número ya formateado con padding (ej. "00000123")
CREATE OR REPLACE FUNCTION siguiente_correlativo(p_tipo TEXT)
RETURNS TABLE (serie TEXT, numero TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_serie TEXT;
  v_correlativo INTEGER;
  v_padding INTEGER;
BEGIN
  -- Lock atómico: bloquea la fila para evitar correlativos duplicados en emisiones concurrentes
  UPDATE series_correlativos
     SET correlativo_actual = correlativo_actual + 1
   WHERE tipo_comprobante = p_tipo AND activo = TRUE
   RETURNING series_correlativos.serie, correlativo_actual, padding_digitos
     INTO v_serie, v_correlativo, v_padding;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay serie activa configurada para el tipo: %. Configúrala en Configuración → Numeración de Comprobantes.', p_tipo;
  END IF;

  RETURN QUERY SELECT v_serie, LPAD(v_correlativo::TEXT, v_padding, '0');
END;
$$;

COMMENT ON FUNCTION siguiente_correlativo(TEXT) IS
  'Devuelve atómicamente la serie y el próximo correlativo formateado para emitir un comprobante. Incrementa correlativo_actual de forma segura ante concurrencia.';
