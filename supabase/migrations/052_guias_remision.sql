-- ─────────────────────────────────────────────────────────────────────────────
-- 052: Guía de Remisión Electrónica (SUNAT)
--
-- Modelo basado en la guía física que Daniel mostró:
-- - Serie T001 + correlativo numérico
-- - Fecha emisión + fecha inicio traslado + motivo
-- - Punto partida (domicilio fiscal o establecimiento anexo de AGROCAR)
-- - Punto llegada (dirección entrega)
-- - Datos destinatario (cliente registrado o externo)
-- - Bienes a transportar (items con UM, cantidad, código)
-- - Peso bruto total
-- - Modalidad traslado (Privado / Público)
-- - Datos vehículo (placa) y conductor (nombre, DNI, licencia)
-- - Vinculación opcional con comprobante (factura/boleta) que la origina
-- ─────────────────────────────────────────────────────────────────────────────

-- Enums
DO $$ BEGIN
  CREATE TYPE motivo_traslado_guia AS ENUM (
    'venta', 'compra', 'traslado_entre_establecimientos',
    'traslado_emisor_itinerante', 'importacion', 'exportacion',
    'devolucion', 'recojo_bienes', 'otros'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE modalidad_traslado_guia AS ENUM ('privado', 'publico');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_guia_remision AS ENUM ('emitida', 'anulada', 'enviada_sunat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabla principal
CREATE TABLE IF NOT EXISTS guias_remision (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serie TEXT NOT NULL DEFAULT 'T001',
  numero INT NOT NULL,
  -- Vinculación opcional con el comprobante de venta que la origina
  comprobante_id UUID REFERENCES comprobantes(id) ON DELETE SET NULL,
  -- Destinatario (cliente registrado o externo)
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_externo_nombre TEXT,
  cliente_externo_doc TEXT,
  -- Fechas
  fecha_emision TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_inicio_traslado DATE NOT NULL,
  motivo_traslado motivo_traslado_guia NOT NULL DEFAULT 'venta',
  motivo_descripcion TEXT, -- detalle libre (ej: para "otros")
  -- Direcciones (snapshot por si el cliente cambia luego)
  punto_partida TEXT NOT NULL,
  punto_llegada TEXT NOT NULL,
  ubigeo_partida TEXT,
  ubigeo_llegada TEXT,
  -- Peso
  peso_bruto_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unidad_peso TEXT NOT NULL DEFAULT 'KGM',
  -- Modalidad de traslado
  modalidad_traslado modalidad_traslado_guia NOT NULL DEFAULT 'privado',
  -- Si es Público (transporte por terceros)
  transportista_razon_social TEXT,
  transportista_ruc TEXT,
  -- Vehículo principal
  vehiculo_placa TEXT NOT NULL,
  -- Conductor
  conductor_nombre TEXT NOT NULL,
  conductor_doc TEXT NOT NULL,
  conductor_licencia TEXT,
  -- Indicadores SUNAT (todos default NO porque AGROCAR no los maneja)
  ind_traslado_total_dam BOOLEAN DEFAULT FALSE,
  ind_transbordo_programado BOOLEAN DEFAULT FALSE,
  ind_retorno_envases BOOLEAN DEFAULT FALSE,
  ind_retorno_vehiculo_vacio BOOLEAN DEFAULT FALSE,
  ind_vehiculo_categoria_m1l BOOLEAN DEFAULT FALSE,
  -- Estado
  estado estado_guia_remision NOT NULL DEFAULT 'emitida',
  enviado_sunat BOOLEAN DEFAULT FALSE,
  -- Audit
  notas TEXT,
  emisor_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT uniq_guia_serie_numero UNIQUE (serie, numero),
  CONSTRAINT chk_destinatario CHECK (
    cliente_id IS NOT NULL OR cliente_externo_nombre IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_guias_remision_fecha ON guias_remision (fecha_emision DESC);
CREATE INDEX IF NOT EXISTS idx_guias_remision_cliente ON guias_remision (cliente_id);
CREATE INDEX IF NOT EXISTS idx_guias_remision_comprobante ON guias_remision (comprobante_id);

COMMENT ON TABLE guias_remision IS
  'Guías de Remisión Electrónicas (SUNAT). Sale del módulo Facturación al confirmar despacho. Una guía puede tener o no comprobante asociado (motivo Traslado entre establecimientos no tiene comprobante).';

-- Tabla de items
CREATE TABLE IF NOT EXISTS guias_remision_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guia_id UUID NOT NULL REFERENCES guias_remision(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES productos(id) ON DELETE SET NULL,
  -- Snapshots
  codigo TEXT,
  descripcion TEXT NOT NULL,
  codigo_producto_sunat TEXT, -- opcional, catálogo SUNAT
  partida_arancelaria TEXT,    -- opcional, importación/exportación
  codigo_gtin TEXT,            -- opcional, barcode
  bien_normalizado BOOLEAN DEFAULT FALSE,
  unidad_medida TEXT NOT NULL DEFAULT 'NIU', -- NIU=unidad, KGM=kilo, LTR=litro
  cantidad NUMERIC(12, 2) NOT NULL,
  orden INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guia_items_guia ON guias_remision_items (guia_id);

-- ── Correlativo siguiente para serie de guía
CREATE OR REPLACE FUNCTION siguiente_numero_guia(p_serie TEXT DEFAULT 'T001')
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('guia_' || p_serie));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_max
    FROM guias_remision WHERE serie = p_serie;
  RETURN v_max;
END;
$$;

GRANT EXECUTE ON FUNCTION siguiente_numero_guia TO authenticated;

-- ── RPC: emitir guía desde un comprobante existente (factura/boleta)
-- Hereda items y cliente; admin completa transportista/vehículo/conductor.
CREATE OR REPLACE FUNCTION emitir_guia_desde_comprobante(
  p_comprobante_id UUID,
  p_fecha_inicio_traslado DATE,
  p_motivo_traslado TEXT DEFAULT 'venta',
  p_punto_partida TEXT DEFAULT NULL, -- si NULL usa direccion_comercial de EMPRESA
  p_punto_llegada TEXT DEFAULT NULL, -- si NULL usa cliente.direccion
  p_peso_bruto NUMERIC DEFAULT 0,
  p_vehiculo_placa TEXT DEFAULT NULL,
  p_conductor_nombre TEXT DEFAULT NULL,
  p_conductor_doc TEXT DEFAULT NULL,
  p_conductor_licencia TEXT DEFAULT NULL,
  p_modalidad TEXT DEFAULT 'privado',
  p_transportista_razon_social TEXT DEFAULT NULL,
  p_transportista_ruc TEXT DEFAULT NULL,
  p_motivo_descripcion TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_comp RECORD;
  v_guia_id UUID;
  v_numero INT;
  v_punto_partida TEXT;
  v_punto_llegada TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permiso para emitir guías de remisión';
  END IF;

  -- Validaciones de datos requeridos
  IF p_vehiculo_placa IS NULL OR LENGTH(TRIM(p_vehiculo_placa)) = 0 THEN
    RAISE EXCEPTION 'Debes ingresar la placa del vehículo';
  END IF;
  IF p_conductor_nombre IS NULL OR LENGTH(TRIM(p_conductor_nombre)) = 0 THEN
    RAISE EXCEPTION 'Debes ingresar el nombre del conductor';
  END IF;
  IF p_conductor_doc IS NULL OR LENGTH(TRIM(p_conductor_doc)) = 0 THEN
    RAISE EXCEPTION 'Debes ingresar el documento del conductor';
  END IF;

  -- Cargar comprobante con cliente
  SELECT c.*, cl.razon_social AS cli_razon, cl.direccion AS cli_direccion
    INTO v_comp
  FROM comprobantes c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  WHERE c.id = p_comprobante_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante % no existe', p_comprobante_id; END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede emitir guía de un comprobante anulado';
  END IF;

  -- Defaults para direcciones
  v_punto_partida := COALESCE(NULLIF(TRIM(p_punto_partida), ''),
    'CALLE EMILIO FORERO 553-A PARA GRANDE TACNA FUNDO PARA GRANDE PARCELA 31 SUB.LT.1 TACNA - TACNA - TACNA');
  v_punto_llegada := COALESCE(NULLIF(TRIM(p_punto_llegada), ''), v_comp.cli_direccion, 'TACNA');

  v_numero := siguiente_numero_guia('T001');

  -- Insertar la guía
  INSERT INTO guias_remision (
    serie, numero, comprobante_id, cliente_id,
    cliente_externo_nombre, cliente_externo_doc,
    fecha_emision, fecha_inicio_traslado,
    motivo_traslado, motivo_descripcion,
    punto_partida, punto_llegada,
    peso_bruto_total, unidad_peso,
    modalidad_traslado,
    transportista_razon_social, transportista_ruc,
    vehiculo_placa,
    conductor_nombre, conductor_doc, conductor_licencia,
    emisor_id
  ) VALUES (
    'T001', v_numero, p_comprobante_id, v_comp.cliente_id,
    v_comp.cliente_externo_nombre, v_comp.cliente_externo_doc,
    NOW(), p_fecha_inicio_traslado,
    p_motivo_traslado::motivo_traslado_guia,
    p_motivo_descripcion,
    v_punto_partida, v_punto_llegada,
    COALESCE(p_peso_bruto, 0), 'KGM',
    p_modalidad::modalidad_traslado_guia,
    p_transportista_razon_social, p_transportista_ruc,
    TRIM(p_vehiculo_placa),
    TRIM(p_conductor_nombre), TRIM(p_conductor_doc), TRIM(p_conductor_licencia),
    v_user_id
  )
  RETURNING id INTO v_guia_id;

  -- Copiar items del comprobante
  INSERT INTO guias_remision_items (
    guia_id, producto_id, codigo, descripcion,
    unidad_medida, cantidad, orden
  )
  SELECT
    v_guia_id,
    ci.producto_id,
    COALESCE(p.codigo, ''),
    COALESCE(TRIM(p.descripcion), p.nombre, ci.descripcion, '—'),
    'NIU', -- default unidad; admin puede ajustar después
    ci.cantidad,
    ROW_NUMBER() OVER (ORDER BY ci.id)
  FROM comprobantes_items ci
  LEFT JOIN productos p ON p.id = ci.producto_id
  WHERE ci.comprobante_id = p_comprobante_id;

  RETURN jsonb_build_object(
    'id', v_guia_id,
    'serie', 'T001',
    'numero', v_numero,
    'numero_completo', 'T001-' || LPAD(v_numero::text, 8, '0')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION emitir_guia_desde_comprobante TO authenticated;

-- RLS
ALTER TABLE guias_remision ENABLE ROW LEVEL SECURITY;
ALTER TABLE guias_remision_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY guias_select ON guias_remision FOR SELECT USING (
  has_role(VARIADIC ARRAY['gerente','administrador','facturador','contador','vendedor','repartidor'])
);
CREATE POLICY guias_insert ON guias_remision FOR INSERT WITH CHECK (
  has_role(VARIADIC ARRAY['gerente','administrador','facturador'])
);
CREATE POLICY guias_update ON guias_remision FOR UPDATE USING (
  has_role(VARIADIC ARRAY['gerente','administrador'])
);

CREATE POLICY guias_items_all ON guias_remision_items FOR ALL USING (
  has_role(VARIADIC ARRAY['gerente','administrador','facturador','contador','vendedor','repartidor'])
);
