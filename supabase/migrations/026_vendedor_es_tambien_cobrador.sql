-- Migración 026: Vendedor también cumple rol de cobrador
--
-- Reportado en reunión con cliente: el vendedor de campo también
-- realiza cobranzas a clientes (que no necesariamente son los suyos).
-- Antes, /pwa/cobros redirigía al login al fallar las queries por
-- falta de permisos.
--
-- Cambios:
-- - comprobantes_select: agregar vendedor (necesario para ver
--   comprobantes pendientes del cliente al cobrar).
-- - clientes_select_admin: agregar vendedor sin restricción por
--   vendedor_id (el filtro de "solo sus clientes" para pedidos se
--   mantiene en frontend de /pwa/clientes y /pwa/pedidos).

DROP POLICY IF EXISTS comprobantes_select ON comprobantes;
CREATE POLICY comprobantes_select ON comprobantes
  FOR SELECT USING (
    has_role(VARIADIC ARRAY['gerente', 'administrador', 'facturador', 'contador', 'repartidor', 'vendedor'])
  );

DROP POLICY IF EXISTS clientes_select_admin ON clientes;
CREATE POLICY clientes_select_admin ON clientes
  FOR SELECT USING (
    has_role(VARIADIC ARRAY['gerente', 'administrador', 'facturador', 'almacenero', 'contador', 'repartidor', 'vendedor'])
  );

-- Nota: cobros_insert ya permitía vendedor desde antes; cobros_select
-- ya permitía vendedor ver los suyos. No requieren cambios.
