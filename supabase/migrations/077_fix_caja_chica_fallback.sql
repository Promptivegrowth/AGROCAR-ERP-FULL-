-- ─────────────────────────────────────────────────────────────────────────────
-- 077: FIX caja chica — gasto sin categoría fallaba (detectado en test cliente)
--
-- BUG: registrar_movimiento_caja_chica sin categoría usaba fallback '6591'
-- que NO existe en el plan (la cuenta real es '659'). El INSERT de la partida
-- fallaba con NOT NULL violation en cuenta_id.
-- La UI ofrece explícitamente "Sin categoría (usa Otros 659)" → camino roto.
--
-- FIX: fallback a '659' + validación explícita con mensaje claro si aún así
-- no se resuelve la cuenta.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION registrar_movimiento_caja_chica(
  p_tipo TEXT,
  p_concepto TEXT,
  p_monto NUMERIC,
  p_categoria_id UUID DEFAULT NULL,
  p_tercero_id UUID DEFAULT NULL,
  p_numero_recibo TEXT DEFAULT NULL,
  p_url_recibo TEXT DEFAULT NULL,
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
  v_sesion RECORD;
  v_categoria RECORD;
  v_mov_id UUID;
  v_asiento_id UUID;
  v_numero_asiento TEXT;
  v_cta_gasto UUID;
  v_cta_caja UUID;
  v_glosa TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador', 'caja') THEN
    RAISE EXCEPTION 'Sin permisos para operar Caja Chica';
  END IF;

  IF p_tipo NOT IN ('gasto', 'reposicion') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo;
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  SELECT * INTO v_sesion FROM caja_chica_sesiones WHERE estado = 'abierta' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay sesión de Caja Chica abierta'; END IF;

  IF p_tipo = 'gasto' AND v_sesion.saldo_actual < p_monto THEN
    RAISE EXCEPTION 'Fondo insuficiente. Saldo actual: %, Monto: %', v_sesion.saldo_actual, p_monto;
  END IF;

  INSERT INTO caja_chica_movimientos (
    sesion_id, tipo, fecha, concepto, monto, categoria_id, tercero_id,
    numero_recibo, url_recibo, centro_costo_id, creado_por, notas
  ) VALUES (
    v_sesion.id, p_tipo, CURRENT_DATE, p_concepto, p_monto, p_categoria_id, p_tercero_id,
    p_numero_recibo, p_url_recibo, p_centro_costo_id, v_user, p_notas
  ) RETURNING id INTO v_mov_id;

  IF p_tipo = 'gasto' THEN
    IF p_categoria_id IS NOT NULL THEN
      SELECT * INTO v_categoria FROM caja_chica_categorias WHERE id = p_categoria_id;
      v_cta_gasto := _cuenta_id_por_codigo(v_categoria.cuenta_contable);
    END IF;
    IF v_cta_gasto IS NULL THEN
      v_cta_gasto := _cuenta_id_por_codigo('659');  -- FIX: era '6591' (inexistente)
    END IF;
    v_cta_caja := _cuenta_id_por_codigo('1011');
    IF v_cta_gasto IS NULL OR v_cta_caja IS NULL THEN
      RAISE EXCEPTION 'Cuenta contable no encontrada (gasto: 659 / caja: 1011). Revisa el Plan de Cuentas.';
    END IF;

    v_numero_asiento := siguiente_numero_asiento();
    v_glosa := 'CC-' || v_sesion.numero || ' · ' || p_concepto;

    INSERT INTO asientos_contables (
      numero, fecha, glosa, origen, estado,
      referencia_tabla, referencia_id, creado_por
    ) VALUES (
      v_numero_asiento, CURRENT_DATE, v_glosa, 'caja_chica', 'borrador',
      'caja_chica_movimientos', v_mov_id, v_user
    ) RETURNING id INTO v_asiento_id;

    INSERT INTO asientos_partidas (
      asiento_id, cuenta_id, debe, haber, orden, tercero_id, centro_costo_id
    ) VALUES (
      v_asiento_id, v_cta_gasto, p_monto, 0, 1, p_tercero_id, p_centro_costo_id
    );
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_caja, 0, p_monto, 2);
  ELSE
    v_cta_caja := _cuenta_id_por_codigo('1011');
    IF v_cta_caja IS NULL OR _cuenta_id_por_codigo('1041') IS NULL THEN
      RAISE EXCEPTION 'Cuenta contable no encontrada (1011/1041). Revisa el Plan de Cuentas.';
    END IF;
    v_numero_asiento := siguiente_numero_asiento();
    v_glosa := 'CC-' || v_sesion.numero || ' · Reposición: ' || p_concepto;
    INSERT INTO asientos_contables (numero, fecha, glosa, origen, estado, referencia_tabla, referencia_id, creado_por)
    VALUES (v_numero_asiento, CURRENT_DATE, v_glosa, 'caja_chica', 'borrador', 'caja_chica_movimientos', v_mov_id, v_user)
    RETURNING id INTO v_asiento_id;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_caja, p_monto, 0, 1);
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, _cuenta_id_por_codigo('1041'), 0, p_monto, 2);
  END IF;

  UPDATE caja_chica_movimientos SET asiento_id = v_asiento_id WHERE id = v_mov_id;
  RETURN v_mov_id;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_movimiento_caja_chica TO authenticated;

-- Corregir también las categorías que hubieran quedado con cuentas viejas
UPDATE caja_chica_categorias SET cuenta_contable = '659' WHERE cuenta_contable IN ('6591','6035','6351','6341','6350','6394','6314','6321')
  AND NOT EXISTS (SELECT 1 FROM cuentas_contables WHERE codigo = caja_chica_categorias.cuenta_contable);
