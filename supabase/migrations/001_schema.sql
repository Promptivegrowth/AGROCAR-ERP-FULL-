-- =============================================================================
-- AGROCAR ERP - Schema principal
-- Empresa: AGROCAR SRL - Distribuidora de embutidos - Perú
-- Migración: 001_schema.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- EXTENSIONES
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- búsqueda difusa en texto

-- =============================================================================
-- TIPOS ENUM
-- =============================================================================

CREATE TYPE user_role AS ENUM (
  'gerente',
  'administrador',
  'facturador',
  'almacenero',
  'vendedor',
  'repartidor',
  'contador'
);

CREATE TYPE estado_cliente AS ENUM (
  'activo',
  'inactivo',
  'deudor',
  'de_baja'
);

CREATE TYPE tipo_cliente AS ENUM (
  'consumidor_final',
  'tienda'
);

CREATE TYPE estado_pedido AS ENUM (
  'borrador',
  'enviado',
  'validado',
  'facturado',
  'despachado',
  'entregado',
  'cancelado'
);

CREATE TYPE tipo_comprobante AS ENUM (
  'factura',
  'boleta',
  'nota_pedido_interna'
);

CREATE TYPE estado_comprobante AS ENUM (
  'emitido',
  'enviado_sunat',
  'aceptado',
  'rechazado',
  'anulado'
);

CREATE TYPE estado_orden_compra AS ENUM (
  'borrador',
  'enviado',
  'recibido',
  'cancelado'
);

CREATE TYPE estado_despacho AS ENUM (
  'preparacion',
  'en_ruta',
  'completado',
  'cancelado'
);

CREATE TYPE estado_despacho_item AS ENUM (
  'pendiente',
  'entregado',
  'rechazado'
);

CREATE TYPE tipo_movimiento_stock AS ENUM (
  'entrada',
  'salida',
  'ajuste',
  'devolucion'
);

CREATE TYPE tipo_vehiculo AS ENUM (
  'zona',
  'auxiliar'
);

CREATE TYPE metodo_valorizacion AS ENUM (
  'promedio',
  'fifo',
  'directo'
);

CREATE TYPE moneda AS ENUM (
  'PEN',
  'USD'
);

CREATE TYPE estado_caja_sesion AS ENUM (
  'abierta',
  'cerrada'
);

CREATE TYPE tipo_gps_checkin AS ENUM (
  'entrada',
  'salida',
  'visita_sin_compra'
);

CREATE TYPE tipo_cobro AS ENUM (
  'venta',
  'cobranza'
);

CREATE TYPE tipo_caja_movimiento AS ENUM (
  'ingreso',
  'egreso'
);

CREATE TYPE categoria_caja_movimiento AS ENUM (
  'cobro_cliente',
  'pago_planilla',
  'prestamo_empleado',
  'otro'
);

CREATE TYPE lista_precio_nombre AS ENUM (
  'A',
  'B',
  'C'
);

-- =============================================================================
-- TABLA: zonas
-- =============================================================================

CREATE TABLE zonas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT zonas_nombre_unique UNIQUE (nombre)
);

COMMENT ON TABLE zonas IS 'Zonas geográficas de distribución';

-- =============================================================================
-- TABLA: profiles  (extiende auth.users de Supabase)
-- =============================================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  role        user_role NOT NULL DEFAULT 'vendedor',
  zona_id     UUID REFERENCES zonas(id) ON DELETE SET NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_url  TEXT,
  telefono    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT profiles_email_unique UNIQUE (email)
);

COMMENT ON TABLE profiles IS 'Perfiles de usuario del ERP (extiende auth.users)';
COMMENT ON COLUMN profiles.role IS 'Rol del usuario: gerente, administrador, facturador, almacenero, vendedor, repartidor, contador';

-- =============================================================================
-- TABLA: familias  (marcas de embutidos)
-- =============================================================================

CREATE TABLE familias (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT familias_nombre_unique UNIQUE (nombre)
);

COMMENT ON TABLE familias IS 'Marcas / familias de productos: Cascajo, Centros Carnes AQP, Cerdena, Delis Embutidas, Industrias TH, Napolitano, Talas';

-- =============================================================================
-- TABLA: unidades_medida
-- =============================================================================

CREATE TABLE unidades_medida (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre  TEXT NOT NULL,
  simbolo TEXT NOT NULL,
  activo  BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT unidades_medida_nombre_unique UNIQUE (nombre),
  CONSTRAINT unidades_medida_simbolo_unique UNIQUE (simbolo)
);

COMMENT ON TABLE unidades_medida IS 'Unidades de medida: Moldes (Mld), Unidades (Und), Kilogramos (Kg)';

-- =============================================================================
-- TABLA: listas_precio
-- =============================================================================

CREATE TABLE listas_precio (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      lista_precio_nombre NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT listas_precio_nombre_unique UNIQUE (nombre)
);

COMMENT ON TABLE listas_precio IS 'Listas de precio: A (mayor), B (intermedio), C (consumidor)';

-- =============================================================================
-- TABLA: proveedores
-- =============================================================================

CREATE TABLE proveedores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  razon_social TEXT NOT NULL,
  ruc          TEXT,
  direccion    TEXT,
  telefono     TEXT,
  email        TEXT,
  contacto     TEXT,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT proveedores_ruc_unique UNIQUE (ruc)
);

COMMENT ON TABLE proveedores IS 'Proveedores de productos';

-- =============================================================================
-- TABLA: productos
-- =============================================================================

CREATE TABLE productos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo            TEXT NOT NULL,
  nombre            TEXT NOT NULL,
  descripcion       TEXT,
  familia_id        UUID REFERENCES familias(id) ON DELETE SET NULL,
  unidad_medida_id  UUID REFERENCES unidades_medida(id) ON DELETE SET NULL,
  tiene_lote        BOOLEAN NOT NULL DEFAULT FALSE,
  tiene_vencimiento BOOLEAN NOT NULL DEFAULT FALSE,
  tiene_percepcion  BOOLEAN NOT NULL DEFAULT FALSE,
  tasa_percepcion   NUMERIC(5,2) NOT NULL DEFAULT 2.0,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  imagen_url        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT productos_codigo_unique UNIQUE (codigo),
  CONSTRAINT productos_tasa_percepcion_positive CHECK (tasa_percepcion >= 0)
);

COMMENT ON TABLE productos IS 'Catálogo de productos (embutidos)';
COMMENT ON COLUMN productos.tasa_percepcion IS 'Porcentaje de percepción IGV, ej: 2.0 para 2%';

-- =============================================================================
-- TABLA: clientes
-- =============================================================================

CREATE TABLE clientes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo          TEXT NOT NULL,
  razon_social    TEXT NOT NULL,
  ruc             TEXT,
  dni             TEXT,
  tipo_cliente    tipo_cliente NOT NULL DEFAULT 'tienda',
  lista_precio_id UUID REFERENCES listas_precio(id) ON DELETE SET NULL,
  zona_id         UUID REFERENCES zonas(id) ON DELETE SET NULL,
  vendedor_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  direccion       TEXT,
  telefono        TEXT,
  email           TEXT,
  contacto        TEXT,
  credito_dias    INTEGER NOT NULL DEFAULT 0,
  credito_limite  NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado          estado_cliente NOT NULL DEFAULT 'activo',
  latitud         DOUBLE PRECISION,
  longitud        DOUBLE PRECISION,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT clientes_codigo_unique UNIQUE (codigo),
  CONSTRAINT clientes_ruc_unique UNIQUE (ruc),
  CONSTRAINT clientes_credito_dias_positive CHECK (credito_dias >= 0),
  CONSTRAINT clientes_credito_limite_positive CHECK (credito_limite >= 0)
);

COMMENT ON TABLE clientes IS 'Clientes de AGROCAR SRL';
COMMENT ON COLUMN clientes.tipo_cliente IS 'consumidor_final=persona natural, tienda=negocio';

-- =============================================================================
-- TABLA: lista_precio_items
-- =============================================================================

CREATE TABLE lista_precio_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lista_precio_id UUID NOT NULL REFERENCES listas_precio(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  precio          NUMERIC(12,4) NOT NULL,
  moneda          moneda NOT NULL DEFAULT 'PEN',
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT lista_precio_items_unique UNIQUE (lista_precio_id, producto_id),
  CONSTRAINT lista_precio_items_precio_positive CHECK (precio >= 0)
);

COMMENT ON TABLE lista_precio_items IS 'Precios por producto en cada lista de precio';

-- =============================================================================
-- TABLA: lotes
-- =============================================================================

CREATE TABLE lotes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id       UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  numero_lote       TEXT NOT NULL,
  fecha_vencimiento DATE,
  cantidad_inicial  NUMERIC(12,3) NOT NULL,
  cantidad_actual   NUMERIC(12,3) NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT lotes_unique UNIQUE (producto_id, numero_lote),
  CONSTRAINT lotes_cantidad_inicial_positive CHECK (cantidad_inicial >= 0),
  CONSTRAINT lotes_cantidad_actual_positive CHECK (cantidad_actual >= 0)
);

COMMENT ON TABLE lotes IS 'Lotes de productos con control de vencimiento';

-- =============================================================================
-- TABLA: vehiculos
-- =============================================================================

CREATE TABLE vehiculos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  placa        TEXT NOT NULL,
  descripcion  TEXT,
  tipo         tipo_vehiculo NOT NULL DEFAULT 'zona',
  capacidad_kg NUMERIC(10,2),
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vehiculos_placa_unique UNIQUE (placa)
);

COMMENT ON TABLE vehiculos IS 'Vehículos de reparto';

-- =============================================================================
-- TABLA: ordenes_compra
-- =============================================================================

CREATE TABLE ordenes_compra (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero       TEXT NOT NULL,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
  estado       estado_orden_compra NOT NULL DEFAULT 'borrador',
  subtotal     NUMERIC(12,2) NOT NULL DEFAULT 0,
  igv          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda       moneda NOT NULL DEFAULT 'PEN',
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT ordenes_compra_numero_unique UNIQUE (numero),
  CONSTRAINT ordenes_compra_subtotal_positive CHECK (subtotal >= 0),
  CONSTRAINT ordenes_compra_total_positive CHECK (total >= 0)
);

COMMENT ON TABLE ordenes_compra IS 'Órdenes de compra a proveedores';

-- =============================================================================
-- TABLA: ordenes_compra_items
-- =============================================================================

CREATE TABLE ordenes_compra_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orden_compra_id UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad        NUMERIC(12,3) NOT NULL,
  precio_unitario NUMERIC(12,4) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL,

  CONSTRAINT ordenes_compra_items_cantidad_positive CHECK (cantidad > 0),
  CONSTRAINT ordenes_compra_items_precio_positive CHECK (precio_unitario >= 0)
);

COMMENT ON TABLE ordenes_compra_items IS 'Ítems de órdenes de compra';

-- =============================================================================
-- TABLA: compras
-- =============================================================================

CREATE TABLE compras (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proveedor_id             UUID NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  orden_compra_id          UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  numero_factura_proveedor TEXT,
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  metodo_valorizacion      metodo_valorizacion NOT NULL DEFAULT 'promedio',
  subtotal                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  igv                      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda                   moneda NOT NULL DEFAULT 'PEN',
  estado                   TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'anulado')),
  notas                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT compras_subtotal_positive CHECK (subtotal >= 0),
  CONSTRAINT compras_total_positive CHECK (total >= 0)
);

COMMENT ON TABLE compras IS 'Compras / recepciones de mercadería';

-- =============================================================================
-- TABLA: compras_items
-- =============================================================================

CREATE TABLE compras_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  compra_id       UUID NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  lote_id         UUID REFERENCES lotes(id) ON DELETE SET NULL,
  cantidad        NUMERIC(12,3) NOT NULL,
  precio_unitario NUMERIC(12,4) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL,

  CONSTRAINT compras_items_cantidad_positive CHECK (cantidad > 0),
  CONSTRAINT compras_items_precio_positive CHECK (precio_unitario >= 0)
);

COMMENT ON TABLE compras_items IS 'Ítems de compras';

-- =============================================================================
-- TABLA: stock
-- =============================================================================

CREATE TABLE stock (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id       UUID NOT NULL UNIQUE REFERENCES productos(id) ON DELETE CASCADE,
  cantidad          NUMERIC(12,3) NOT NULL DEFAULT 0,
  cantidad_reservada NUMERIC(12,3) NOT NULL DEFAULT 0,
  costo_promedio    NUMERIC(12,4) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT stock_cantidad_positive CHECK (cantidad >= 0),
  CONSTRAINT stock_cantidad_reservada_positive CHECK (cantidad_reservada >= 0),
  CONSTRAINT stock_costo_promedio_positive CHECK (costo_promedio >= 0)
);

COMMENT ON TABLE stock IS 'Stock actual por producto (una fila por producto)';

-- =============================================================================
-- TABLA: movimientos_stock
-- =============================================================================

CREATE TABLE movimientos_stock (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo            tipo_movimiento_stock NOT NULL,
  referencia_tipo TEXT,                            -- 'compra' | 'pedido' | 'ajuste' | 'despacho'
  referencia_id   UUID,                            -- id del documento origen
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  lote_id         UUID REFERENCES lotes(id) ON DELETE SET NULL,
  cantidad        NUMERIC(12,3) NOT NULL,           -- positivo=entrada, negativo=salida
  costo_unitario  NUMERIC(12,4),
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE movimientos_stock IS 'Kardex de movimientos de inventario';
COMMENT ON COLUMN movimientos_stock.cantidad IS 'Positivo para entradas, negativo para salidas';

-- Índice para consultas por producto
CREATE INDEX idx_movimientos_stock_producto ON movimientos_stock(producto_id);
CREATE INDEX idx_movimientos_stock_referencia ON movimientos_stock(referencia_tipo, referencia_id);
CREATE INDEX idx_movimientos_stock_created_at ON movimientos_stock(created_at DESC);

-- =============================================================================
-- TABLA: pedidos
-- =============================================================================

CREATE TABLE pedidos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero                TEXT NOT NULL,
  cliente_id            UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  vendedor_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  fecha_pedido          DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_despacho        DATE,
  estado                estado_pedido NOT NULL DEFAULT 'borrador',
  subtotal              NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento_porcentaje  NUMERIC(5,2) NOT NULL DEFAULT 0,
  descuento_monto       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda                moneda NOT NULL DEFAULT 'PEN',
  notas                 TEXT,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  requiere_autorizacion BOOLEAN NOT NULL DEFAULT FALSE,
  autorizado_por        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  autorizado_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pedidos_numero_unique UNIQUE (numero),
  CONSTRAINT pedidos_subtotal_positive CHECK (subtotal >= 0),
  CONSTRAINT pedidos_total_positive CHECK (total >= 0),
  CONSTRAINT pedidos_descuento_porcentaje_range CHECK (
    descuento_porcentaje >= 0 AND descuento_porcentaje <= 100
  )
);

COMMENT ON TABLE pedidos IS 'Pedidos de clientes';

CREATE INDEX idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX idx_pedidos_vendedor ON pedidos(vendedor_id);
CREATE INDEX idx_pedidos_estado ON pedidos(estado);
CREATE INDEX idx_pedidos_fecha ON pedidos(fecha_pedido DESC);

-- =============================================================================
-- TABLA: pedidos_items
-- =============================================================================

CREATE TABLE pedidos_items (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id            UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id          UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  lote_id              UUID REFERENCES lotes(id) ON DELETE SET NULL,
  cantidad             NUMERIC(12,3) NOT NULL,
  precio_unitario      NUMERIC(12,4) NOT NULL,
  descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0,
  subtotal             NUMERIC(12,2) NOT NULL,

  CONSTRAINT pedidos_items_cantidad_positive CHECK (cantidad > 0),
  CONSTRAINT pedidos_items_precio_positive CHECK (precio_unitario >= 0),
  CONSTRAINT pedidos_items_descuento_range CHECK (
    descuento_porcentaje >= 0 AND descuento_porcentaje <= 100
  )
);

COMMENT ON TABLE pedidos_items IS 'Ítems de pedidos';

CREATE INDEX idx_pedidos_items_pedido ON pedidos_items(pedido_id);

-- =============================================================================
-- TABLA: comprobantes
-- =============================================================================

CREATE TABLE comprobantes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo              tipo_comprobante NOT NULL,
  serie             TEXT NOT NULL,                 -- F001, B001, NP01
  numero            TEXT NOT NULL,
  pedido_id         UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  cliente_id        UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  facturador_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  igv               NUMERIC(12,2) NOT NULL DEFAULT 0,
  percepcion        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda            moneda NOT NULL DEFAULT 'PEN',
  tipo_cambio       NUMERIC(8,4),
  estado            estado_comprobante NOT NULL DEFAULT 'emitido',
  sunat_estado      TEXT,
  sunat_cdr         TEXT,                          -- CDR XML en base64 o URL
  email_enviado     BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_enviado  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT comprobantes_serie_numero_unique UNIQUE (serie, numero),
  CONSTRAINT comprobantes_subtotal_positive CHECK (subtotal >= 0),
  CONSTRAINT comprobantes_total_positive CHECK (total >= 0),
  CONSTRAINT comprobantes_percepcion_positive CHECK (percepcion >= 0)
);

COMMENT ON TABLE comprobantes IS 'Facturas, boletas y notas de pedido emitidas';

CREATE INDEX idx_comprobantes_cliente ON comprobantes(cliente_id);
CREATE INDEX idx_comprobantes_estado ON comprobantes(estado);
CREATE INDEX idx_comprobantes_fecha ON comprobantes(fecha_emision DESC);
CREATE INDEX idx_comprobantes_pedido ON comprobantes(pedido_id);

-- =============================================================================
-- TABLA: comprobantes_items
-- =============================================================================

CREATE TABLE comprobantes_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comprobante_id  UUID NOT NULL REFERENCES comprobantes(id) ON DELETE CASCADE,
  producto_id     UUID REFERENCES productos(id) ON DELETE SET NULL,
  descripcion     TEXT NOT NULL,
  cantidad        NUMERIC(12,3) NOT NULL,
  precio_unitario NUMERIC(12,4) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL,
  igv_porcentaje  NUMERIC(5,2) NOT NULL DEFAULT 18,

  CONSTRAINT comprobantes_items_cantidad_positive CHECK (cantidad > 0),
  CONSTRAINT comprobantes_items_precio_positive CHECK (precio_unitario >= 0),
  CONSTRAINT comprobantes_items_igv_range CHECK (igv_porcentaje >= 0)
);

COMMENT ON TABLE comprobantes_items IS 'Ítems de comprobantes';

-- =============================================================================
-- TABLA: notas_credito
-- =============================================================================

CREATE TABLE notas_credito (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comprobante_id  UUID NOT NULL REFERENCES comprobantes(id) ON DELETE RESTRICT,
  numero          TEXT NOT NULL,
  motivo          TEXT NOT NULL,
  monto           NUMERIC(12,2) NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'emitido' CHECK (
    estado IN ('emitido', 'aceptado', 'rechazado', 'anulado')
  ),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT notas_credito_monto_positive CHECK (monto > 0)
);

COMMENT ON TABLE notas_credito IS 'Notas de crédito vinculadas a comprobantes';

-- =============================================================================
-- TABLA: despachos
-- =============================================================================

CREATE TABLE despachos (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero         TEXT NOT NULL,
  vehiculo_id    UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  conductor_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  fecha_despacho DATE NOT NULL DEFAULT CURRENT_DATE,
  estado         estado_despacho NOT NULL DEFAULT 'preparacion',
  total_pedidos  INTEGER NOT NULL DEFAULT 0,
  total_monto    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,

  CONSTRAINT despachos_numero_unique UNIQUE (numero),
  CONSTRAINT despachos_total_pedidos_positive CHECK (total_pedidos >= 0),
  CONSTRAINT despachos_total_monto_positive CHECK (total_monto >= 0)
);

COMMENT ON TABLE despachos IS 'Órdenes de despacho / hoja de ruta';

CREATE INDEX idx_despachos_conductor ON despachos(conductor_id);
CREATE INDEX idx_despachos_estado ON despachos(estado);
CREATE INDEX idx_despachos_fecha ON despachos(fecha_despacho DESC);

-- =============================================================================
-- TABLA: despachos_items
-- =============================================================================

CREATE TABLE despachos_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  despacho_id       UUID NOT NULL REFERENCES despachos(id) ON DELETE CASCADE,
  pedido_id         UUID NOT NULL REFERENCES pedidos(id) ON DELETE RESTRICT,
  comprobante_id    UUID REFERENCES comprobantes(id) ON DELETE SET NULL,
  estado            estado_despacho_item NOT NULL DEFAULT 'pendiente',
  cobro_efectivo    NUMERIC(12,2) NOT NULL DEFAULT 0,
  cobro_yape        NUMERIC(12,2) NOT NULL DEFAULT 0,
  cobro_plin        NUMERIC(12,2) NOT NULL DEFAULT 0,
  cobro_transferencia NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas_entrega     TEXT,

  CONSTRAINT despachos_items_cobros_positive CHECK (
    cobro_efectivo >= 0 AND cobro_yape >= 0 AND cobro_plin >= 0 AND cobro_transferencia >= 0
  )
);

COMMENT ON TABLE despachos_items IS 'Pedidos incluidos en cada despacho con detalle de cobro';

-- =============================================================================
-- TABLA: cobros
-- =============================================================================

CREATE TABLE cobros (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo            tipo_cobro NOT NULL,
  referencia_id   UUID,                            -- id del pedido o comprobante
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  cobrador_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  efectivo        NUMERIC(12,2) NOT NULL DEFAULT 0,
  yape            NUMERIC(12,2) NOT NULL DEFAULT 0,
  plin            NUMERIC(12,2) NOT NULL DEFAULT 0,
  transferencia   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL,
  voucher_url     TEXT,
  notas           TEXT,
  conciliado      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cobros_total_positive CHECK (total > 0),
  CONSTRAINT cobros_montos_positive CHECK (
    efectivo >= 0 AND yape >= 0 AND plin >= 0 AND transferencia >= 0
  )
);

COMMENT ON TABLE cobros IS 'Registro de cobros a clientes (venta y cobranza)';

CREATE INDEX idx_cobros_cliente ON cobros(cliente_id);
CREATE INDEX idx_cobros_cobrador ON cobros(cobrador_id);
CREATE INDEX idx_cobros_fecha ON cobros(fecha DESC);
CREATE INDEX idx_cobros_conciliado ON cobros(conciliado);

-- =============================================================================
-- TABLA: caja_sesiones
-- =============================================================================

CREATE TABLE caja_sesiones (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cajero_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  fecha_apertura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_cierre   TIMESTAMPTZ,
  saldo_inicial  NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_final    NUMERIC(12,2),
  estado         estado_caja_sesion NOT NULL DEFAULT 'abierta',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT caja_sesiones_saldo_inicial_positive CHECK (saldo_inicial >= 0)
);

COMMENT ON TABLE caja_sesiones IS 'Sesiones de caja con apertura y cierre';

-- =============================================================================
-- TABLA: caja_movimientos
-- =============================================================================

CREATE TABLE caja_movimientos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sesion_id     UUID NOT NULL REFERENCES caja_sesiones(id) ON DELETE RESTRICT,
  tipo          tipo_caja_movimiento NOT NULL,
  categoria     categoria_caja_movimiento NOT NULL DEFAULT 'otro',
  referencia_id UUID,                              -- cobro u otro documento
  descripcion   TEXT NOT NULL,
  monto         NUMERIC(12,2) NOT NULL,
  cobrador_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT caja_movimientos_monto_positive CHECK (monto > 0)
);

COMMENT ON TABLE caja_movimientos IS 'Movimientos dentro de una sesión de caja';

CREATE INDEX idx_caja_movimientos_sesion ON caja_movimientos(sesion_id);

-- =============================================================================
-- TABLA: gps_checkins
-- =============================================================================

CREATE TABLE gps_checkins (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cliente_id       UUID REFERENCES clientes(id) ON DELETE SET NULL,
  tipo             tipo_gps_checkin NOT NULL,
  latitud          DOUBLE PRECISION NOT NULL,
  longitud         DOUBLE PRECISION NOT NULL,
  precision_metros NUMERIC(8,2),
  foto_url         TEXT,
  notas            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE gps_checkins IS 'Registro de check-in/out GPS de vendedores y repartidores';

CREATE INDEX idx_gps_checkins_usuario ON gps_checkins(usuario_id);
CREATE INDEX idx_gps_checkins_cliente ON gps_checkins(cliente_id);
CREATE INDEX idx_gps_checkins_created_at ON gps_checkins(created_at DESC);

-- =============================================================================
-- TABLA: gps_ubicaciones (tracking continuo)
-- =============================================================================

CREATE TABLE gps_ubicaciones (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  latitud          DOUBLE PRECISION NOT NULL,
  longitud         DOUBLE PRECISION NOT NULL,
  precision_metros NUMERIC(8,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE gps_ubicaciones IS 'Tracking GPS continuo de usuarios en campo';

CREATE INDEX idx_gps_ubicaciones_usuario ON gps_ubicaciones(usuario_id);
CREATE INDEX idx_gps_ubicaciones_created_at ON gps_ubicaciones(created_at DESC);

-- Política de retención: se recomienda purgar registros > 30 días con pg_cron
-- DELETE FROM gps_ubicaciones WHERE created_at < NOW() - INTERVAL '30 days';

-- =============================================================================
-- TABLA: tipo_cambio
-- =============================================================================

CREATE TABLE tipo_cambio (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha      DATE NOT NULL,
  compra     NUMERIC(8,4) NOT NULL,
  venta      NUMERIC(8,4) NOT NULL,
  fuente     TEXT DEFAULT 'SBS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tipo_cambio_fecha_unique UNIQUE (fecha),
  CONSTRAINT tipo_cambio_compra_positive CHECK (compra > 0),
  CONSTRAINT tipo_cambio_venta_positive CHECK (venta > 0)
);

COMMENT ON TABLE tipo_cambio IS 'Tipo de cambio USD/PEN diario (fuente SBS o manual)';

-- =============================================================================
-- TABLA: comisiones_reglas
-- =============================================================================

CREATE TABLE comisiones_reglas (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id      UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL = todos los vendedores
  familia_id       UUID REFERENCES familias(id) ON DELETE CASCADE,  -- NULL = todas las familias
  porcentaje       NUMERIC(5,2),
  monto_fijo       NUMERIC(12,4),
  objetivo_mensual NUMERIC(12,2),
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT comisiones_reglas_tiene_comision CHECK (
    porcentaje IS NOT NULL OR monto_fijo IS NOT NULL
  ),
  CONSTRAINT comisiones_reglas_porcentaje_range CHECK (
    porcentaje IS NULL OR (porcentaje >= 0 AND porcentaje <= 100)
  )
);

COMMENT ON TABLE comisiones_reglas IS 'Reglas de comisión por vendedor y/o familia de producto';

-- =============================================================================
-- TABLA: configuracion
-- =============================================================================

CREATE TABLE configuracion (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clave       TEXT NOT NULL,
  valor       TEXT NOT NULL,
  descripcion TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT configuracion_clave_unique UNIQUE (clave)
);

COMMENT ON TABLE configuracion IS 'Parámetros de configuración del sistema';

-- =============================================================================
-- VISTAS
-- =============================================================================

CREATE OR REPLACE VIEW v_stock_disponible AS
SELECT
  s.producto_id,
  p.codigo,
  p.nombre,
  f.nombre   AS familia,
  um.simbolo AS unidad,
  s.cantidad,
  s.cantidad_reservada,
  (s.cantidad - s.cantidad_reservada) AS disponible,
  s.costo_promedio
FROM stock s
JOIN productos p  ON p.id = s.producto_id
LEFT JOIN familias f ON f.id = p.familia_id
LEFT JOIN unidades_medida um ON um.id = p.unidad_medida_id
WHERE p.activo = TRUE;

COMMENT ON VIEW v_stock_disponible IS 'Stock disponible por producto (cantidad - reservada)';

CREATE OR REPLACE VIEW v_pedidos_resumen AS
SELECT
  p.id,
  p.numero,
  c.razon_social AS cliente,
  pr.full_name   AS vendedor,
  p.fecha_pedido,
  p.estado,
  p.total,
  p.moneda,
  COUNT(pi.id)   AS items_count
FROM pedidos p
JOIN clientes c    ON c.id = p.cliente_id
LEFT JOIN profiles pr ON pr.id = p.vendedor_id
LEFT JOIN pedidos_items pi ON pi.pedido_id = p.id
GROUP BY p.id, c.razon_social, pr.full_name;

COMMENT ON VIEW v_pedidos_resumen IS 'Resumen de pedidos con cliente y vendedor';

-- =============================================================================
-- FUNCIONES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Función: get_stock_disponible
-- Retorna la cantidad disponible (cantidad - cantidad_reservada) de un producto
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_stock_disponible(p_producto_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_disponible NUMERIC;
BEGIN
  SELECT COALESCE(cantidad, 0) - COALESCE(cantidad_reservada, 0)
  INTO   v_disponible
  FROM   stock
  WHERE  producto_id = p_producto_id;

  RETURN COALESCE(v_disponible, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_stock_disponible IS
  'Retorna la cantidad disponible de un producto (cantidad - cantidad_reservada). '
  'Retorna 0 si el producto no tiene registro de stock.';

-- ---------------------------------------------------------------------------
-- Función: get_precio_producto
-- Retorna el precio vigente de un producto en una lista de precio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_precio_producto(
  p_producto_id     UUID,
  p_lista_precio_id UUID
)
RETURNS NUMERIC AS $$
DECLARE
  v_precio NUMERIC;
BEGIN
  SELECT precio
  INTO   v_precio
  FROM   lista_precio_items
  WHERE  producto_id     = p_producto_id
    AND  lista_precio_id = p_lista_precio_id
    AND  activo          = TRUE
  LIMIT 1;

  RETURN v_precio;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_precio_producto IS
  'Retorna el precio de un producto en la lista indicada. '
  'Retorna NULL si no existe precio configurado.';

-- ---------------------------------------------------------------------------
-- Función: handle_new_user
-- Trigger que crea un profile automáticamente al registrar un usuario en auth.users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'vendedor')
  )
  ON CONFLICT (id) DO UPDATE SET
    email      = EXCLUDED.email,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION handle_new_user IS
  'Trigger function: crea automáticamente el perfil cuando se registra un usuario. '
  'Lee full_name y role desde raw_user_meta_data si están disponibles.';

-- Trigger en auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- Función: update_updated_at_column
-- Trigger genérico para actualizar updated_at automáticamente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers updated_at
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_productos_updated_at
  BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_ordenes_compra_updated_at
  BEFORE UPDATE ON ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_pedidos_updated_at
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_stock_updated_at
  BEFORE UPDATE ON stock
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_lista_precio_items_updated_at
  BEFORE UPDATE ON lista_precio_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_configuracion_updated_at
  BEFORE UPDATE ON configuracion
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE familias          ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades_medida   ENABLE ROW LEVEL SECURITY;
ALTER TABLE listas_precio     ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_precio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiculos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_compra_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras           ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock             ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobantes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobantes_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_credito     ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobros            ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_sesiones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_movimientos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_checkins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_ubicaciones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipo_cambio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE comisiones_reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Función helper: obtiene el rol del usuario autenticado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_role()
RETURNS TEXT AS $$
  SELECT role::TEXT
  FROM   public.profiles
  WHERE  id = auth.uid()
  LIMIT  1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Función helper: comprueba si el usuario tiene uno de los roles indicados
CREATE OR REPLACE FUNCTION has_role(VARIADIC roles TEXT[])
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id   = auth.uid()
      AND role::TEXT = ANY(roles)
      AND activo = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- POLÍTICAS RLS
-- =============================================================================

-- ── profiles ─────────────────────────────────────────────────────────────────

-- El usuario puede ver y editar su propio perfil
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid() OR has_role('gerente', 'administrador'));

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid() OR has_role('gerente', 'administrador'));

CREATE POLICY "profiles_insert_admin" ON profiles
  FOR INSERT WITH CHECK (has_role('gerente', 'administrador'));

CREATE POLICY "profiles_delete_admin" ON profiles
  FOR DELETE USING (has_role('gerente', 'administrador'));

-- ── Tablas de catálogo: lectura para todos los roles autenticados ─────────────

-- zonas
CREATE POLICY "zonas_select_all" ON zonas
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "zonas_write_admin" ON zonas
  FOR ALL USING (has_role('gerente', 'administrador'));

-- familias
CREATE POLICY "familias_select_all" ON familias
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "familias_write_admin" ON familias
  FOR ALL USING (has_role('gerente', 'administrador'));

-- unidades_medida
CREATE POLICY "unidades_medida_select_all" ON unidades_medida
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "unidades_medida_write_admin" ON unidades_medida
  FOR ALL USING (has_role('gerente', 'administrador'));

-- listas_precio
CREATE POLICY "listas_precio_select_all" ON listas_precio
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "listas_precio_write_admin" ON listas_precio
  FOR ALL USING (has_role('gerente', 'administrador'));

-- lista_precio_items
CREATE POLICY "lista_precio_items_select_all" ON lista_precio_items
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "lista_precio_items_write_admin" ON lista_precio_items
  FOR ALL USING (has_role('gerente', 'administrador'));

-- productos
CREATE POLICY "productos_select_all" ON productos
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "productos_write_admin_almacen" ON productos
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

-- lotes
CREATE POLICY "lotes_select_all" ON lotes
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "lotes_write_admin_almacen" ON lotes
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

-- vehiculos
CREATE POLICY "vehiculos_select_all" ON vehiculos
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "vehiculos_write_admin" ON vehiculos
  FOR ALL USING (has_role('gerente', 'administrador'));

-- proveedores
CREATE POLICY "proveedores_select_all" ON proveedores
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "proveedores_write_admin_almacen" ON proveedores
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

-- tipo_cambio
CREATE POLICY "tipo_cambio_select_all" ON tipo_cambio
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "tipo_cambio_write_admin" ON tipo_cambio
  FOR ALL USING (has_role('gerente', 'administrador', 'contador'));

-- configuracion
CREATE POLICY "configuracion_select_all" ON configuracion
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "configuracion_write_admin" ON configuracion
  FOR ALL USING (has_role('gerente', 'administrador'));

-- ── clientes ─────────────────────────────────────────────────────────────────
-- Gerente/Admin: todo | Vendedor: solo sus clientes | Resto: lectura

CREATE POLICY "clientes_select_admin" ON clientes
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'almacenero', 'contador')
    OR (has_role('vendedor') AND vendedor_id = auth.uid())
    OR has_role('repartidor')
  );

CREATE POLICY "clientes_insert_admin_vendedor" ON clientes
  FOR INSERT WITH CHECK (has_role('gerente', 'administrador', 'vendedor'));

CREATE POLICY "clientes_update_admin" ON clientes
  FOR UPDATE USING (
    has_role('gerente', 'administrador')
    OR (has_role('vendedor') AND vendedor_id = auth.uid())
  );

CREATE POLICY "clientes_delete_admin" ON clientes
  FOR DELETE USING (has_role('gerente', 'administrador'));

-- ── stock ─────────────────────────────────────────────────────────────────────

CREATE POLICY "stock_select_all" ON stock
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "stock_write_almacen" ON stock
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

-- ── movimientos_stock ─────────────────────────────────────────────────────────

CREATE POLICY "movimientos_stock_select" ON movimientos_stock
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'almacenero', 'contador')
  );

CREATE POLICY "movimientos_stock_insert_almacen" ON movimientos_stock
  FOR INSERT WITH CHECK (has_role('gerente', 'administrador', 'almacenero'));

CREATE POLICY "movimientos_stock_update_admin" ON movimientos_stock
  FOR UPDATE USING (has_role('gerente', 'administrador'));

-- ── ordenes_compra ────────────────────────────────────────────────────────────

CREATE POLICY "ordenes_compra_select" ON ordenes_compra
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'almacenero', 'contador')
  );

CREATE POLICY "ordenes_compra_write_almacen" ON ordenes_compra
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

CREATE POLICY "ordenes_compra_items_select" ON ordenes_compra_items
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'almacenero', 'contador')
  );

CREATE POLICY "ordenes_compra_items_write_almacen" ON ordenes_compra_items
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

-- ── compras ───────────────────────────────────────────────────────────────────

CREATE POLICY "compras_select" ON compras
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'almacenero', 'contador')
  );

CREATE POLICY "compras_write_almacen" ON compras
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

CREATE POLICY "compras_items_select" ON compras_items
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'almacenero', 'contador')
  );

CREATE POLICY "compras_items_write_almacen" ON compras_items
  FOR ALL USING (has_role('gerente', 'administrador', 'almacenero'));

-- ── pedidos ───────────────────────────────────────────────────────────────────

CREATE POLICY "pedidos_select" ON pedidos
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'almacenero', 'contador')
    OR (has_role('vendedor') AND vendedor_id = auth.uid())
    OR has_role('repartidor')
  );

CREATE POLICY "pedidos_insert" ON pedidos
  FOR INSERT WITH CHECK (
    has_role('gerente', 'administrador', 'facturador', 'vendedor')
  );

CREATE POLICY "pedidos_update" ON pedidos
  FOR UPDATE USING (
    has_role('gerente', 'administrador', 'facturador')
    OR (has_role('vendedor') AND vendedor_id = auth.uid() AND estado IN ('borrador', 'enviado'))
  );

CREATE POLICY "pedidos_delete_admin" ON pedidos
  FOR DELETE USING (has_role('gerente', 'administrador'));

-- pedidos_items: hereda acceso del pedido padre
CREATE POLICY "pedidos_items_select" ON pedidos_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM pedidos p
      WHERE  p.id = pedido_id
        AND (
          has_role('gerente', 'administrador', 'facturador', 'almacenero', 'contador')
          OR (has_role('vendedor') AND p.vendedor_id = auth.uid())
          OR has_role('repartidor')
        )
    )
  );

CREATE POLICY "pedidos_items_write" ON pedidos_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM pedidos p
      WHERE  p.id = pedido_id
        AND (
          has_role('gerente', 'administrador', 'facturador')
          OR (has_role('vendedor') AND p.vendedor_id = auth.uid())
        )
    )
  );

-- ── comprobantes ──────────────────────────────────────────────────────────────

CREATE POLICY "comprobantes_select" ON comprobantes
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'contador')
    OR has_role('repartidor')
  );

CREATE POLICY "comprobantes_insert_facturador" ON comprobantes
  FOR INSERT WITH CHECK (
    has_role('gerente', 'administrador', 'facturador')
  );

CREATE POLICY "comprobantes_update_facturador" ON comprobantes
  FOR UPDATE USING (
    has_role('gerente', 'administrador', 'facturador')
  );

CREATE POLICY "comprobantes_delete_admin" ON comprobantes
  FOR DELETE USING (has_role('gerente', 'administrador'));

CREATE POLICY "comprobantes_items_select" ON comprobantes_items
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'contador', 'repartidor')
  );

CREATE POLICY "comprobantes_items_write_facturador" ON comprobantes_items
  FOR ALL USING (has_role('gerente', 'administrador', 'facturador'));

-- notas_credito
CREATE POLICY "notas_credito_select" ON notas_credito
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'contador')
  );

CREATE POLICY "notas_credito_write_facturador" ON notas_credito
  FOR ALL USING (has_role('gerente', 'administrador', 'facturador'));

-- ── despachos ─────────────────────────────────────────────────────────────────

CREATE POLICY "despachos_select" ON despachos
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador')
    OR (has_role('repartidor') AND conductor_id = auth.uid())
  );

CREATE POLICY "despachos_write_facturador" ON despachos
  FOR ALL USING (has_role('gerente', 'administrador', 'facturador'));

CREATE POLICY "despachos_items_select" ON despachos_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM despachos d
      WHERE  d.id = despacho_id
        AND (
          has_role('gerente', 'administrador', 'facturador')
          OR (has_role('repartidor') AND d.conductor_id = auth.uid())
        )
    )
  );

CREATE POLICY "despachos_items_write" ON despachos_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM despachos d
      WHERE  d.id = despacho_id
        AND (
          has_role('gerente', 'administrador', 'facturador')
          OR (has_role('repartidor') AND d.conductor_id = auth.uid())
        )
    )
  );

-- ── cobros ────────────────────────────────────────────────────────────────────

CREATE POLICY "cobros_select" ON cobros
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'contador')
    OR (has_role('vendedor', 'repartidor') AND cobrador_id = auth.uid())
  );

CREATE POLICY "cobros_insert" ON cobros
  FOR INSERT WITH CHECK (
    has_role('gerente', 'administrador', 'facturador', 'vendedor', 'repartidor')
  );

CREATE POLICY "cobros_update_admin" ON cobros
  FOR UPDATE USING (
    has_role('gerente', 'administrador', 'contador')
  );

CREATE POLICY "cobros_delete_admin" ON cobros
  FOR DELETE USING (has_role('gerente', 'administrador'));

-- ── caja_sesiones ─────────────────────────────────────────────────────────────

CREATE POLICY "caja_sesiones_select" ON caja_sesiones
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'contador')
    OR cajero_id = auth.uid()
  );

CREATE POLICY "caja_sesiones_write" ON caja_sesiones
  FOR ALL USING (
    has_role('gerente', 'administrador', 'facturador')
    OR cajero_id = auth.uid()
  );

-- ── caja_movimientos ──────────────────────────────────────────────────────────

CREATE POLICY "caja_movimientos_select" ON caja_movimientos
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'facturador', 'contador')
    OR EXISTS (
      SELECT 1 FROM caja_sesiones cs
      WHERE cs.id = sesion_id AND cs.cajero_id = auth.uid()
    )
  );

CREATE POLICY "caja_movimientos_write" ON caja_movimientos
  FOR ALL USING (
    has_role('gerente', 'administrador', 'facturador')
    OR EXISTS (
      SELECT 1 FROM caja_sesiones cs
      WHERE cs.id = sesion_id AND cs.cajero_id = auth.uid()
    )
  );

-- ── gps_checkins ──────────────────────────────────────────────────────────────

CREATE POLICY "gps_checkins_select" ON gps_checkins
  FOR SELECT USING (
    has_role('gerente', 'administrador')
    OR usuario_id = auth.uid()
  );

CREATE POLICY "gps_checkins_insert" ON gps_checkins
  FOR INSERT WITH CHECK (
    usuario_id = auth.uid()
    AND has_role('gerente', 'administrador', 'vendedor', 'repartidor')
  );

-- ── gps_ubicaciones ───────────────────────────────────────────────────────────

CREATE POLICY "gps_ubicaciones_select" ON gps_ubicaciones
  FOR SELECT USING (
    has_role('gerente', 'administrador')
    OR usuario_id = auth.uid()
  );

CREATE POLICY "gps_ubicaciones_insert" ON gps_ubicaciones
  FOR INSERT WITH CHECK (
    usuario_id = auth.uid()
    AND has_role('gerente', 'administrador', 'vendedor', 'repartidor')
  );

-- ── comisiones_reglas ─────────────────────────────────────────────────────────

CREATE POLICY "comisiones_reglas_select" ON comisiones_reglas
  FOR SELECT USING (
    has_role('gerente', 'administrador', 'contador')
    OR vendedor_id = auth.uid()
  );

CREATE POLICY "comisiones_reglas_write_admin" ON comisiones_reglas
  FOR ALL USING (has_role('gerente', 'administrador'));

-- =============================================================================
-- DATOS INICIALES (SEED)
-- =============================================================================

-- ── Zonas de distribución ─────────────────────────────────────────────────────
INSERT INTO zonas (nombre, descripcion) VALUES
  ('Zona 1',  'Zona de distribución 1'),
  ('Zona 2',  'Zona de distribución 2'),
  ('Zona 3',  'Zona de distribución 3'),
  ('Zona 4',  'Zona de distribución 4'),
  ('Zona 5',  'Zona de distribución 5'),
  ('Zona 6',  'Zona de distribución 6'),
  ('Zona 7',  'Zona de distribución 7'),
  ('Zona 8',  'Zona de distribución 8'),
  ('Zona 9',  'Zona de distribución 9'),
  ('Zona 10', 'Zona de distribución 10'),
  ('Zona 11', 'Zona de distribución 11'),
  ('Zona 12', 'Zona de distribución 12')
ON CONFLICT (nombre) DO NOTHING;

-- ── Familias / Marcas ─────────────────────────────────────────────────────────
INSERT INTO familias (nombre, descripcion) VALUES
  ('Cascajo',           'Marca Cascajo - embutidos premium'),
  ('Centros Carnes AQP','Marca Centros Carnes Arequipa'),
  ('Cerdena',           'Marca Cerdena - embutidos'),
  ('Delis Embutidas',   'Marca Delis Embutidas'),
  ('Industrias TH',     'Marca Industrias TH'),
  ('Napolitano',        'Marca Napolitano'),
  ('Talas',             'Marca Talas')
ON CONFLICT (nombre) DO NOTHING;

-- ── Unidades de Medida ────────────────────────────────────────────────────────
INSERT INTO unidades_medida (nombre, simbolo) VALUES
  ('Moldes',     'Mld'),
  ('Unidades',   'Und'),
  ('Kilogramos', 'Kg')
ON CONFLICT (nombre) DO NOTHING;

-- ── Listas de Precio ──────────────────────────────────────────────────────────
INSERT INTO listas_precio (nombre, descripcion) VALUES
  ('A', 'Lista A - Precio mayorista / distribuidores grandes'),
  ('B', 'Lista B - Precio tiendas / intermedios'),
  ('C', 'Lista C - Precio consumidor final / detalle')
ON CONFLICT (nombre) DO NOTHING;

-- ── Configuración del sistema ─────────────────────────────────────────────────
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('gps_radio_checkin',   '50',    'Radio en metros para validar check-in GPS en cliente'),
  ('pedido_minimo',       '30',    'Monto mínimo de pedido en soles (PEN)'),
  ('descuento_maximo',    '2.5',   'Porcentaje máximo de descuento que puede aplicar un vendedor sin autorización'),
  ('igv_porcentaje',      '18',    'Porcentaje de IGV vigente en Perú'),
  ('percepcion_porcentaje','2.0',  'Porcentaje de percepción IGV para embutidos'),
  ('moneda_default',      'PEN',   'Moneda por defecto del sistema'),
  ('serie_factura',       'F001',  'Serie para facturas electrónicas'),
  ('serie_boleta',        'B001',  'Serie para boletas electrónicas'),
  ('empresa_ruc',         '20XXXXXXXXX', 'RUC de AGROCAR SRL'),
  ('empresa_razon_social','AGROCAR SRL','Razón social de la empresa'),
  ('empresa_direccion',   'Arequipa, Perú', 'Dirección fiscal de la empresa'),
  ('whatsapp_api_url',    '',      'URL de la API de WhatsApp para envío de comprobantes'),
  ('sunat_modo',          'beta',  'Modo SUNAT: beta o produccion')
ON CONFLICT (clave) DO UPDATE SET
  valor      = EXCLUDED.valor,
  updated_at = NOW();

COMMIT;
