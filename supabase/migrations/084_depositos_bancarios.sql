-- ─────────────────────────────────────────────────────────────────────────────
-- 084: Depósitos bancarios del personal de campo
--
-- Daniel en la reunión:
--   "lo que queremos evitar es andar con efectivo... que de cada zona, como
--    están cerca de los bancos, lo depositen. Hoy en día la situación es muy
--    peligrosa"
--   "el vendedor tenga la función de depósito: que ponga el monto que ha
--    depositado a la cuenta corriente y adjunte el voucher"
--   "ese depósito significa para caja como efectivo... y quiero trazabilidad"
--
-- Efecto en la rendición: el efectivo que el vendedor debe ENTREGAR EN CAJA es
-- lo que cobró en efectivo MENOS lo que ya depositó en el banco.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS depositos_bancarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
  monto          NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  banco          TEXT,
  nro_operacion  TEXT,
  voucher_url    TEXT,
  notas          TEXT,
  estado         TEXT NOT NULL DEFAULT 'registrado'
                 CHECK (estado IN ('registrado', 'verificado', 'observado')),
  observacion    TEXT,
  verificado_por UUID REFERENCES profiles(id),
  verificado_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_depositos_persona_fecha ON depositos_bancarios (persona_id, fecha);
CREATE INDEX IF NOT EXISTS idx_depositos_fecha ON depositos_bancarios (fecha);

COMMENT ON TABLE depositos_bancarios IS
  'Depósitos que el personal de campo hace directo al banco para no trasladar efectivo. Descuentan del efectivo que deben entregar en caja.';

ALTER TABLE depositos_bancarios ENABLE ROW LEVEL SECURITY;

-- Cada quien ve los suyos; caja, contabilidad y gerencia ven todos
DROP POLICY IF EXISTS depositos_select ON depositos_bancarios;
CREATE POLICY depositos_select ON depositos_bancarios FOR SELECT USING (
  persona_id = auth.uid()
  OR has_role(VARIADIC ARRAY['administrador', 'gerente', 'caja', 'contador'])
);

-- El personal de campo registra los suyos; caja también puede registrarlos
DROP POLICY IF EXISTS depositos_insert ON depositos_bancarios;
CREATE POLICY depositos_insert ON depositos_bancarios FOR INSERT WITH CHECK (
  persona_id = auth.uid()
  OR has_role(VARIADIC ARRAY['administrador', 'gerente', 'caja'])
);

-- Verificar / observar: solo quien controla el dinero
DROP POLICY IF EXISTS depositos_update ON depositos_bancarios;
CREATE POLICY depositos_update ON depositos_bancarios FOR UPDATE USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'caja', 'contador'])
);

DROP POLICY IF EXISTS depositos_delete ON depositos_bancarios;
CREATE POLICY depositos_delete ON depositos_bancarios FOR DELETE USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente'])
);

-- ── Registrar un depósito (lo llama el vendedor desde el aplicativo)
CREATE OR REPLACE FUNCTION registrar_deposito(
  p_monto NUMERIC,
  p_banco TEXT DEFAULT NULL,
  p_nro_operacion TEXT DEFAULT NULL,
  p_voucher_url TEXT DEFAULT NULL,
  p_notas TEXT DEFAULT NULL,
  p_fecha DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
  v_fecha DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF COALESCE(p_monto, 0) <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a cero'; END IF;

  -- No permitir registrar depósitos con fecha futura
  IF v_fecha > (NOW() AT TIME ZONE 'America/Lima')::date THEN
    RAISE EXCEPTION 'No se puede registrar un depósito con fecha futura';
  END IF;

  INSERT INTO depositos_bancarios (
    persona_id, fecha, monto, banco, nro_operacion, voucher_url, notas
  ) VALUES (
    v_uid, v_fecha, ROUND(p_monto, 2), NULLIF(TRIM(p_banco), ''),
    NULLIF(TRIM(p_nro_operacion), ''), NULLIF(TRIM(p_voucher_url), ''),
    NULLIF(TRIM(p_notas), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_deposito TO authenticated;

-- ── Caja verifica u observa el depósito contra el extracto del banco
CREATE OR REPLACE FUNCTION verificar_deposito(
  p_deposito_id UUID,
  p_estado TEXT,
  p_observacion TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;

  IF v_rol NOT IN ('administrador', 'gerente', 'caja', 'contador') THEN
    RAISE EXCEPTION 'Solo caja, contabilidad o gerencia pueden verificar depósitos';
  END IF;

  IF p_estado NOT IN ('registrado', 'verificado', 'observado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado;
  END IF;

  UPDATE depositos_bancarios
  SET estado = p_estado,
      observacion = NULLIF(TRIM(p_observacion), ''),
      verificado_por = v_uid,
      verificado_at = NOW()
  WHERE id = p_deposito_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Depósito no encontrado'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION verificar_deposito TO authenticated;

-- ── La rendición ahora descuenta los depósitos del efectivo a entregar
CREATE OR REPLACE FUNCTION rendicion_persona(
  p_persona_id UUID,
  p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol_solicitante TEXT;
  v_persona RECORD;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role::text INTO v_rol_solicitante FROM profiles WHERE id = v_uid;

  IF v_rol_solicitante IN ('vendedor', 'repartidor', 'chofer')
     AND p_persona_id <> v_uid THEN
    RAISE EXCEPTION 'Solo puede consultar su propia rendición';
  END IF;

  IF v_rol_solicitante NOT IN
     ('administrador', 'gerente', 'caja', 'contador', 'vendedor', 'repartidor', 'chofer') THEN
    RAISE EXCEPTION 'Sin permiso para consultar rendiciones';
  END IF;

  SELECT id, COALESCE(full_name, email) AS nombre, role::text AS rol
  INTO v_persona FROM profiles WHERE id = p_persona_id;

  IF v_persona.id IS NULL THEN RAISE EXCEPTION 'Persona no encontrada'; END IF;

  WITH ventas AS (
    SELECT
      c.id, c.tipo::text AS tipo, c.serie, c.numero, c.total,
      COALESCE(pe.tipo_pago::text, 'credito') AS tipo_pago,
      COALESCE(cl.razon_social, c.cliente_externo_nombre, '—') AS cliente
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    WHERE c.fecha_emision = p_fecha
      AND c.estado <> 'anulado'
      AND pe.vendedor_id = p_persona_id
  ),
  cobranzas AS (
    SELECT
      co.id, co.created_at, co.numero,
      COALESCE(cl.razon_social, co.cliente_externo_nombre, '—') AS cliente,
      co.efectivo, co.yape, co.plin, co.transferencia, co.total,
      co.nro_operacion, co.voucher_url
    FROM cobros co
    LEFT JOIN clientes cl ON cl.id = co.cliente_id
    WHERE co.fecha = p_fecha AND co.cobrador_id = p_persona_id
  ),
  depositos AS (
    SELECT d.id, d.monto, d.banco, d.nro_operacion, d.estado,
           d.voucher_url, d.created_at
    FROM depositos_bancarios d
    WHERE d.fecha = p_fecha AND d.persona_id = p_persona_id
  )
  SELECT jsonb_build_object(
    'persona', jsonb_build_object(
      'id', v_persona.id, 'nombre', v_persona.nombre, 'rol', v_persona.rol
    ),
    'fecha', p_fecha,
    'generado_at', NOW(),
    'ventas', jsonb_build_object(
      'count',          (SELECT COUNT(*) FROM ventas),
      'monto',          (SELECT COALESCE(SUM(total), 0) FROM ventas),
      'contado_count',  (SELECT COUNT(*) FROM ventas WHERE tipo_pago = 'contado'),
      'contado_monto',  (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE tipo_pago = 'contado'),
      'credito_count',  (SELECT COUNT(*) FROM ventas WHERE tipo_pago <> 'contado'),
      'credito_monto',  (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE tipo_pago <> 'contado'),
      'documentos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tipo', tipo, 'serie', serie, 'numero', numero,
          'cliente', cliente, 'total', total, 'tipo_pago', tipo_pago
        ) ORDER BY serie, numero) FROM ventas
      ), '[]'::jsonb)
    ),
    'cobros', jsonb_build_object(
      'count',         (SELECT COUNT(*) FROM cobranzas),
      'efectivo',      (SELECT COALESCE(SUM(efectivo), 0) FROM cobranzas),
      'yape',          (SELECT COALESCE(SUM(yape), 0) FROM cobranzas),
      'plin',          (SELECT COALESCE(SUM(plin), 0) FROM cobranzas),
      'transferencia', (SELECT COALESCE(SUM(transferencia), 0) FROM cobranzas),
      'total',         (SELECT COALESCE(SUM(total), 0) FROM cobranzas),
      'detalle', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'hora', to_char(created_at AT TIME ZONE 'America/Lima', 'HH24:MI'),
          'numero', numero,
          'cliente', cliente,
          'efectivo', efectivo, 'yape', yape, 'plin', plin,
          'transferencia', transferencia, 'total', total,
          'nro_operacion', nro_operacion,
          'tiene_voucher', (voucher_url IS NOT NULL)
        ) ORDER BY created_at) FROM cobranzas
      ), '[]'::jsonb)
    ),
    'depositos', jsonb_build_object(
      'count', (SELECT COUNT(*) FROM depositos),
      'monto', (SELECT COALESCE(SUM(monto), 0) FROM depositos),
      'detalle', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'hora', to_char(created_at AT TIME ZONE 'America/Lima', 'HH24:MI'),
          'monto', monto, 'banco', banco, 'nro_operacion', nro_operacion,
          'estado', estado, 'tiene_voucher', (voucher_url IS NOT NULL)
        ) ORDER BY created_at) FROM depositos
      ), '[]'::jsonb)
    ),
    -- Lo que realmente debe entregar en caja: efectivo cobrado − depositado
    'efectivo_a_entregar', (
      (SELECT COALESCE(SUM(efectivo), 0) FROM cobranzas)
      - (SELECT COALESCE(SUM(monto), 0) FROM depositos)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION rendicion_persona TO authenticated;
