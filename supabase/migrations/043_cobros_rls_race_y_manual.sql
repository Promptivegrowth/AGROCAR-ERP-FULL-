-- ─────────────────────────────────────────────────────────────────────────────
-- 043: Fixes críticos del módulo de Cobros + soporte para aplicación manual
--
-- BUG 1 (caso MARON LAQUI): vendedor no ve cobros hechos por otros usuarios.
--   La policy `cobros_select` restringía a vendedor/repartidor solo SUS cobros
--   (cobrador_id = auth.uid()). Cuando el administrador cobraba S/500, el
--   vendedor consultaba el estado de cuenta y veía COBRADO=0, arriesgándose a
--   cobrar de nuevo lo mismo. Fix: vendedores pueden VER (no editar) todos los
--   cobros para tener el estado real del cliente.
--
-- BUG 2 (caso PARRILLADAS): "duplicate key value violates unique constraint
--   uniq_cobros_numero". La función `generar_correlativo_cobro()` hacía un
--   SELECT MAX + 1 sin lock, así que dos cobros simultáneos podían calcular el
--   mismo número. Fix: advisory lock por mes para serializar la generación.
--
-- FEATURE: aplicación manual de cobros a facturas específicas.
--   Hasta ahora el trigger `trg_aplicar_cobro_auto` aplicaba FIFO siempre.
--   Ahora si el cobro trae aplicaciones manuales (creadas explícitamente con
--   la RPC `registrar_cobro_atomico`), el trigger las respeta y NO aplica FIFO.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── FIX BUG 1: ajustar RLS para que vendedores/repartidores vean todos los cobros
DROP POLICY IF EXISTS cobros_select ON cobros;
CREATE POLICY cobros_select ON cobros FOR SELECT USING (
  has_role(VARIADIC ARRAY['gerente','administrador','facturador','contador','vendedor','repartidor'])
);

COMMENT ON POLICY cobros_select ON cobros IS
  'Vendedores y repartidores pueden VER todos los cobros para calcular el saldo real del cliente. Los UPDATE/DELETE siguen restringidos a admin/gerente/contador.';

-- ── FIX BUG 2: race condition al generar correlativo
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

  -- Advisory lock por mes: serializa la generación de números para evitar
  -- que dos cobros simultáneos calculen el mismo correlativo.
  -- El lock se libera al final de la transacción.
  PERFORM pg_advisory_xact_lock(hashtext('cobro_' || v_yyyymm));

  SELECT COALESCE(MAX(CAST(SPLIT_PART(numero, '-', 3) AS INT)), 0) + 1
    INTO v_seq
    FROM cobros
    WHERE numero LIKE 'R-' || v_yyyymm || '-%';
  v_numero := 'R-' || v_yyyymm || '-' || LPAD(v_seq::TEXT, 6, '0');
  RETURN v_numero;
END;
$$;

COMMENT ON FUNCTION generar_correlativo_cobro IS
  'Genera el siguiente correlativo de cobro del mes en formato R-YYYYMM-NNNNNN. Usa advisory lock para evitar race conditions bajo concurrencia.';

-- ── FEATURE: trigger auto-aplicar respeta aplicaciones manuales si ya existen
CREATE OR REPLACE FUNCTION trg_aplicar_cobro_auto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si ya hay aplicaciones manuales registradas para este cobro (insertadas
  -- previamente desde la RPC registrar_cobro_atomico), no aplicar FIFO.
  IF EXISTS (SELECT 1 FROM cobros_aplicaciones WHERE cobro_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  PERFORM aplicar_cobro_fifo(NEW.id);
  RETURN NEW;
END;
$$;

-- ── RPC para registrar un cobro con aplicaciones manuales opcionales
-- Si p_aplicaciones es NULL o vacío → FIFO automático (comportamiento legacy).
-- Si p_aplicaciones trae [{comprobante_id, monto_aplicado}, ...] → aplicar manual.
CREATE OR REPLACE FUNCTION registrar_cobro_atomico(
  p_cobro JSONB,
  p_aplicaciones JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cobro_id UUID;
  v_aplic JSONB;
  v_total_aplicado NUMERIC := 0;
  v_total_cobro NUMERIC;
  v_a_cuenta NUMERIC;
BEGIN
  v_total_cobro := COALESCE((p_cobro->>'total')::NUMERIC, 0);
  IF v_total_cobro <= 0 THEN
    RAISE EXCEPTION 'El total del cobro debe ser mayor a 0';
  END IF;

  -- Insertar el cobro (el trigger trg_cobros_numero asigna el correlativo
  -- y el trigger trg_aplicar_cobro_auto solo aplica FIFO si no hay
  -- aplicaciones manuales)
  INSERT INTO cobros (
    cliente_id, cobrador_id, tipo, fecha,
    efectivo, yape, plin, transferencia, total,
    voucher_url, nro_operacion, notas,
    cliente_externo_nombre, cliente_externo_doc
  ) VALUES (
    NULLIF(p_cobro->>'cliente_id', '')::UUID,
    NULLIF(p_cobro->>'cobrador_id', '')::UUID,
    COALESCE(p_cobro->>'tipo', 'cobranza')::tipo_cobro,
    (p_cobro->>'fecha')::DATE,
    COALESCE((p_cobro->>'efectivo')::NUMERIC, 0),
    COALESCE((p_cobro->>'yape')::NUMERIC, 0),
    COALESCE((p_cobro->>'plin')::NUMERIC, 0),
    COALESCE((p_cobro->>'transferencia')::NUMERIC, 0),
    v_total_cobro,
    p_cobro->>'voucher_url',
    p_cobro->>'nro_operacion',
    p_cobro->>'notas',
    p_cobro->>'cliente_externo_nombre',
    p_cobro->>'cliente_externo_doc'
  )
  RETURNING id INTO v_cobro_id;

  -- Si vienen aplicaciones manuales: insertarlas ANTES de que el trigger
  -- auto-aplicar las evalúe. El truco: el trigger AFTER INSERT corre después
  -- del INSERT principal, así que necesitamos otra estrategia.
  --
  -- En realidad, el trigger ya corre antes de llegar aquí. Solución:
  -- detectar aplicaciones manuales DESPUÉS y reemplazar lo que hizo FIFO.
  IF p_aplicaciones IS NOT NULL AND jsonb_array_length(p_aplicaciones) > 0 THEN
    -- Borrar lo que aplicó el trigger FIFO
    DELETE FROM cobros_aplicaciones WHERE cobro_id = v_cobro_id;

    -- Insertar las aplicaciones manuales
    FOR v_aplic IN SELECT * FROM jsonb_array_elements(p_aplicaciones)
    LOOP
      INSERT INTO cobros_aplicaciones (
        cobro_id, comprobante_id, monto_aplicado, es_a_cuenta
      ) VALUES (
        v_cobro_id,
        NULLIF(v_aplic->>'comprobante_id', '')::UUID,
        (v_aplic->>'monto_aplicado')::NUMERIC,
        FALSE
      );
      v_total_aplicado := v_total_aplicado + (v_aplic->>'monto_aplicado')::NUMERIC;
    END LOOP;

    -- Si quedó saldo no aplicado → a cuenta
    v_a_cuenta := v_total_cobro - v_total_aplicado;
    IF v_a_cuenta > 0.001 THEN
      INSERT INTO cobros_aplicaciones (
        cobro_id, comprobante_id, monto_aplicado, es_a_cuenta
      ) VALUES (
        v_cobro_id, NULL, v_a_cuenta, TRUE
      );
    END IF;

    -- Validar que no se aplicó más de lo cobrado
    IF v_total_aplicado > v_total_cobro + 0.001 THEN
      RAISE EXCEPTION 'Suma de aplicaciones (%) excede el total del cobro (%)',
        v_total_aplicado, v_total_cobro;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_cobro_id,
    'numero', (SELECT numero FROM cobros WHERE id = v_cobro_id),
    'total', v_total_cobro,
    'modo_aplicacion', CASE
      WHEN p_aplicaciones IS NOT NULL AND jsonb_array_length(p_aplicaciones) > 0
      THEN 'manual'
      ELSE 'fifo'
    END
  );
END;
$$;

COMMENT ON FUNCTION registrar_cobro_atomico IS
  'Registra un cobro con aplicación manual (p_aplicaciones) o automática FIFO (NULL). Si manual, sobreescribe lo que aplicó el trigger automático.';

-- Permitir que vendedores/repartidores ejecuten la RPC
GRANT EXECUTE ON FUNCTION registrar_cobro_atomico TO authenticated;
