-- ─────────────────────────────────────────────────────────────────────────────
-- 066: Tipo de cambio editable + asiento por diferencia de cambio
--
-- Requerimiento Vaneza + Daniel (R1):
-- "sunat a través del cire maneja un tipo de cambio y cuando hago la
--  contabilización siempre tengo que ajustar. Voy a poder editar eso?"
-- "todas las veces la importación siempre problema... ellos toman un tipo de
--  cambio diferente al portal de la sunat y nunca te va a cuadrar tu cuenta"
--
-- Cambios:
-- 1) tipo_cambio: audit de ediciones manuales (editado_por, motivo)
-- 2) Cuentas de diferencia de cambio del PCGE: 6761 (pérdida) / 776 (ganancia)
-- 3) RPC upsert manual del TC de una fecha
-- 4) RPC generar asiento por diferencia de cambio
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Audit en tipo_cambio
ALTER TABLE tipo_cambio
  ADD COLUMN IF NOT EXISTS editado_por UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS editado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_edicion TEXT;

-- ── 2. Cuentas del PCGE para diferencia de cambio
-- 676 en PCGE Modificado = "Diferencia de cambio" (pérdida)
-- 776 = "Diferencia de cambio" (ganancia)
-- La 676 que existe tiene nombre incorrecto — la corregimos y agregamos las que faltan.
UPDATE cuentas_contables
SET nombre = 'Diferencia de cambio', es_movimiento = FALSE
WHERE codigo = '676';

INSERT INTO cuentas_contables (codigo, nombre, naturaleza, nivel, es_movimiento, saldo_natural, clase, anexo_tipo) VALUES
  ('6761', 'Pérdida por diferencia de cambio', 'GASTO', 4, TRUE, 'D', '6', 'ninguno'),
  ('776', 'Diferencia de cambio', 'INGRESO', 3, FALSE, 'A', '7', 'ninguno'),
  ('7761', 'Ganancia por diferencia de cambio', 'INGRESO', 4, TRUE, 'A', '7', 'ninguno')
ON CONFLICT (codigo) DO NOTHING;

-- Vincular padres
UPDATE cuentas_contables c1 SET cuenta_padre_id = c2.id
FROM cuentas_contables c2
WHERE c1.codigo = '6761' AND c2.codigo = '676' AND c1.cuenta_padre_id IS NULL;
UPDATE cuentas_contables c1 SET cuenta_padre_id = c2.id
FROM cuentas_contables c2
WHERE c1.codigo = '7761' AND c2.codigo = '776' AND c1.cuenta_padre_id IS NULL;

-- ── 3. RPC: editar/insertar TC manual de una fecha (con audit)
CREATE OR REPLACE FUNCTION editar_tipo_cambio(
  p_fecha DATE,
  p_compra NUMERIC,
  p_venta NUMERIC,
  p_motivo TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Solo administrador/gerente/contador pueden editar el tipo de cambio';
  END IF;
  IF p_compra <= 0 OR p_venta <= 0 THEN
    RAISE EXCEPTION 'Tipo de cambio inválido';
  END IF;
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Motivo de edición requerido (mín 5 caracteres). Ej: "TC aduanas importación Chile"';
  END IF;

  INSERT INTO tipo_cambio (fecha, compra, venta, fuente, editado_por, editado_at, motivo_edicion)
  VALUES (p_fecha, p_compra, p_venta, 'MANUAL', v_user, NOW(), p_motivo)
  ON CONFLICT (fecha) DO UPDATE SET
    compra = EXCLUDED.compra,
    venta = EXCLUDED.venta,
    fuente = 'MANUAL',
    editado_por = EXCLUDED.editado_por,
    editado_at = EXCLUDED.editado_at,
    motivo_edicion = EXCLUDED.motivo_edicion
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION editar_tipo_cambio TO authenticated;

-- ── 4. RPC: generar asiento por diferencia de cambio
-- Caso típico: pagaste USD a un proveedor con TC distinto al de la provisión.
-- La diferencia va a 6761 (pérdida) o 7761 (ganancia).
CREATE OR REPLACE FUNCTION generar_asiento_diferencia_cambio(
  p_fecha DATE,
  p_glosa TEXT,                      -- ej: "Dif. cambio pago factura IMP-001 proveedor Cerdeña Chile"
  p_monto_diferencia NUMERIC,        -- positivo = pérdida (pagaste más), negativo = ganancia
  p_cuenta_contrapartida TEXT,       -- código de la cuenta afectada (ej: 4212 CxP, 1041 Bancos)
  p_proveedor_id UUID DEFAULT NULL,
  p_cliente_id UUID DEFAULT NULL,
  p_centro_costo_id UUID DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_profile RECORD;
  v_asiento_id UUID;
  v_numero TEXT;
  v_cta_dif UUID;
  v_cta_contra UUID;
  v_monto NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF p_monto_diferencia = 0 THEN RAISE EXCEPTION 'La diferencia no puede ser cero'; END IF;

  v_cta_contra := _cuenta_id_por_codigo(p_cuenta_contrapartida);
  IF v_cta_contra IS NULL THEN
    RAISE EXCEPTION 'Cuenta contrapartida % no existe', p_cuenta_contrapartida;
  END IF;

  v_monto := ABS(p_monto_diferencia);
  v_numero := siguiente_numero_asiento();

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado, creado_por, notas
  ) VALUES (
    v_numero, p_fecha, p_glosa, 'diferencia_cambio', 'borrador', v_user, p_notas
  ) RETURNING id INTO v_asiento_id;

  IF p_monto_diferencia > 0 THEN
    -- PÉRDIDA: Debe 6761 / Haber contrapartida
    v_cta_dif := _cuenta_id_por_codigo('6761');
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_dif, v_monto, 0, 1, p_centro_costo_id);
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, proveedor_id, cliente_id)
    VALUES (v_asiento_id, v_cta_contra, 0, v_monto, 2, p_proveedor_id, p_cliente_id);
  ELSE
    -- GANANCIA: Debe contrapartida / Haber 7761
    v_cta_dif := _cuenta_id_por_codigo('7761');
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, proveedor_id, cliente_id)
    VALUES (v_asiento_id, v_cta_contra, v_monto, 0, 1, p_proveedor_id, p_cliente_id);
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_dif, 0, v_monto, 2, p_centro_costo_id);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_diferencia_cambio TO authenticated;
