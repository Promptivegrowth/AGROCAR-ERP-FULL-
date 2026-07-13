-- ─────────────────────────────────────────────────────────────────────────────
-- 061: Centros de costos + integración con asientos + reportes
--
-- Requerimiento Vaneza (R1):
-- "También con centros de costos la contabilidad también, maneja centros
--  de costos, entonces ahí también no sé si también directamente al plan
--  de cuentas, están amarrados con centro de costos"
--
-- Diseño: tabla separada `centros_costo` — no se mete al plan de cuentas
-- (más limpio, estándar peruano). Cada partida puede tener 1 CC opcional.
-- Cada cuenta define qué CCs le pueden ser asignados (o "todos").
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabla centros_costo
CREATE TABLE IF NOT EXISTS centros_costo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL,           -- ej: "ADM", "VTA-01", "ALM"
  nombre TEXT NOT NULL,           -- ej: "Administración", "Ventas Tacna", "Almacén"
  tipo TEXT NOT NULL DEFAULT 'operativo' CHECK (tipo IN ('administrativo','ventas','produccion','logistica','operativo','general')),
  padre_id UUID REFERENCES centros_costo(id),
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_cc_codigo UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_cc_activo ON centros_costo(activo);
CREATE INDEX IF NOT EXISTS idx_cc_tipo ON centros_costo(tipo);
CREATE INDEX IF NOT EXISTS idx_cc_padre ON centros_costo(padre_id);

COMMENT ON TABLE centros_costo IS
  'Centros de costo para segmentar gastos por área/función.';

-- ── 2. Seed inicial (5 CCs típicos de distribuidora)
INSERT INTO centros_costo (codigo, nombre, tipo, descripcion) VALUES
  ('GEN',  'General',         'general',        'Movimientos generales sin asignación específica'),
  ('ADM',  'Administración',  'administrativo', 'Área administrativa, gerencia, contabilidad'),
  ('VTA',  'Ventas',          'ventas',         'Fuerza de ventas y atención al cliente'),
  ('ALM',  'Almacén',         'logistica',      'Operación de almacén, compras y despacho'),
  ('REP',  'Reparto',         'logistica',      'Reparto y entrega a clientes')
ON CONFLICT (codigo) DO NOTHING;

-- ── 3. Centro de costo en asientos_partidas
ALTER TABLE asientos_partidas
  ADD COLUMN IF NOT EXISTS centro_costo_id UUID REFERENCES centros_costo(id);

CREATE INDEX IF NOT EXISTS idx_partidas_cc ON asientos_partidas(centro_costo_id) WHERE centro_costo_id IS NOT NULL;

-- ── 4. En cuentas_contables: qué CCs le son permitidos
-- NULL = todos permitidos. Si tiene array, solo los códigos del array son válidos.
ALTER TABLE cuentas_contables
  ADD COLUMN IF NOT EXISTS centros_permitidos TEXT[];

COMMENT ON COLUMN cuentas_contables.centros_permitidos IS
  'Códigos de CCs permitidos. NULL = todos permitidos. Si no vacío, solo esos CCs pueden usarse en esta cuenta.';

-- Precargar: cuentas de gasto sugieren CC específico
UPDATE cuentas_contables SET centros_permitidos = ARRAY['ADM','VTA','ALM','REP']
WHERE clase = '6' AND es_movimiento = TRUE;

UPDATE cuentas_contables SET centros_permitidos = ARRAY['VTA']
WHERE codigo LIKE '7011%';  -- Ventas: siempre CC Ventas

-- ── 5. Poblar CC en asientos automáticos existentes según regla
-- (Sobreescribimos las RPCs para incluir CC)

CREATE OR REPLACE FUNCTION _cc_id_por_codigo(p_codigo TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM centros_costo WHERE codigo = p_codigo AND activo = TRUE LIMIT 1;
$$;

-- Ventas: CC = VTA
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

  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id, centro_costo_id) VALUES
    (v_asiento_id, v_cta_cxc, v_comp.total, 0, 1, v_comp.cliente_id, v_cc_vta),
    (v_asiento_id, v_cta_ventas, 0, v_comp.subtotal, 2, NULL, v_cc_vta);
  IF v_comp.igv > 0 THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_igv, 0, v_comp.igv, 3, v_cc_vta);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_venta TO authenticated;

-- Cobro: CC = VTA (cobranza de venta)
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
  v_cc_vta UUID;
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
  v_cc_vta := _cc_id_por_codigo('VTA');

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
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_caja, v_cobro.efectivo, 0, v_orden, v_cc_vta);
  END IF;
  IF COALESCE(v_cobro.yape, 0) + COALESCE(v_cobro.plin, 0) > 0 AND v_cta_yape IS NOT NULL THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_yape, COALESCE(v_cobro.yape, 0) + COALESCE(v_cobro.plin, 0), 0, v_orden, v_cc_vta);
  END IF;
  IF COALESCE(v_cobro.transferencia, 0) > 0 AND v_cta_bcos IS NOT NULL THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_bcos, v_cobro.transferencia, 0, v_orden, v_cc_vta);
  END IF;

  IF v_total_aplicado > 0 THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id, centro_costo_id)
    VALUES (v_asiento_id, v_cta_cxc, 0, v_total_aplicado, v_orden, v_cobro.cliente_id, v_cc_vta);
  END IF;
  IF v_a_cuenta > 0 AND v_cta_otros_ing IS NOT NULL THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id, centro_costo_id)
    VALUES (v_asiento_id, v_cta_otros_ing, 0, v_a_cuenta, v_orden, v_cobro.cliente_id, v_cc_vta);
  END IF;
  IF v_total_aplicado = 0 AND v_a_cuenta = 0 THEN
    v_orden := v_orden + 1;
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, cliente_id, centro_costo_id)
    VALUES (v_asiento_id, v_cta_cxc, 0, v_cobro.total, v_orden, v_cobro.cliente_id, v_cc_vta);
  END IF;

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_cobro TO authenticated;

-- Compra: CC = ALM (almacén)
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
  v_cc_alm UUID;
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
  v_cc_alm := _cc_id_por_codigo('ALM');

  v_numero := siguiente_numero_asiento();
  v_glosa := 'COMPRA ' || COALESCE(v_compra.numero_factura_proveedor, 'sin ref');

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado,
    referencia_tabla, referencia_id, creado_por,
    tipo_operacion_sunat
  ) VALUES (
    v_numero, v_compra.fecha, v_glosa, 'compra', 'borrador',
    'compras', p_compra_id, v_user_id, '01'
  )
  RETURNING id INTO v_asiento_id;

  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id) VALUES
    (v_asiento_id, v_cta_compras, v_compra.subtotal, 0, 1, v_cc_alm);
  IF v_compra.igv > 0 AND v_cta_igv_cf IS NOT NULL THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_igv_cf, v_compra.igv, 0, 2, v_cc_alm);
  END IF;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, proveedor_id, centro_costo_id)
  VALUES (v_asiento_id, v_cta_cxp, 0, v_compra.total, 3, v_compra.proveedor_id, v_cc_alm);

  RETURN v_asiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_asiento_compra TO authenticated;

-- ── 6. Reporte por centro de costos
CREATE OR REPLACE FUNCTION reporte_centro_costo(p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH movs AS (
    SELECT
      cc.id AS cc_id, cc.codigo, cc.nombre, cc.tipo,
      c.naturaleza,
      p.debe, p.haber
    FROM asientos_partidas p
    JOIN asientos_contables a ON a.id = p.asiento_id
    JOIN cuentas_contables c ON c.id = p.cuenta_id
    JOIN centros_costo cc ON cc.id = p.centro_costo_id
    WHERE a.fecha BETWEEN p_desde AND p_hasta
      AND a.estado = 'asentado'
      AND p.centro_costo_id IS NOT NULL
  ),
  agrupado AS (
    SELECT
      cc_id, codigo, nombre, tipo,
      SUM(debe) FILTER (WHERE naturaleza IN ('GASTO','COSTO')) AS gastos,
      SUM(haber) FILTER (WHERE naturaleza = 'INGRESO') AS ingresos
    FROM movs
    GROUP BY cc_id, codigo, nombre, tipo
  )
  SELECT jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'centros', COALESCE(jsonb_agg(jsonb_build_object(
      'cc_id', cc_id,
      'codigo', codigo,
      'nombre', nombre,
      'tipo', tipo,
      'ingresos', COALESCE(ingresos, 0),
      'gastos', COALESCE(gastos, 0),
      'resultado', COALESCE(ingresos, 0) - COALESCE(gastos, 0)
    ) ORDER BY codigo), '[]'::jsonb),
    'total_ingresos', COALESCE(SUM(ingresos), 0),
    'total_gastos', COALESCE(SUM(gastos), 0)
  ) FROM agrupado;
$$;

GRANT EXECUTE ON FUNCTION reporte_centro_costo TO authenticated;

-- ── 7. RLS
ALTER TABLE centros_costo ENABLE ROW LEVEL SECURITY;

CREATE POLICY cc_select ON centros_costo FOR SELECT USING (TRUE);
CREATE POLICY cc_write ON centros_costo FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
