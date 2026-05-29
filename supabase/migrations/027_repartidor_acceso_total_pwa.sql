-- Migración 027: Repartidor también tiene acceso total a la PWA
--
-- Reportado en reunión con cliente (continuación): tanto vendedor como
-- repartidor deben poder usar TODA la interfaz de la PWA (pedidos,
-- clientes, cobros, check-in).
--
-- Antes el repartidor estaba limitado: no podía crear pedidos, ni
-- insertar items, ni crear clientes nuevos en campo.

-- pedidos: repartidor puede insertar
DROP POLICY IF EXISTS pedidos_insert ON pedidos;
CREATE POLICY pedidos_insert ON pedidos
  FOR INSERT WITH CHECK (
    has_role(VARIADIC ARRAY['gerente', 'administrador', 'facturador', 'vendedor', 'repartidor'])
  );

-- pedidos: repartidor puede actualizar sus pedidos en borrador/enviado
DROP POLICY IF EXISTS pedidos_update ON pedidos;
CREATE POLICY pedidos_update ON pedidos
  FOR UPDATE USING (
    has_role(VARIADIC ARRAY['gerente', 'administrador', 'facturador'])
    OR (
      has_role(VARIADIC ARRAY['vendedor', 'repartidor'])
      AND vendedor_id = auth.uid()
      AND estado = ANY (ARRAY['borrador'::estado_pedido, 'enviado'::estado_pedido])
    )
  );

-- pedidos_items: repartidor puede escribir items en sus pedidos
DROP POLICY IF EXISTS pedidos_items_write ON pedidos_items;
CREATE POLICY pedidos_items_write ON pedidos_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM pedidos p
      WHERE p.id = pedidos_items.pedido_id
        AND (
          has_role(VARIADIC ARRAY['gerente', 'administrador', 'facturador'])
          OR (has_role(VARIADIC ARRAY['vendedor', 'repartidor']) AND p.vendedor_id = auth.uid())
        )
    )
  );

-- clientes: repartidor puede crear clientes (caso real: descubre un cliente nuevo en campo)
DROP POLICY IF EXISTS clientes_insert_admin_vendedor ON clientes;
CREATE POLICY clientes_insert_admin_vendedor ON clientes
  FOR INSERT WITH CHECK (
    has_role(VARIADIC ARRAY['gerente', 'administrador', 'vendedor', 'repartidor'])
  );

-- clientes: repartidor puede actualizar los suyos (los que él creó)
DROP POLICY IF EXISTS clientes_update_admin ON clientes;
CREATE POLICY clientes_update_admin ON clientes
  FOR UPDATE USING (
    has_role(VARIADIC ARRAY['gerente', 'administrador'])
    OR (has_role(VARIADIC ARRAY['vendedor', 'repartidor']) AND vendedor_id = auth.uid())
  );
