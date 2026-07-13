-- ─────────────────────────────────────────────────────────────────────────────
-- 078: Permisos del rol CONTADOR — cerrar gaps contra pedidos de la reunión
--
-- Vaneza (R1): "para crear clientes, proveedores... también creamos con los
-- DNI... vamos a aumentar más proveedores, vamos a aumentar más clientes
-- porque contabilidad trabaja bastante con anexos"
-- Vaneza (R1): "Yo creo las nuevas series" (F002/B002/T002 en SUNAT →
-- luego las activa en el sistema)
--
-- Gaps detectados en auditoría de policies:
-- 1. clientes INSERT/UPDATE: no incluía contador
-- 2. proveedores write: no incluía contador
-- 3. series_correlativos write: no incluía contador (no podía activar series)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Clientes: el contador puede crear y editar
DROP POLICY IF EXISTS clientes_insert_admin_vendedor ON clientes;
CREATE POLICY clientes_insert_admin_vendedor ON clientes FOR INSERT WITH CHECK (
  has_role(VARIADIC ARRAY['gerente','administrador','vendedor','repartidor','contador'])
);

DROP POLICY IF EXISTS clientes_update_admin ON clientes;
CREATE POLICY clientes_update_admin ON clientes FOR UPDATE USING (
  has_role(VARIADIC ARRAY['gerente','administrador','contador'])
  OR (has_role(VARIADIC ARRAY['vendedor','repartidor']) AND vendedor_id = auth.uid())
);

-- 2. Proveedores: el contador puede crear y editar
DROP POLICY IF EXISTS proveedores_write_admin_almacen ON proveedores;
CREATE POLICY proveedores_write_admin_almacen ON proveedores FOR ALL USING (
  has_role(VARIADIC ARRAY['gerente','administrador','almacenero','contador'])
);

-- 3. Series: el contador puede activar/desactivar (gestiona la autorización SUNAT)
DROP POLICY IF EXISTS series_write_admin ON series_correlativos;
CREATE POLICY series_write_admin ON series_correlativos FOR ALL USING (
  has_role(VARIADIC ARRAY['gerente','administrador','contador'])
);
