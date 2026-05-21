-- Migración 025: tipo de pago y dirección de entrega en pedidos
--
-- Permite distinguir pedidos al contado vs. a crédito y seleccionar a
-- cuál de las direcciones del cliente entregar (cuando tiene varias).

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS tipo_pago TEXT NOT NULL DEFAULT 'contado'
    CHECK (tipo_pago IN ('contado', 'credito'));

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS direccion_entrega_id UUID
    REFERENCES cliente_direcciones(id) ON DELETE SET NULL;

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS direccion_entrega_texto TEXT;

COMMENT ON COLUMN pedidos.tipo_pago IS
  'contado = se paga al despachar; credito = el cliente paga después según sus credito_dias';
COMMENT ON COLUMN pedidos.direccion_entrega_id IS
  'Dirección específica de entrega cuando el cliente tiene varias. Si NULL, usar la dirección principal del cliente.';
COMMENT ON COLUMN pedidos.direccion_entrega_texto IS
  'Snapshot textual de la dirección al momento del pedido (por si la dirección cambia o se elimina luego).';
