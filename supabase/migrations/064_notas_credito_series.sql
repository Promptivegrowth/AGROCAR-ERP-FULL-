-- ─────────────────────────────────────────────────────────────────────────────
-- 064: Notas de Crédito activas + preparación nuevas series
--
-- Requerimiento Daniel (R1):
-- "ahora sí vamos a utilizar notas de crédito Porque ahora todo lo que es
--  compras que Vamos a ingresar, hay veces ahí productos que no llegan Y
--  automáticamente el sistema tiene que generar una nota de crédito por la
--  diferencia"
-- "quiero comenzar de un cero uno, o sea de F002, B002, T002"
--
-- Vaneza dijo que ella crea las series en SUNAT — nosotros solo preparamos
-- la infraestructura.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Agregar 'nota_credito' al enum tipo_comprobante
-- NOTA: en migración fresca, esto debe correr en su propia transacción
-- (el resto de la migración usa el valor). Ya aplicado a producción.
-- ALTER TYPE tipo_comprobante ADD VALUE IF NOT EXISTS 'nota_credito';

-- ── 2. Agregar campos a comprobantes para soportar Nota de Crédito
ALTER TABLE comprobantes
  ADD COLUMN IF NOT EXISTS referencia_comprobante_id UUID REFERENCES comprobantes(id),
  ADD COLUMN IF NOT EXISTS motivo_sunat TEXT;

COMMENT ON COLUMN comprobantes.referencia_comprobante_id IS
  'Comprobante original al que refiere esta nota de crédito.';
COMMENT ON COLUMN comprobantes.motivo_sunat IS
  'Código catálogo 09 SUNAT: 01=Anulación operación, 02=Anulación RUC errado, 03=Corrección error descripción, 04=Descuento global, 05=Descuento por ítem, 06=Devolución total, 07=Devolución por ítem, 08=Bonificación, 09=Disminución cantidad, 10=Otros conceptos, 11=Ajustes de operaciones exportación, 13=Ajustes de intereses, comisiones.';

-- ── 3. Cambiar UNIQUE de solo (tipo_comprobante) a (tipo_comprobante, serie)
-- Original: solo permitía 1 serie por tipo. Ahora permite múltiples series activas o inactivas.
ALTER TABLE series_correlativos DROP CONSTRAINT IF EXISTS series_correlativos_tipo_comprobante_key;
ALTER TABLE series_correlativos ADD CONSTRAINT uniq_tipo_serie UNIQUE (tipo_comprobante, serie);

-- ── 4. Preparar nuevas series F002/B002/T002/FC02 (activas=false)
-- Vaneza las autoriza en SUNAT y luego activa cambiando activo=true
INSERT INTO series_correlativos (tipo_comprobante, serie, correlativo_actual, padding_digitos, activo) VALUES
  ('factura', 'F002', 0, 8, false),
  ('boleta', 'B002', 0, 8, false),
  ('nota_pedido_interna', 'T002', 0, 8, false),
  ('nota_credito', 'FC02', 0, 8, false)
ON CONFLICT (tipo_comprobante, serie) DO NOTHING;

-- ── 5. Modificar siguiente_correlativo para respetar series activas
-- (si hay 2+ series activas del mismo tipo, se elige la MÁS RECIENTE con activo)
CREATE OR REPLACE FUNCTION siguiente_correlativo(p_tipo tipo_comprobante)
RETURNS TABLE(serie TEXT, numero TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_serie TEXT;
  v_correlativo INT;
  v_padding INT;
BEGIN
  -- Advisory lock por tipo de comprobante
  PERFORM pg_advisory_xact_lock(('x'||substr(md5(p_tipo::text), 1, 15))::bit(60)::bigint);

  -- Serie activa más recientemente actualizada
  SELECT id, series_correlativos.serie, correlativo_actual, padding_digitos
  INTO v_id, v_serie, v_correlativo, v_padding
  FROM series_correlativos
  WHERE tipo_comprobante::text = p_tipo::text AND activo = TRUE
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No hay serie activa para el tipo %', p_tipo;
  END IF;

  v_correlativo := v_correlativo + 1;
  UPDATE series_correlativos SET correlativo_actual = v_correlativo, updated_at = NOW()
    WHERE id = v_id;

  RETURN QUERY SELECT v_serie, LPAD(v_correlativo::text, v_padding, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION siguiente_correlativo TO authenticated;

-- ── 5. RPC para emitir Nota de Crédito
CREATE OR REPLACE FUNCTION emitir_nota_credito(
  p_comprobante_original_id UUID,
  p_motivo_sunat TEXT,               -- código catálogo 09 SUNAT
  p_items JSONB,                     -- [{producto_id, cantidad, precio_unitario, subtotal, descripcion}]
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

  -- Numeración de NC
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
    'nota_credito', v_serie, v_numero::INT,
    v_original.pedido_id, v_original.cliente_id, v_user,
    CURRENT_DATE, v_subtotal, v_igv, v_total,
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
    v_numero_asiento, CURRENT_DATE,
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

GRANT EXECUTE ON FUNCTION emitir_nota_credito TO authenticated;

-- ── 6. Vista útil: comprobantes con sus notas de crédito
CREATE OR REPLACE VIEW v_comprobantes_con_nc AS
SELECT
  c.id, c.tipo, c.serie, c.numero, c.fecha_emision, c.total, c.estado,
  c.cliente_id, c.cliente_externo_nombre,
  COALESCE(SUM(nc.total), 0) AS total_notas_credito,
  COUNT(nc.id) AS cantidad_notas_credito
FROM comprobantes c
LEFT JOIN comprobantes nc ON nc.referencia_comprobante_id = c.id AND nc.tipo = 'nota_credito' AND nc.estado <> 'anulado'
WHERE c.tipo IN ('factura', 'boleta')
GROUP BY c.id;

GRANT SELECT ON v_comprobantes_con_nc TO authenticated;
