-- Migración 022: Soporte para venta directa desde oficina (Requerimiento C)
-- Permite emitir factura/boleta sin pasar por el flujo de vendedor de calle
-- y aceptar "Consumidor Final" sin cliente registrado.

-- 1. Pedidos: cliente y vendedor opcionales + snapshot del cliente externo
ALTER TABLE pedidos ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE pedidos ALTER COLUMN vendedor_id DROP NOT NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cliente_externo_nombre TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cliente_externo_doc TEXT;

-- 2. Comprobantes: cliente opcional + mismo snapshot
ALTER TABLE comprobantes ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS cliente_externo_nombre TEXT;
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS cliente_externo_doc TEXT;

-- 3. Garantizar que siempre haya identificación del cliente (registrado o nombre libre)
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_cliente_o_externo;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_o_externo CHECK (
  cliente_id IS NOT NULL OR cliente_externo_nombre IS NOT NULL
);

ALTER TABLE comprobantes DROP CONSTRAINT IF EXISTS comprobantes_cliente_o_externo;
ALTER TABLE comprobantes ADD CONSTRAINT comprobantes_cliente_o_externo CHECK (
  cliente_id IS NOT NULL OR cliente_externo_nombre IS NOT NULL
);

COMMENT ON COLUMN pedidos.cliente_externo_nombre IS
  'Nombre del cliente cuando no está registrado (venta directa, ej. "Consumidor Final").';
COMMENT ON COLUMN comprobantes.cliente_externo_nombre IS
  'Snapshot del nombre del cliente cuando no está registrado.';

-- 4. Cobros: también pueden ser de un consumidor final (venta al contado sin cliente registrado)
ALTER TABLE cobros ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS cliente_externo_nombre TEXT;
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS cliente_externo_doc TEXT;
ALTER TABLE cobros DROP CONSTRAINT IF EXISTS cobros_cliente_o_externo;
ALTER TABLE cobros ADD CONSTRAINT cobros_cliente_o_externo CHECK (
  cliente_id IS NOT NULL OR cliente_externo_nombre IS NOT NULL
);
