-- ═══════════════════════════════════════════════════════════════════════════
-- 112 · El IGV sale de la configuración, no del código
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Daniel: "habilitar en configuración del sistema y series una opción para
-- cambiar el IGV, solo debe tener acceso el administrador y gerencia".
--
-- El valor ya existía: hay una fila `igv_porcentaje` = 18 en `configuracion`
-- desde el arranque del sistema. Lo que faltaba es que alguien la leyera —el 18
-- estaba escrito a mano en cada cálculo—, así que cambiarla no hacía nada.
--
-- Y el permiso también estaba: la política `configuracion_write_admin` ya
-- limita la escritura a gerente y administrador. Lo que falta es la pantalla.
--
-- Dónde estaba escrito el 18
-- --------------------------
--   recalcular_totales_pedido     ROUND(v_total - (v_total / 1.18), 2)
--   editar_comprobante_item       ROUND(v_nuevo_total - (v_nuevo_total / 1.18), 2)
--   eliminar_item_comprobante     ROUND(v_total - (v_total / 1.18), 2)
--   emitir_nota_credito           ROUND(v_subtotal * 0.18, 2)
--
-- `emitir_comprobante_atomico` no hace falta tocarla: copia el
-- `igv_porcentaje` de cada línea del pedido, que es lo correcto.
--
-- Lo que NO cambia
-- ----------------
-- Los comprobantes ya emitidos. Cada línea guarda su propio `igv_porcentaje`,
-- así que un documento de hoy sigue diciendo 18 aunque mañana la tasa cambie.
-- Eso es lo que corresponde: la tasa de un comprobante es la que regía cuando
-- se emitió, y es la que se declara a SUNAT.
--
-- El cambio de tasa aplica de ahí en adelante.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * La tasa de IGV vigente, como porcentaje: 18 significa 18%.
 *
 * Se lee de `configuracion`. Si la fila no está o tiene algo que no es un
 * número, devuelve 18: es preferible calcular con la tasa de siempre que
 * dejar de facturar por un dato mal escrito.
 *
 * `STABLE` para que Postgres la evalúe una vez por consulta y no una vez por
 * fila.
 */
CREATE OR REPLACE FUNCTION igv_vigente()
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v NUMERIC;
BEGIN
  SELECT NULLIF(TRIM(valor), '')::NUMERIC INTO v
    FROM configuracion WHERE clave = 'igv_porcentaje';

  -- Fuera de un rango sensato se ignora: una tasa negativa o del 90% no es un
  -- cambio de norma, es un error de tipeo.
  IF v IS NULL OR v < 0 OR v > 50 THEN
    RETURN 18;
  END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 18;
END;
$$;

COMMENT ON FUNCTION igv_vigente IS
  'Tasa de IGV vigente en porcentaje (18 = 18%), leida de configuracion.igv_porcentaje. Ante cualquier duda devuelve 18.';

GRANT EXECUTE ON FUNCTION igv_vigente TO authenticated, anon;

-- Que la fila exista, con su descripción al día.
INSERT INTO configuracion (clave, valor, descripcion)
VALUES ('igv_porcentaje', '18', 'Porcentaje de IGV vigente. Lo cambian solo gerencia y administracion, y aplica a los comprobantes que se emitan de ahi en adelante.')
ON CONFLICT (clave) DO UPDATE
  SET descripcion = EXCLUDED.descripcion;


-- ── Las funciones que fijaban la tasa ──────────────────────────────────────
--
-- Se reemplazan tomando su codigo actual de la base y sustituyendo solo la
-- tasa: `/ 1.18` pasa a `/ (1 + igv_vigente() / 100)`. El resto del cuerpo
-- queda identico, para que el cambio sea el que dice ser y nada mas.

CREATE OR REPLACE FUNCTION editar_comprobante_item(p_item_id uuid, p_descripcion text, p_cantidad numeric, p_precio_unitario numeric, p_nota text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_item RECORD;
  v_user_id UUID;
  v_profile RECORD;
  v_nuevo_subtotal NUMERIC;
  v_suma_items NUMERIC;
  v_nuevo_total NUMERIC;
  v_nuevo_igv NUMERIC;
  v_nuevo_subtotal_compr NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permisos para editar comprobantes (requiere administrador/gerente/facturador)';
  END IF;

  SELECT ci.*, c.id AS comp_id, c.estado, c.enviado_sunat,
         c.serie, c.numero, c.igv AS igv_compr
    INTO v_item
  FROM comprobantes_items ci
  JOIN comprobantes c ON c.id = ci.comprobante_id
  WHERE ci.id = p_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Item % no existe', p_item_id; END IF;
  IF v_item.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede editar: el comprobante ya fue enviado a SUNAT';
  END IF;
  IF v_item.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede editar un comprobante anulado';
  END IF;

  v_nuevo_subtotal := ROUND(p_cantidad * p_precio_unitario, 2);

  -- Audit log (uno por campo modificado)
  IF v_item.descripcion IS DISTINCT FROM p_descripcion THEN
    INSERT INTO comprobantes_ediciones (comprobante_id, usuario_id, usuario_nombre, usuario_rol,
      campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota)
    VALUES (v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
      'item.descripcion', v_item.descripcion, p_descripcion, p_item_id, p_descripcion, p_nota);
  END IF;
  IF v_item.cantidad IS DISTINCT FROM p_cantidad THEN
    INSERT INTO comprobantes_ediciones (comprobante_id, usuario_id, usuario_nombre, usuario_rol,
      campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota)
    VALUES (v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
      'item.cantidad', v_item.cantidad::text, p_cantidad::text, p_item_id, p_descripcion, p_nota);
  END IF;
  IF v_item.precio_unitario IS DISTINCT FROM p_precio_unitario THEN
    INSERT INTO comprobantes_ediciones (comprobante_id, usuario_id, usuario_nombre, usuario_rol,
      campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota)
    VALUES (v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
      'item.precio_unitario', v_item.precio_unitario::text, p_precio_unitario::text, p_item_id, p_descripcion, p_nota);
  END IF;

  -- Actualizar el item
  UPDATE comprobantes_items
    SET descripcion = p_descripcion,
        cantidad = p_cantidad,
        precio_unitario = p_precio_unitario,
        subtotal = v_nuevo_subtotal
  WHERE id = p_item_id;

  -- Suma de subtotales de items (estos vienen CON IGV incluido,
  -- igual que los precios de lista en AGROCAR).
  SELECT COALESCE(SUM(subtotal), 0) INTO v_suma_items
    FROM comprobantes_items WHERE comprobante_id = v_item.comp_id;

  -- FIX: desagregar IGV en lugar de sumarlo otra vez
  IF v_item.igv_compr > 0 THEN
    v_nuevo_total := v_suma_items;
    v_nuevo_igv := ROUND(v_nuevo_total - (v_nuevo_total / (1 + igv_vigente() / 100)), 2);
    v_nuevo_subtotal_compr := v_nuevo_total - v_nuevo_igv;
    UPDATE comprobantes
      SET subtotal = v_nuevo_subtotal_compr,
          igv = v_nuevo_igv,
          total = v_nuevo_total,
          editado = TRUE,
          editado_at = NOW()
    WHERE id = v_item.comp_id;
  ELSE
    UPDATE comprobantes
      SET subtotal = v_suma_items,
          igv = 0,
          total = v_suma_items,
          editado = TRUE,
          editado_at = NOW()
    WHERE id = v_item.comp_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'comprobante_id', v_item.comp_id,
    'subtotal', COALESCE(v_nuevo_subtotal_compr, v_suma_items),
    'igv', COALESCE(v_nuevo_igv, 0),
    'total', COALESCE(v_nuevo_total, v_suma_items)
  );
END;
$func$;

CREATE OR REPLACE FUNCTION eliminar_item_comprobante(p_item_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_item RECORD;
  v_count_restante INT;
  v_suma NUMERIC;
  v_total NUMERIC;
  v_igv NUMERIC;
  v_subtotal NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar lÃ­neas del comprobante';
  END IF;

  SELECT ci.*, c.id AS comp_id, c.estado, c.enviado_sunat, c.igv AS igv_compr
    INTO v_item
  FROM comprobantes_items ci
  JOIN comprobantes c ON c.id = ci.comprobante_id
  WHERE ci.id = p_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'LÃ­nea % no existe', p_item_id; END IF;
  IF v_item.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede modificar: el comprobante ya fue enviado a SUNAT';
  END IF;
  IF v_item.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede modificar un comprobante anulado';
  END IF;

  -- Validar que no sea la Ãºltima lÃ­nea
  SELECT COUNT(*) INTO v_count_restante FROM comprobantes_items
    WHERE comprobante_id = v_item.comp_id;
  IF v_count_restante <= 1 THEN
    RAISE EXCEPTION 'No se puede eliminar la Ãºnica lÃ­nea del comprobante. Si quieres dejarlo vacÃ­o, mejor ANULA el comprobante completo.';
  END IF;

  -- Audit log antes de borrar
  INSERT INTO comprobantes_ediciones (
    comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota
  ) VALUES (
    v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
    'item.eliminado',
    'cant=' || v_item.cantidad || ' precio=' || v_item.precio_unitario || ' subtotal=' || v_item.subtotal,
    'eliminado',
    p_item_id, v_item.descripcion, p_motivo
  );

  -- Borrar la lÃ­nea
  DELETE FROM comprobantes_items WHERE id = p_item_id;

  -- Recalcular totales del comprobante (misma lÃ³gica que editar_comprobante_item)
  SELECT COALESCE(SUM(subtotal), 0) INTO v_suma
    FROM comprobantes_items WHERE comprobante_id = v_item.comp_id;

  IF v_item.igv_compr > 0 THEN
    v_total := v_suma;
    v_igv := ROUND(v_total - (v_total / (1 + igv_vigente() / 100)), 2);
    v_subtotal := v_total - v_igv;
  ELSE
    v_total := v_suma;
    v_igv := 0;
    v_subtotal := v_suma;
  END IF;

  UPDATE comprobantes
    SET subtotal = v_subtotal,
        igv = v_igv,
        total = v_total,
        editado = TRUE,
        editado_at = NOW()
    WHERE id = v_item.comp_id;

  RETURN jsonb_build_object(
    'ok', true,
    'comprobante_id', v_item.comp_id,
    'lineas_restantes', v_count_restante - 1,
    'subtotal', v_subtotal,
    'igv', v_igv,
    'total', v_total
  );
END;
$func$;

CREATE OR REPLACE FUNCTION recalcular_totales_pedido(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_subtotal NUMERIC;
  v_incluir_igv BOOLEAN;
  v_descuento_pct NUMERIC;
  v_descuento_monto NUMERIC;
  v_igv NUMERIC;
  v_total NUMERIC;
BEGIN
  -- Sumar subtotales de items
  SELECT COALESCE(SUM(subtotal), 0) INTO v_subtotal
  FROM pedidos_items WHERE pedido_id = p_pedido_id;

  -- Leer config del pedido
  SELECT incluir_igv, COALESCE(descuento_porcentaje, 0) INTO v_incluir_igv, v_descuento_pct
  FROM pedidos WHERE id = p_pedido_id;

  -- Aplicar descuento
  v_descuento_monto := ROUND(v_subtotal * v_descuento_pct / 100, 2);
  v_subtotal := v_subtotal - v_descuento_monto;

  -- IGV
  IF v_incluir_igv THEN
    -- Si el subtotal venÃ­a con IGV incluido, separarlo
    -- En nuestro modelo, items.subtotal es el monto FINAL (con IGV si aplica)
    v_total := v_subtotal;
    v_igv := ROUND(v_total - (v_total / (1 + igv_vigente() / 100)), 2);
    v_subtotal := v_total - v_igv;
  ELSE
    v_igv := 0;
    v_total := v_subtotal;
  END IF;

  UPDATE pedidos
  SET subtotal = v_subtotal,
      igv = v_igv,
      descuento_monto = v_descuento_monto,
      total = v_total,
      updated_at = NOW()
  WHERE id = p_pedido_id;
END;
$func$;

-- ── La nota de credito ─────────────────────────────────────────────────────
-- Esta usaba `* 0.18` en vez de `/ 1.18`, asi que va aparte. El resto de la
-- funcion es el de la migracion 110.

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
  -- La tasa sale de la configuracion (migracion 112), no del codigo.
  v_igv := ROUND(v_subtotal * igv_vigente() / 100, 2);
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
  'Emite una nota de credito. Fecha: hoy en Lima, o la del documento que corrige si es posterior (SUNAT 2885). Correlativo con sus ocho digitos (SUNAT 1001). El IGV sale de igv_vigente().';

GRANT EXECUTE ON FUNCTION emitir_nota_credito TO authenticated;
