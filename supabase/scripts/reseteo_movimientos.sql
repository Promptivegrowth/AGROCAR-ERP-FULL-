-- ─────────────────────────────────────────────────────────────────────────────
-- RESETEO DE MOVIMIENTOS — arranque en producción (agosto 2026)
--
-- Daniel: "regresas el sistema a 0 movimientos… facturas, despachos, ventas,
-- compras, movimientos en caja, reportes, etc., sin tocar ninguna
-- funcionalidad", para que su equipo empiece a operar en limpio.
--
-- ESTE SCRIPT BORRA DATOS Y NO SE PUEDE DESHACER desde la aplicación.
-- Antes de correrlo se dejó copia completa en el esquema `respaldo_reseteo`.
-- Para volver atrás: INSERT INTO public.<tabla> SELECT * FROM respaldo_reseteo.<tabla>
-- respetando el mismo orden inverso al del borrado.
--
-- SE CONSERVA (decisión de Luigi, 16/08/2026):
--   · Maestros: clientes y sus direcciones, productos, familias, proveedores,
--     terceros, zonas, vehículos, conductores, tipos de cliente, unidades
--   · Listas de precio y sus ítems
--   · Cuotas de vendedores (por producto y por familia) — son metas, no movimientos
--   · Plan contable y periodos contables
--   · Tipo de cambio histórico
--   · Reglas de comisiones
--   · Usuarios, configuración de empresa y series
--
-- SE BORRA: todo lo transaccional. Las notificaciones de la campana no tienen
-- tabla propia: se calculan de pedidos, solicitudes, cobros, lotes y stock, así
-- que al vaciar esos movimientos quedan limpias solas.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Comprobantes y todo lo que cuelga de ellos ────────────────────────────────
DELETE FROM comprobantes_ediciones;
DELETE FROM guias_remision_items;
DELETE FROM guias_remision;
DELETE FROM comprobantes_items;
DELETE FROM notas_credito;
DELETE FROM detracciones;
DELETE FROM comprobantes;

-- ── Despachos y pedidos ───────────────────────────────────────────────────────
DELETE FROM despachos_items;
DELETE FROM despachos;
DELETE FROM pedidos_items;
DELETE FROM pedidos;

-- ── Cobranzas y caja ──────────────────────────────────────────────────────────
DELETE FROM cobros_aplicaciones;
DELETE FROM cobros;
DELETE FROM depositos_bancarios;
DELETE FROM caja_movimientos;
DELETE FROM caja_sesiones;
DELETE FROM caja_chica_movimientos;
DELETE FROM caja_chica_sesiones;

-- ── Compras ───────────────────────────────────────────────────────────────────
DELETE FROM notas_credito_compras_items;
DELETE FROM notas_credito_compras;
DELETE FROM compras_items;
DELETE FROM compras;
DELETE FROM ordenes_compra_items;
DELETE FROM ordenes_compra;

-- ── Almacén: movimientos y lotes fuera; el stock queda en cero ────────────────
-- Las filas de stock no se borran: se ponen en cero. Así el sistema conserva la
-- fila por producto y su costo promedio de referencia, que es lo que alimenta el
-- cálculo de utilidad del tablero de ventas.
DELETE FROM movimientos_stock;
DELETE FROM lotes;
UPDATE stock SET cantidad = 0, cantidad_reservada = 0, updated_at = NOW();

-- ── Contabilidad: los asientos son movimientos (el plan de cuentas se queda) ──
DELETE FROM asientos_partidas;
DELETE FROM asientos_contables;
DELETE FROM sire_matches;
DELETE FROM conciliaciones_bancarias;
DELETE FROM banco_movimientos;
DELETE FROM eeff_notas;
DELETE FROM depreciaciones_mensuales;

-- ── Comisiones liquidadas (las REGLAS de comisión se conservan) ───────────────
DELETE FROM liquidaciones_comision_detalle;
DELETE FROM liquidaciones_comision;

-- ── Planillas ─────────────────────────────────────────────────────────────────
DELETE FROM planilla_horas_extras;
DELETE FROM planilla_detalle;
DELETE FROM planillas;
DELETE FROM asistencias;
DELETE FROM vacaciones;
DELETE FROM provisiones_beneficios;

-- ── Campo: GPS y solicitudes ──────────────────────────────────────────────────
DELETE FROM gps_checkins;
DELETE FROM gps_ubicaciones;
DELETE FROM solicitudes_cliente;

-- ── Vehículos: incidencias, no maestros ───────────────────────────────────────
DELETE FROM mantenimientos_vehiculo;
DELETE FROM multas_vehiculo;

-- ── Tablas de cuotas viejas que quedaron vacías y sin uso ─────────────────────
DELETE FROM cuotas_producto;
DELETE FROM metas_vendedor;

COMMIT;
