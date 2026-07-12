-- ─────────────────────────────────────────────────────────────────────────────
-- 060: Anexos contables — cliente, proveedor, tercero, trabajador en partidas
--
-- Requisito de la contadora Vaneza Lipa (reunión reunión 1):
-- "las cuentas contables están amarradas algún anexo, por ejemplo, la cuenta
--  doce con clientes o la cuenta cuarenta y dos con proveedores"
--
-- Modelo:
-- 1) Nueva tabla `terceros` — DNI-only para personas que NO son clientes ni
--    proveedores (estibadores, movilidad, taxis, servicios ocasionales)
-- 2) Nuevas columnas en `asientos_partidas`:
--    - cliente_id, proveedor_id, tercero_id, trabajador_id (todas opcionales)
-- 3) Campo `anexo_tipo` en `cuentas_contables` para indicar qué tipo de anexo
--    ACEPTA cada cuenta (cliente/proveedor/tercero/trabajador/ninguno)
-- 4) Modificar RPCs de asientos automáticos para poblar cliente_id/proveedor_id
--
-- IMPORTANTE: trabajador_id es solo columna sin FK — la tabla trabajadores se
-- crea en HITO 13 (Planilla). Cuando se cree se agregará la FK.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabla terceros
CREATE TABLE IF NOT EXISTS terceros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_doc TEXT NOT NULL DEFAULT 'DNI' CHECK (tipo_doc IN ('DNI', 'CE', 'RUC', 'PASAPORTE', 'OTRO')),
  numero_doc TEXT NOT NULL,
  nombres TEXT NOT NULL,
  apellidos TEXT,
  telefono TEXT,
  direccion TEXT,
  ocupacion TEXT,          -- ej: "estibador", "conductor de taxi", "servicio de limpieza"
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_tercero_doc UNIQUE (tipo_doc, numero_doc)
);

CREATE INDEX IF NOT EXISTS idx_terceros_numero ON terceros(numero_doc);
CREATE INDEX IF NOT EXISTS idx_terceros_activo ON terceros(activo);

COMMENT ON TABLE terceros IS
  'Personas naturales que NO son ni clientes ni proveedores. Usados en Caja Chica, declaraciones juradas, servicios ocasionales.';

-- ── 2. Anexos en asientos_partidas
ALTER TABLE asientos_partidas
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id),
  ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id),
  ADD COLUMN IF NOT EXISTS tercero_id UUID REFERENCES terceros(id),
  ADD COLUMN IF NOT EXISTS trabajador_id UUID; -- FK cuando exista tabla trabajadores

CREATE INDEX IF NOT EXISTS idx_partidas_cliente ON asientos_partidas(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partidas_proveedor ON asientos_partidas(proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partidas_tercero ON asientos_partidas(tercero_id) WHERE tercero_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partidas_trabajador ON asientos_partidas(trabajador_id) WHERE trabajador_id IS NOT NULL;

-- Constraint: solo un tipo de anexo por partida (o ninguno)
ALTER TABLE asientos_partidas
  DROP CONSTRAINT IF EXISTS chk_partida_un_solo_anexo;
ALTER TABLE asientos_partidas
  ADD CONSTRAINT chk_partida_un_solo_anexo CHECK (
    (CASE WHEN cliente_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN proveedor_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN tercero_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN trabajador_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  );

-- ── 3. Anexo_tipo en cuentas_contables
ALTER TABLE cuentas_contables
  ADD COLUMN IF NOT EXISTS anexo_tipo TEXT DEFAULT 'ninguno'
    CHECK (anexo_tipo IN ('cliente', 'proveedor', 'tercero', 'trabajador', 'ninguno'));

COMMENT ON COLUMN cuentas_contables.anexo_tipo IS
  'Qué tipo de anexo REQUIERE esta cuenta cuando se hace un asiento manual. ninguno = no pide anexo.';

-- Precargar anexo_tipo según PCGE Modificado (cuentas que naturalmente llevan anexo)
UPDATE cuentas_contables SET anexo_tipo = 'cliente'
WHERE codigo IN ('1212', '1213', '1214', '141', '1411', '1412', '16', '161', '168');

UPDATE cuentas_contables SET anexo_tipo = 'proveedor'
WHERE codigo IN ('4212', '4213', '4214', '46', '469');

UPDATE cuentas_contables SET anexo_tipo = 'trabajador'
WHERE codigo IN ('41', '411', '413', '622', '627', '6271', '6273');

UPDATE cuentas_contables SET anexo_tipo = 'tercero'
WHERE codigo IN ('639', '634', '635'); -- Servicios prestados por terceros, alquileres, mantenimiento

-- ── 4. Modificar RPCs de asientos automáticos para poblar anexos

-- generar_asiento_venta: poblar cliente_id en la partida contra 1212
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
    RAISE EXCEPTION 'Falta cuenta contable: 1212, 70111 o 40111';
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
    '01'
  )
  RETURNING id INTO v_asiento_id;

  -- Partidas — con cliente_id en la partida contra 1212
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id) VALUES
    (v_asiento_id, v_cta_cxc, v_comp.total, 0, 1, v_comp.cliente_id),
    (v_asiento_id, v_cta_ventas, 0, v_comp.subtotal, 2, NULL);
  IF v_comp.igv > 0 THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_igv, 0, v_comp.igv, 3);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_venta TO authenticated;

-- generar_asiento_cobro: poblar cliente_id en la partida contra 1212
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

  -- Partida contra 1212 con cliente_id
  IF v_total_aplicado > 0 THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id)
    VALUES (v_asiento_id, v_cta_cxc, 0, v_total_aplicado, v_orden, v_cobro.cliente_id);
  END IF;
  IF v_a_cuenta > 0 AND v_cta_otros_ing IS NOT NULL THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id)
    VALUES (v_asiento_id, v_cta_otros_ing, 0, v_a_cuenta, v_orden, v_cobro.cliente_id);
  END IF;

  IF v_total_aplicado = 0 AND v_a_cuenta = 0 THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id)
    VALUES (v_asiento_id, v_cta_cxc, 0, v_cobro.total, v_orden, v_cobro.cliente_id);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_cobro TO authenticated;

-- generar_asiento_compra: poblar proveedor_id en la partida contra 4212
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
    '01'
  )
  RETURNING id INTO v_asiento_id;

  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden) VALUES
    (v_asiento_id, v_cta_compras, v_compra.subtotal, 0, 1);
  IF v_compra.igv > 0 AND v_cta_igv_cf IS NOT NULL THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden)
    VALUES (v_asiento_id, v_cta_igv_cf, v_compra.igv, 0, 2);
  END IF;
  -- Partida contra 4212 con proveedor_id
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, proveedor_id)
  VALUES (v_asiento_id, v_cta_cxp, 0, v_compra.total, 3, v_compra.proveedor_id);

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_compra TO authenticated;

-- ── 5. RPCs para mayores auxiliares por anexo

CREATE OR REPLACE FUNCTION mayor_auxiliar_cliente(p_cliente_id UUID, p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH movs AS (
    SELECT
      a.numero, a.fecha, a.glosa,
      c.codigo, c.nombre AS cuenta_nombre,
      p.debe, p.haber, p.glosa_partida
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    WHERE p.cliente_id = p_cliente_id
      AND a.fecha BETWEEN p_desde AND p_hasta
      AND a.estado = 'asentado'
    ORDER BY a.fecha, a.numero
  ),
  saldo_inicial AS (
    SELECT COALESCE(SUM(p.debe - p.haber), 0) AS saldo
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE p.cliente_id = p_cliente_id AND a.fecha < p_desde AND a.estado = 'asentado'
  )
  SELECT jsonb_build_object(
    'cliente_id', p_cliente_id,
    'cliente', (SELECT jsonb_build_object('razon_social', razon_social, 'ruc', ruc, 'dni', dni) FROM clientes WHERE id = p_cliente_id),
    'desde', p_desde, 'hasta', p_hasta,
    'saldo_inicial', (SELECT saldo FROM saldo_inicial),
    'movimientos', COALESCE(jsonb_agg(row_to_json(movs)), '[]'::jsonb),
    'total_debe', (SELECT COALESCE(SUM(debe), 0) FROM movs),
    'total_haber', (SELECT COALESCE(SUM(haber), 0) FROM movs)
  )
  FROM movs;
$$;

GRANT EXECUTE ON FUNCTION mayor_auxiliar_cliente TO authenticated;

CREATE OR REPLACE FUNCTION mayor_auxiliar_proveedor(p_proveedor_id UUID, p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH movs AS (
    SELECT
      a.numero, a.fecha, a.glosa,
      c.codigo, c.nombre AS cuenta_nombre,
      p.debe, p.haber, p.glosa_partida
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    WHERE p.proveedor_id = p_proveedor_id
      AND a.fecha BETWEEN p_desde AND p_hasta
      AND a.estado = 'asentado'
    ORDER BY a.fecha, a.numero
  ),
  saldo_inicial AS (
    SELECT COALESCE(SUM(p.haber - p.debe), 0) AS saldo
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    WHERE p.proveedor_id = p_proveedor_id AND a.fecha < p_desde AND a.estado = 'asentado'
  )
  SELECT jsonb_build_object(
    'proveedor_id', p_proveedor_id,
    'proveedor', (SELECT jsonb_build_object('razon_social', razon_social, 'ruc', ruc) FROM proveedores WHERE id = p_proveedor_id),
    'desde', p_desde, 'hasta', p_hasta,
    'saldo_inicial', (SELECT saldo FROM saldo_inicial),
    'movimientos', COALESCE(jsonb_agg(row_to_json(movs)), '[]'::jsonb),
    'total_debe', (SELECT COALESCE(SUM(debe), 0) FROM movs),
    'total_haber', (SELECT COALESCE(SUM(haber), 0) FROM movs)
  )
  FROM movs;
$$;

GRANT EXECUTE ON FUNCTION mayor_auxiliar_proveedor TO authenticated;

CREATE OR REPLACE FUNCTION mayor_auxiliar_tercero(p_tercero_id UUID, p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH movs AS (
    SELECT a.numero, a.fecha, a.glosa,
      c.codigo, c.nombre AS cuenta_nombre,
      p.debe, p.haber, p.glosa_partida
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    WHERE p.tercero_id = p_tercero_id
      AND a.fecha BETWEEN p_desde AND p_hasta
      AND a.estado = 'asentado'
    ORDER BY a.fecha, a.numero
  )
  SELECT jsonb_build_object(
    'tercero_id', p_tercero_id,
    'tercero', (SELECT jsonb_build_object('nombres', nombres, 'apellidos', apellidos, 'tipo_doc', tipo_doc, 'numero_doc', numero_doc) FROM terceros WHERE id = p_tercero_id),
    'desde', p_desde, 'hasta', p_hasta,
    'movimientos', COALESCE(jsonb_agg(row_to_json(movs)), '[]'::jsonb),
    'total_debe', (SELECT COALESCE(SUM(debe), 0) FROM movs),
    'total_haber', (SELECT COALESCE(SUM(haber), 0) FROM movs)
  )
  FROM movs;
$$;

GRANT EXECUTE ON FUNCTION mayor_auxiliar_tercero TO authenticated;

-- ── 6. RLS para terceros
ALTER TABLE terceros ENABLE ROW LEVEL SECURITY;

CREATE POLICY terceros_select ON terceros FOR SELECT USING (TRUE);
CREATE POLICY terceros_write ON terceros FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador', 'caja'])
);
