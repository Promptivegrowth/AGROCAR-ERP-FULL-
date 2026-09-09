-- ═══════════════════════════════════════════════════════════════════════════
-- 110 · El correlativo de la nota de crédito pierde los ceros
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `emitir_nota_credito` guardaba el número así:
--
--     'nota_credito', v_serie, v_numero::INT, ...
--
-- `comprobantes.numero` es TEXT. `siguiente_correlativo` devuelve el número ya
-- rellenado —"00000001"—, pero ese `::INT` lo convierte en 1 y al guardarlo en
-- una columna de texto queda "1".
--
-- Lo que eso rompe
-- ----------------
-- El XML arma el identificador como serie-número sin rellenar nada, así que la
-- nota saldría como `FC01-1` en vez de `FC01-00000001`. SUNAT lo rechaza con el
-- código 1001, "El dato SERIE-CORRELATIVO no cumple con el formato de acuerdo
-- al tipo de comprobante".
--
-- Y en el ERP queda una nota que no se parece a ningún otro comprobante: los
-- 817 que existen tienen ocho dígitos, y la búsqueda por número los encuentra
-- por eso.
--
-- Por qué nadie lo vio
-- --------------------
-- Todavía no se emitió ninguna nota de crédito. El defecto estaba esperando a
-- la primera, y la primera habría sido rechazada.
--
-- Se encontró auditando el cambio de fechas: al emitir una nota de prueba para
-- comprobar la migración 109, salió numerada `FC01-1`.
--
-- El arreglo es sacar el `::INT`. `v_numero` ya viene como texto y ya viene
-- rellenado.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION emitir_nota_credito(
  p_comprobante_original_id UUID,
  p_motivo_sunat TEXT,
  p_items JSONB,
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
  v_original RECORD;
  v_nc_id UUID;
  v_serie TEXT;
  v_numero TEXT;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_igv NUMERIC := 0;
  v_total NUMERIC := 0;
  v_asiento_id UUID;
  v_numero_asiento TEXT;
  v_cta_cxc UUID; v_cta_ventas UUID; v_cta_igv UUID;
  v_cc_vta UUID;
  v_fecha DATE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_profile FROM profiles WHERE id = v_user;
  IF v_profile.role NOT IN ('administrador', 'gerente', 'contador', 'facturador') THEN
    RAISE EXCEPTION 'Sin permisos para emitir nota de crédito';
  END IF;

  IF p_motivo_sunat NOT IN ('01','02','03','04','05','06','07','08','09','10','11','13') THEN
    RAISE EXCEPTION 'Motivo SUNAT inválido: %. Ver catálogo 09.', p_motivo_sunat;
  END IF;

  -- Traer comprobante original
  SELECT * INTO v_original FROM comprobantes WHERE id = p_comprobante_original_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante original no existe'; END IF;
  IF v_original.tipo = 'nota_credito' THEN
    RAISE EXCEPTION 'No se puede emitir NC contra otra NC';
  END IF;

  /*
   * La fecha de la nota: hoy en Tacna, salvo que el documento que corrige sea
   * posterior —una factura ya emitida para el reparto de pasado mañana—, en
   * cuyo caso se usa la de ese documento. SUNAT rechaza con 2885 cualquier nota
   * anterior a lo que modifica. (Migración 109.)
   */
  v_fecha := GREATEST((NOW() AT TIME ZONE 'America/Lima')::date, v_original.fecha_emision);

  -- Numeración de NC. Viene ya rellenada: "00000001", no 1.
  SELECT s.serie, s.numero INTO v_serie, v_numero FROM siguiente_correlativo('nota_credito'::tipo_comprobante) s;

  -- Calcular totales desde items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_subtotal := v_subtotal + COALESCE((v_item->>'subtotal')::NUMERIC, 0);
  END LOOP;
  v_igv := ROUND(v_subtotal * 0.18, 2);
  v_total := v_subtotal + v_igv;

  -- Crear cabecera NC
  INSERT INTO comprobantes (
    tipo, serie, numero,
    pedido_id, cliente_id, facturador_id,
    fecha_emision, subtotal, igv, total,
    moneda, estado,
    referencia_comprobante_id, motivo_sunat,
    cliente_externo_nombre, cliente_externo_doc
  ) VALUES (
    -- `v_numero` va tal cual: un `::INT` acá le comía los ceros y la nota
    -- quedaba como FC01-1, que SUNAT rechaza con 1001.
    'nota_credito', v_serie, v_numero,
    v_original.pedido_id, v_original.cliente_id, v_user,
    v_fecha, v_subtotal, v_igv, v_total,
    v_original.moneda, 'emitido',
    p_comprobante_original_id, p_motivo_sunat,
    v_original.cliente_externo_nombre, v_original.cliente_externo_doc
  ) RETURNING id INTO v_nc_id;

  -- Insertar items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO comprobantes_items (
      comprobante_id, producto_id, descripcion,
      cantidad, precio_unitario, subtotal, igv_porcentaje
    ) VALUES (
      v_nc_id,
      NULLIF(v_item->>'producto_id', '')::UUID,
      v_item->>'descripcion',
      (v_item->>'cantidad')::NUMERIC,
      (v_item->>'precio_unitario')::NUMERIC,
      (v_item->>'subtotal')::NUMERIC,
      18
    );
  END LOOP;

  -- Generar asiento contable inverso (revierte la venta)
  v_cta_cxc := _cuenta_id_por_codigo('1212');
  v_cta_ventas := _cuenta_id_por_codigo('70111');
  v_cta_igv := _cuenta_id_por_codigo('40111');
  v_cc_vta := _cc_id_por_codigo('VTA');

  v_numero_asiento := siguiente_numero_asiento();
  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado,
    referencia_tabla, referencia_id, creado_por, tipo_operacion_sunat
  ) VALUES (
    -- El asiento lleva la misma fecha que la nota: si no, la nota y su asiento
    -- pueden caer en meses distintos.
    v_numero_asiento, v_fecha,
    'NOTA DE CRÉDITO ' || v_serie || '-' || v_numero || ' vs ' || v_original.serie || '-' || LPAD(v_original.numero::text, 8, '0'),
    'nota_credito', 'borrador',
    'comprobantes', v_nc_id, v_user, '13'   -- 13=Nota de crédito
  ) RETURNING id INTO v_asiento_id;

  -- Asiento inverso: Debe 70111 + Debe 40111 = Haber 1212
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
  VALUES (v_asiento_id, v_cta_ventas, v_subtotal, 0, 1, v_cc_vta);
  IF v_igv > 0 THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_igv, v_igv, 0, 2, v_cc_vta);
  END IF;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id, centro_costo_id)
  VALUES (v_asiento_id, v_cta_cxc, 0, v_total, 3, v_original.cliente_id, v_cc_vta);

  RETURN v_nc_id;
END;
$$;

COMMENT ON FUNCTION emitir_nota_credito IS
  'Emite una nota de credito. Fecha: hoy en Lima, o la del documento que corrige si es posterior (SUNAT 2885). Correlativo con sus ocho digitos (SUNAT 1001).';

GRANT EXECUTE ON FUNCTION emitir_nota_credito TO authenticated;
