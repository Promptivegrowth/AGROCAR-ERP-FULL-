-- ─────────────────────────────────────────────────────────────────────────────
-- 037: Cobros — trazabilidad por factura + correlativo del recibo
--
-- Solicitudes del cliente:
-- 1) Cada pago debe mostrar a qué facturas se aplicó y por cuánto, para que
--    el cliente vea "Aplicado a F001-00000007 S/180.00, F001-00000008 S/200.00,
--    a cuenta S/50.00".
-- 2) El recibo interno de pago debe tener un número correlativo legible
--    (ej. R-202606-000001).
--
-- Diseño:
-- - Tabla cobros_aplicaciones: tabla N-a-N entre cobros y comprobantes con
--   el monto que cada cobro aplicó a cada comprobante (FIFO).
-- - Columna cobros.numero TEXT: correlativo R-YYYYMM-NNNNNN.
-- - Función aplicar_cobro_fifo(cobro_id): aplica el total del cobro a las
--   facturas/boletas del cliente más antiguas con saldo pendiente, llena
--   cobros_aplicaciones, y si sobra dinero lo marca como "a_cuenta".
-- - Backfill: ejecuta la función para cobros existentes que no tengan
--   aplicaciones y les asigna correlativo si no lo tienen.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Columna correlativo del recibo (numero R-YYYYMM-NNNNNN)
ALTER TABLE cobros
  ADD COLUMN IF NOT EXISTS numero TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cobros_numero ON cobros(numero) WHERE numero IS NOT NULL;

COMMENT ON COLUMN cobros.numero IS
  'Correlativo legible del recibo interno (R-YYYYMM-NNNNNN). Se asigna automáticamente al insertar o por trigger.';

-- 2) Tabla de aplicaciones (qué facturas paga este cobro)
CREATE TABLE IF NOT EXISTS cobros_aplicaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobro_id UUID NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
  comprobante_id UUID REFERENCES comprobantes(id) ON DELETE SET NULL,
  monto_aplicado NUMERIC(12,2) NOT NULL CHECK (monto_aplicado >= 0),
  es_a_cuenta BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobros_aplic_cobro ON cobros_aplicaciones(cobro_id);
CREATE INDEX IF NOT EXISTS idx_cobros_aplic_comp ON cobros_aplicaciones(comprobante_id);

ALTER TABLE cobros_aplicaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cobros_aplic_select ON cobros_aplicaciones;
CREATE POLICY cobros_aplic_select ON cobros_aplicaciones
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cobros_aplic_insert ON cobros_aplicaciones;
CREATE POLICY cobros_aplic_insert ON cobros_aplicaciones
  FOR INSERT TO authenticated WITH CHECK (true);

COMMENT ON TABLE cobros_aplicaciones IS
  'Detalle de a qué comprobantes (facturas/boletas) se aplicó cada cobro. Si el cobro excede la deuda, se crea una línea con es_a_cuenta=TRUE.';

-- 3) Función para generar el correlativo del recibo
CREATE OR REPLACE FUNCTION generar_correlativo_cobro()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_yyyymm TEXT;
  v_seq INT;
  v_numero TEXT;
BEGIN
  v_yyyymm := TO_CHAR(now() AT TIME ZONE 'America/Lima', 'YYYYMM');
  -- Buscar el último número del mes y sumar 1
  SELECT COALESCE(MAX(CAST(SPLIT_PART(numero, '-', 3) AS INT)), 0) + 1
    INTO v_seq
    FROM cobros
    WHERE numero LIKE 'R-' || v_yyyymm || '-%';
  v_numero := 'R-' || v_yyyymm || '-' || LPAD(v_seq::TEXT, 6, '0');
  RETURN v_numero;
END;
$$;

-- 4) Trigger BEFORE INSERT en cobros: si numero es null, generarlo
CREATE OR REPLACE FUNCTION trg_asignar_numero_cobro()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := generar_correlativo_cobro();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobros_numero ON cobros;
CREATE TRIGGER trg_cobros_numero
  BEFORE INSERT ON cobros
  FOR EACH ROW
  EXECUTE FUNCTION trg_asignar_numero_cobro();

-- 5) Función para aplicar el cobro a facturas pendientes vía FIFO
CREATE OR REPLACE FUNCTION aplicar_cobro_fifo(p_cobro_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cobro RECORD;
  v_comp RECORD;
  v_saldo_comp NUMERIC;
  v_restante NUMERIC;
  v_aplicar NUMERIC;
  v_resultado JSONB := '[]'::JSONB;
  v_aplicado_total NUMERIC := 0;
BEGIN
  SELECT id, cliente_id, total INTO v_cobro FROM cobros WHERE id = p_cobro_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobro % no existe', p_cobro_id; END IF;

  -- Limpiar aplicaciones previas de este cobro (idempotente)
  DELETE FROM cobros_aplicaciones WHERE cobro_id = p_cobro_id;

  v_restante := v_cobro.total;

  -- Si no hay cliente registrado (consumidor final), no se puede aplicar a facturas
  IF v_cobro.cliente_id IS NULL THEN
    INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
    VALUES (p_cobro_id, NULL, v_restante, TRUE);
    RETURN jsonb_build_object(
      'aplicaciones', '[]'::JSONB,
      'a_cuenta', v_restante,
      'total', v_cobro.total
    );
  END IF;

  -- Iterar comprobantes del cliente más antiguos primero, con saldo pendiente
  FOR v_comp IN
    SELECT c.id, c.serie, c.numero, c.total, c.fecha_emision,
      (c.total - COALESCE((
        SELECT SUM(ca.monto_aplicado) FROM cobros_aplicaciones ca
        WHERE ca.comprobante_id = c.id
      ), 0)) AS saldo
    FROM comprobantes c
    WHERE c.cliente_id = v_cobro.cliente_id
      AND c.estado <> 'anulado'
    ORDER BY c.fecha_emision ASC, c.created_at ASC
  LOOP
    EXIT WHEN v_restante <= 0;
    v_saldo_comp := v_comp.saldo;
    IF v_saldo_comp <= 0 THEN CONTINUE; END IF;

    v_aplicar := LEAST(v_restante, v_saldo_comp);

    INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
    VALUES (p_cobro_id, v_comp.id, v_aplicar, FALSE);

    v_resultado := v_resultado || jsonb_build_object(
      'comprobante_id', v_comp.id,
      'serie', v_comp.serie,
      'numero', v_comp.numero,
      'monto_aplicado', v_aplicar,
      'saldo_anterior', v_saldo_comp,
      'saldo_despues', v_saldo_comp - v_aplicar
    );

    v_aplicado_total := v_aplicado_total + v_aplicar;
    v_restante := v_restante - v_aplicar;
  END LOOP;

  -- Si sobra, registrar saldo a cuenta
  IF v_restante > 0 THEN
    INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
    VALUES (p_cobro_id, NULL, v_restante, TRUE);
  END IF;

  RETURN jsonb_build_object(
    'aplicaciones', v_resultado,
    'aplicado', v_aplicado_total,
    'a_cuenta', v_restante,
    'total', v_cobro.total
  );
END;
$$;

COMMENT ON FUNCTION aplicar_cobro_fifo IS
  'Aplica el monto del cobro a las facturas/boletas más antiguas del cliente con saldo pendiente (FIFO). Si sobra dinero, registra saldo a cuenta. Idempotente: limpia aplicaciones previas y vuelve a calcular.';

GRANT EXECUTE ON FUNCTION aplicar_cobro_fifo TO authenticated;

-- 6) Trigger AFTER INSERT en cobros: aplicar automáticamente FIFO
CREATE OR REPLACE FUNCTION trg_aplicar_cobro_auto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM aplicar_cobro_fifo(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobros_aplicar ON cobros;
CREATE TRIGGER trg_cobros_aplicar
  AFTER INSERT ON cobros
  FOR EACH ROW
  EXECUTE FUNCTION trg_aplicar_cobro_auto();

-- 7) Backfill: asignar correlativo a cobros existentes que no lo tengan
DO $$
DECLARE
  v_cobro RECORD;
  v_yyyymm TEXT;
  v_seq INT;
BEGIN
  -- Procesar cobros sin numero, ordenados por fecha de creación
  FOR v_cobro IN
    SELECT id, created_at FROM cobros WHERE numero IS NULL ORDER BY created_at ASC
  LOOP
    v_yyyymm := TO_CHAR(v_cobro.created_at AT TIME ZONE 'America/Lima', 'YYYYMM');
    SELECT COALESCE(MAX(CAST(SPLIT_PART(numero, '-', 3) AS INT)), 0) + 1
      INTO v_seq
      FROM cobros WHERE numero LIKE 'R-' || v_yyyymm || '-%';
    UPDATE cobros
      SET numero = 'R-' || v_yyyymm || '-' || LPAD(v_seq::TEXT, 6, '0')
      WHERE id = v_cobro.id;
  END LOOP;
END
$$;

-- 8) Backfill: aplicar FIFO a cobros que no tengan aplicaciones registradas
DO $$
DECLARE
  v_cobro RECORD;
BEGIN
  FOR v_cobro IN
    SELECT id FROM cobros
    WHERE NOT EXISTS (SELECT 1 FROM cobros_aplicaciones ca WHERE ca.cobro_id = cobros.id)
    ORDER BY created_at ASC
  LOOP
    PERFORM aplicar_cobro_fifo(v_cobro.id);
  END LOOP;
END
$$;
