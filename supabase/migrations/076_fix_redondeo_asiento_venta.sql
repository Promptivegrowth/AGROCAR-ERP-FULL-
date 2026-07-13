-- ─────────────────────────────────────────────────────────────────────────────
-- 076: FIX redondeo en asientos de venta (detectado por test exhaustivo)
--
-- BUG: 3 facturas tienen total ≠ subtotal + igv por 1 centavo de redondeo.
-- El asiento ponía Debe=total pero Haber=subtotal+igv → descuadre de S/0.01.
--
-- FIX: la partida de IGV se calcula como (total − subtotal) en lugar de usar
-- el campo igv directamente. El asiento SIEMPRE cuadra contra el total real.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_cc_vta UUID;
  v_glosa TEXT;
  v_igv_ajustado NUMERIC;
BEGIN
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
  v_cc_vta := _cc_id_por_codigo('VTA');

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
    'comprobantes', p_comprobante_id, v_user_id, '01'
  )
  RETURNING id INTO v_asiento_id;

  -- FIX: IGV = total − subtotal (garantiza cuadre exacto ante redondeos)
  v_igv_ajustado := v_comp.total - v_comp.subtotal;

  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id, centro_costo_id) VALUES
    (v_asiento_id, v_cta_cxc, v_comp.total, 0, 1, v_comp.cliente_id, v_cc_vta),
    (v_asiento_id, v_cta_ventas, 0, v_comp.subtotal, 2, NULL, v_cc_vta);
  IF v_igv_ajustado > 0 THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_igv, 0, v_igv_ajustado, 3, v_cc_vta);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_venta TO authenticated;

-- Corregir los 3 asientos existentes con la microdiferencia
DO $$
DECLARE
  v_a RECORD;
  v_dif NUMERIC;
BEGIN
  FOR v_a IN
    SELECT a.id, a.total_debe, a.total_haber
    FROM asientos_contables a
    WHERE a.estado <> 'anulado' AND a.total_debe <> a.total_haber
      AND a.origen = 'venta'
  LOOP
    v_dif := v_a.total_debe - v_a.total_haber;
    -- Ajustar la partida del IGV (40111) sumándole la diferencia
    UPDATE asientos_partidas p SET haber = haber + v_dif
    WHERE p.asiento_id = v_a.id
      AND p.cuenta_id = (SELECT id FROM cuentas_contables WHERE codigo = '40111')
      AND p.haber > 0;
  END LOOP;
END $$;
