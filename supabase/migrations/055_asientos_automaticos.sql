-- ─────────────────────────────────────────────────────────────────────────────
-- 055: Asientos contables automáticos desde transacciones operativas
--
-- Genera asientos contables automáticamente desde:
-- - Comprobantes (ventas a crédito): factura/boleta no anulada → asiento venta
-- - Cobros: efectivo, yape, plin, transferencia → asiento de cobranza
-- - Compras: facturas de proveedores → asiento compra con crédito fiscal
--
-- Diseño:
-- - Cada asiento se crea en estado 'borrador' para revisión del contador
-- - Vínculo via referencia_tabla + referencia_id (idempotente, no duplica)
-- - Si la transacción se anula después, el asiento queda como referencia
--   pero se puede anular manualmente o regenerar
-- - Plan: cuentas según PCGE Modificado vigente
--   - 1212: Cuentas por cobrar - Emitidas en cartera (D)
--   - 1011: Caja MN, 1012: Yape/Plin, 1041: Bancos (D)
--   - 70111: Ventas mercaderías terceros (H)
--   - 40111: IGV cuenta propia (H)
--   - 40112: IGV crédito fiscal compras (D)
--   - 6011: Compras mercaderías (D)
--   - 4212: Cuentas por pagar - Emitidas (H)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper: obtener id de cuenta por código
CREATE OR REPLACE FUNCTION _cuenta_id_por_codigo(p_codigo TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM cuentas_contables WHERE codigo = p_codigo AND activo = TRUE LIMIT 1;
$$;

-- ── Genera asiento de VENTA desde un comprobante
-- Esquema:
--   Debe: 1212 (Cuentas por cobrar - cartera)     ← total
--   Haber: 70111 (Ventas mercaderías terceros)    ← subtotal sin IGV
--   Haber: 40111 (IGV cuenta propia)              ← IGV
CREATE OR REPLACE FUNCTION generar_asiento_venta(p_comprobante_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp RECORD;
  v_existente UUID;
  v_asiento_id UUID;
  v_numero TEXT;
  v_user_id UUID := auth.uid();
  v_cta_cxc UUID; v_cta_ventas UUID; v_cta_igv UUID;
  v_glosa TEXT;
BEGIN
  -- ¿Ya existe asiento para este comprobante?
  SELECT id INTO v_existente FROM asientos_contables
    WHERE referencia_tabla = 'comprobantes' AND referencia_id = p_comprobante_id
      AND estado <> 'anulado';
  IF v_existente IS NOT NULL THEN RETURN v_existente; END IF;

  SELECT c.*, cl.razon_social INTO v_comp
  FROM comprobantes c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  WHERE c.id = p_comprobante_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante % no existe', p_comprobante_id; END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se genera asiento para comprobantes anulados';
  END IF;

  v_cta_cxc := _cuenta_id_por_codigo('1212');
  v_cta_ventas := _cuenta_id_por_codigo('70111');
  v_cta_igv := _cuenta_id_por_codigo('40111');

  IF v_cta_cxc IS NULL OR v_cta_ventas IS NULL OR v_cta_igv IS NULL THEN
    RAISE EXCEPTION 'Falta cuenta contable: 1212, 70111 o 40111. Revisa el Plan.';
  END IF;

  v_numero := siguiente_numero_asiento();
  v_glosa := UPPER(v_comp.tipo::text) || ' ' || v_comp.serie || '-' ||
             LPAD(v_comp.numero::text, 8, '0') ||
             COALESCE(' · ' || v_comp.razon_social, ' · ' || COALESCE(v_comp.cliente_externo_nombre, 'CF'));

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado,
    referencia_tabla, referencia_id, creado_por,
    tipo_operacion_sunat
  ) VALUES (
    v_numero, v_comp.fecha_emision, v_glosa, 'venta', 'borrador',
    'comprobantes', p_comprobante_id, v_user_id,
    '01'  -- Venta interna gravada
  )
  RETURNING id INTO v_asiento_id;

  -- Partidas
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden) VALUES
    (v_asiento_id, v_cta_cxc, v_comp.total, 0, 1),
    (v_asiento_id, v_cta_ventas, 0, v_comp.subtotal, 2);
  IF v_comp.igv > 0 THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_igv, 0, v_comp.igv, 3);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_venta TO authenticated;

-- ── Genera asiento de COBRO desde un cobro
-- Esquema (depende de los métodos):
--   Debe: 1011 (Caja MN)        ← efectivo
--   Debe: 1012 (Yape/Plin)      ← yape + plin
--   Debe: 1041 (Bancos)         ← transferencia
--   Haber: 1212 (Cuentas por cobrar - cartera)     ← total aplicado
--   Haber: 75x (Otros ingresos)  ← si es a-cuenta sin factura específica
CREATE OR REPLACE FUNCTION generar_asiento_cobro(p_cobro_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cobro RECORD;
  v_existente UUID;
  v_asiento_id UUID;
  v_numero TEXT;
  v_user_id UUID := auth.uid();
  v_cta_caja UUID; v_cta_yape UUID; v_cta_bcos UUID;
  v_cta_cxc UUID; v_cta_otros_ing UUID;
  v_glosa TEXT;
  v_orden INT := 0;
  v_total_aplicado NUMERIC := 0;
  v_a_cuenta NUMERIC := 0;
BEGIN
  SELECT id INTO v_existente FROM asientos_contables
    WHERE referencia_tabla = 'cobros' AND referencia_id = p_cobro_id
      AND estado <> 'anulado';
  IF v_existente IS NOT NULL THEN RETURN v_existente; END IF;

  SELECT c.*, cl.razon_social INTO v_cobro
  FROM cobros c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  WHERE c.id = p_cobro_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobro % no existe', p_cobro_id; END IF;

  v_cta_caja := _cuenta_id_por_codigo('1011');
  v_cta_yape := _cuenta_id_por_codigo('1012');
  v_cta_bcos := _cuenta_id_por_codigo('1041');
  v_cta_cxc := _cuenta_id_por_codigo('1212');
  v_cta_otros_ing := _cuenta_id_por_codigo('759');

  IF v_cta_caja IS NULL OR v_cta_cxc IS NULL THEN
    RAISE EXCEPTION 'Falta cuenta contable: 1011 o 1212';
  END IF;

  -- Aplicaciones: cuánto se aplicó a facturas (1212) vs a-cuenta (otros ingresos)
  SELECT
    COALESCE(SUM(monto_aplicado) FILTER (WHERE NOT es_a_cuenta), 0),
    COALESCE(SUM(monto_aplicado) FILTER (WHERE es_a_cuenta), 0)
  INTO v_total_aplicado, v_a_cuenta
  FROM cobros_aplicaciones WHERE cobro_id = p_cobro_id;

  v_numero := siguiente_numero_asiento();
  v_glosa := 'Cobro ' || COALESCE(v_cobro.numero, '?') ||
             COALESCE(' · ' || v_cobro.razon_social, ' · ' || COALESCE(v_cobro.cliente_externo_nombre, 'CF'));

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado,
    referencia_tabla, referencia_id, creado_por
  ) VALUES (
    v_numero, v_cobro.fecha, v_glosa, 'cobro', 'borrador',
    'cobros', p_cobro_id, v_user_id
  )
  RETURNING id INTO v_asiento_id;

  -- Partidas debe según método
  IF COALESCE(v_cobro.efectivo, 0) > 0 THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_caja, v_cobro.efectivo, 0, v_orden);
  END IF;
  IF COALESCE(v_cobro.yape, 0) + COALESCE(v_cobro.plin, 0) > 0 AND v_cta_yape IS NOT NULL THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_yape, COALESCE(v_cobro.yape, 0) + COALESCE(v_cobro.plin, 0), 0, v_orden);
  END IF;
  IF COALESCE(v_cobro.transferencia, 0) > 0 AND v_cta_bcos IS NOT NULL THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_bcos, v_cobro.transferencia, 0, v_orden);
  END IF;

  -- Haber: aplicado a CxC + a cuenta
  IF v_total_aplicado > 0 THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_cxc, 0, v_total_aplicado, v_orden);
  END IF;
  IF v_a_cuenta > 0 AND v_cta_otros_ing IS NOT NULL THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_otros_ing, 0, v_a_cuenta, v_orden);
  END IF;

  -- Si no hubo aplicaciones (caso raro), todo va contra CxC para que cuadre
  IF v_total_aplicado = 0 AND v_a_cuenta = 0 THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_cxc, 0, v_cobro.total, v_orden);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_cobro TO authenticated;

-- ── Genera asiento de COMPRA desde una compra
-- Esquema:
--   Debe: 6011 (Compras mercaderías)            ← subtotal sin IGV
--   Debe: 40112 (IGV crédito fiscal)            ← IGV
--   Haber: 4212 (Cuentas por pagar - Emitidas)  ← total
CREATE OR REPLACE FUNCTION generar_asiento_compra(p_compra_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_compra RECORD;
  v_existente UUID;
  v_asiento_id UUID;
  v_numero TEXT;
  v_user_id UUID := auth.uid();
  v_cta_compras UUID; v_cta_igv_cf UUID; v_cta_cxp UUID;
  v_glosa TEXT;
BEGIN
  SELECT id INTO v_existente FROM asientos_contables
    WHERE referencia_tabla = 'compras' AND referencia_id = p_compra_id
      AND estado <> 'anulado';
  IF v_existente IS NOT NULL THEN RETURN v_existente; END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra % no existe', p_compra_id; END IF;
  IF v_compra.estado = 'anulada' THEN
    RAISE EXCEPTION 'No se genera asiento para compras anuladas';
  END IF;

  v_cta_compras := _cuenta_id_por_codigo('6011');
  v_cta_igv_cf := _cuenta_id_por_codigo('40112');
  v_cta_cxp := _cuenta_id_por_codigo('4212');

  IF v_cta_compras IS NULL OR v_cta_cxp IS NULL THEN
    RAISE EXCEPTION 'Falta cuenta contable: 6011 o 4212';
  END IF;

  v_numero := siguiente_numero_asiento();
  v_glosa := 'COMPRA ' || COALESCE(v_compra.numero_factura_proveedor, 'sin ref');

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado,
    referencia_tabla, referencia_id, creado_por,
    tipo_operacion_sunat
  ) VALUES (
    v_numero, v_compra.fecha, v_glosa, 'compra', 'borrador',
    'compras', p_compra_id, v_user_id,
    '01'  -- Compra interna
  )
  RETURNING id INTO v_asiento_id;

  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden) VALUES
    (v_asiento_id, v_cta_compras, v_compra.subtotal, 0, 1);
  IF v_compra.igv > 0 AND v_cta_igv_cf IS NOT NULL THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_igv_cf, v_compra.igv, 0, 2);
  END IF;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
  VALUES (v_asiento_id, v_cta_cxp, 0, v_compra.total, 3);

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_compra TO authenticated;

-- ── RPC orquestadora: generar TODOS los asientos pendientes en un rango
CREATE OR REPLACE FUNCTION generar_asientos_pendientes(
  p_desde DATE,
  p_hasta DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_ventas_count INT := 0;
  v_cobros_count INT := 0;
  v_compras_count INT := 0;
  v_errores TEXT[] := '{}'::TEXT[];
  v_rec RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT id, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'contador') THEN
    RAISE EXCEPTION 'Solo admin/gerente/contador pueden generar asientos';
  END IF;

  -- VENTAS: comprobantes no anulados sin asiento
  FOR v_rec IN
    SELECT c.id FROM comprobantes c
    WHERE c.fecha_emision BETWEEN p_desde AND p_hasta
      AND c.estado <> 'anulado'
      AND NOT EXISTS (
        SELECT 1 FROM asientos_contables a
        WHERE a.referencia_tabla = 'comprobantes' AND a.referencia_id = c.id
          AND a.estado <> 'anulado'
      )
  LOOP
    BEGIN
      PERFORM generar_asiento_venta(v_rec.id);
      v_ventas_count := v_ventas_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores || ('Venta ' || v_rec.id || ': ' || SQLERRM);
    END;
  END LOOP;

  -- COBROS sin asiento
  FOR v_rec IN
    SELECT c.id FROM cobros c
    WHERE c.fecha BETWEEN p_desde AND p_hasta
      AND NOT EXISTS (
        SELECT 1 FROM asientos_contables a
        WHERE a.referencia_tabla = 'cobros' AND a.referencia_id = c.id
          AND a.estado <> 'anulado'
      )
  LOOP
    BEGIN
      PERFORM generar_asiento_cobro(v_rec.id);
      v_cobros_count := v_cobros_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores || ('Cobro ' || v_rec.id || ': ' || SQLERRM);
    END;
  END LOOP;

  -- COMPRAS sin asiento
  FOR v_rec IN
    SELECT c.id FROM compras c
    WHERE c.fecha BETWEEN p_desde AND p_hasta
      AND c.estado <> 'anulada'
      AND NOT EXISTS (
        SELECT 1 FROM asientos_contables a
        WHERE a.referencia_tabla = 'compras' AND a.referencia_id = c.id
          AND a.estado <> 'anulado'
      )
  LOOP
    BEGIN
      PERFORM generar_asiento_compra(v_rec.id);
      v_compras_count := v_compras_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores || ('Compra ' || v_rec.id || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ventas', v_ventas_count,
    'cobros', v_cobros_count,
    'compras', v_compras_count,
    'errores', v_errores
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asientos_pendientes TO authenticated;

-- ── Vista de transacciones pendientes (para mostrar antes de generar)
CREATE OR REPLACE VIEW v_transacciones_sin_asiento AS
SELECT
  'venta' AS tipo,
  c.id,
  c.fecha_emision AS fecha,
  c.serie || '-' || LPAD(c.numero::text, 8, '0') AS referencia,
  COALESCE(cl.razon_social, c.cliente_externo_nombre, 'CF') AS detalle,
  c.total AS monto
FROM comprobantes c
LEFT JOIN clientes cl ON cl.id = c.cliente_id
WHERE c.estado <> 'anulado'
  AND NOT EXISTS (
    SELECT 1 FROM asientos_contables a
    WHERE a.referencia_tabla = 'comprobantes' AND a.referencia_id = c.id
      AND a.estado <> 'anulado'
  )
UNION ALL
SELECT
  'cobro',
  c.id,
  c.fecha,
  COALESCE(c.numero, 'R-?'),
  COALESCE(cl.razon_social, c.cliente_externo_nombre, 'CF'),
  c.total
FROM cobros c
LEFT JOIN clientes cl ON cl.id = c.cliente_id
WHERE NOT EXISTS (
  SELECT 1 FROM asientos_contables a
  WHERE a.referencia_tabla = 'cobros' AND a.referencia_id = c.id
    AND a.estado <> 'anulado'
)
UNION ALL
SELECT
  'compra',
  c.id,
  c.fecha,
  COALESCE(c.numero_factura_proveedor, 'sin ref'),
  COALESCE(p.razon_social, 'Sin proveedor'),
  c.total
FROM compras c
LEFT JOIN proveedores p ON p.id = c.proveedor_id
WHERE c.estado <> 'anulada'
  AND NOT EXISTS (
    SELECT 1 FROM asientos_contables a
    WHERE a.referencia_tabla = 'compras' AND a.referencia_id = c.id
      AND a.estado <> 'anulado'
  )
ORDER BY fecha DESC;

GRANT SELECT ON v_transacciones_sin_asiento TO authenticated;
