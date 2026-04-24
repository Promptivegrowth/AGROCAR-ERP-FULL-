-- =============================================================================
-- SCRIPT ONE-SHOT: Limpieza de datos demo/semilla
-- -----------------------------------------------------------------------------
-- ⚠️ NO es una migración. NO ejecutar en producción sin confirmación.
-- Ejecutado una sola vez el 2026-04-24 para dejar la BD lista para datos reales.
--
-- Preserva: tipos_cliente, familias, listas_precio, unidades_medida, zonas,
--   configuracion, ubigeo_*, auth.users, profiles.
-- Vacía: toda la data transaccional + maestros poblados por seeds demo.
-- =============================================================================

BEGIN;

-- 1. Líneas/items
DELETE FROM pedidos_items;
DELETE FROM despachos_items;
DELETE FROM movimientos_stock;
DELETE FROM lotes;
DELETE FROM stock;

-- 2. Documentos transaccionales
DELETE FROM cobros;
DELETE FROM comprobantes;
DELETE FROM gps_checkins;
DELETE FROM despachos;
DELETE FROM pedidos;

-- 3. Vendedores (datos, no cuentas)
DELETE FROM cuotas_producto;
DELETE FROM liquidaciones_comision;
DELETE FROM metas_vendedor;

-- 4. Solicitudes
DELETE FROM solicitudes_cliente;

-- 5. Compras
DELETE FROM compras;
DELETE FROM ordenes_compra;

-- 6. Flota
DELETE FROM multas_vehiculo;
DELETE FROM mantenimientos_vehiculo;
DELETE FROM vehiculos_conductores;

-- 7. Clientes y proveedores
DELETE FROM cliente_direcciones;
DELETE FROM proveedores;

-- 8. Maestros que se llenarán con datos reales
DELETE FROM lista_precio_items;
DELETE FROM clientes;
DELETE FROM productos;
DELETE FROM conductores;
DELETE FROM vehiculos;

COMMIT;
