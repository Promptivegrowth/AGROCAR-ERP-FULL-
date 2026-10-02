-- Las ventas de oficina y las ventas directas no esperan camión.
--
-- Daniel, 01/10: "las ventas de oficina y venta directa tampoco deben
-- aparecer en el despacho, revisar urgente". Despacho arma su lista con los
-- pedidos en 'facturado', y ahí estaban las ventas de la ZONA 49 VENTA
-- OFICINA: mercadería que el cliente retira en la oficina, esperando un camión
-- que nunca van a tomar. Y como el stock se descuenta al despachar, tampoco
-- había salido del inventario.
--
-- Dos arreglos, los dos en emitir_comprobante_atomico, por donde pasa toda
-- emisión:
--
--   1. Una zona puede marcarse "sin despacho". Un pedido de esa zona se
--      entrega al facturar: sale de la lista de Despacho y su stock se
--      descuenta en ese momento (el trigger de despacho actúa al pasar a
--      'entregado').
--   2. Un pedido ya 'despachado' o 'entregado' no vuelve a 'facturado'. La
--      venta directa se marca entregada ANTES de emitir; la emisión la pisaba
--      con 'facturado' y reaparecía en Despacho. La 102 lo había parchado en
--      registrar_venta_directa; acá queda resuelto para cualquier camino.

BEGIN;

ALTER TABLE zonas ADD COLUMN IF NOT EXISTS sin_despacho BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN zonas.sin_despacho IS
  'Zona de venta en oficina: sus pedidos se entregan al facturar y no pasan por Despacho.';

UPDATE zonas SET sin_despacho = TRUE WHERE nombre ILIKE '%VENTA OFICINA%';

DO $cambio$
DECLARE
  v_src TEXT;
  v_nuevo TEXT;
BEGIN
  SELECT pg_get_functiondef('public.emitir_comprobante_atomico'::regproc) INTO v_src;
  v_nuevo := replace(v_src,
    'UPDATE pedidos SET estado = ''facturado''::estado_pedido, updated_at = NOW() WHERE id = p_pedido_id;',
    E'-- Venta en oficina (zona sin despacho): se entrega al facturar. Y lo ya\n'
    || E'  -- despachado o entregado no vuelve atrás (migración 123).\n'
    || E'  UPDATE pedidos p\n'
    || E'     SET estado = CASE WHEN EXISTS (\n'
    || E'                   SELECT 1 FROM clientes cl\n'
    || E'                     LEFT JOIN cliente_direcciones cd ON cd.id = p.direccion_entrega_id\n'
    || E'                     JOIN zonas z ON z.id = COALESCE(cd.zona_id, cl.zona_id)\n'
    || E'                    WHERE cl.id = p.cliente_id AND z.sin_despacho)\n'
    || E'                 THEN ''entregado'' ELSE ''facturado'' END::estado_pedido,\n'
    || E'         updated_at = NOW()\n'
    || E'   WHERE p.id = p_pedido_id AND p.estado NOT IN (''despachado'', ''entregado'');');
  IF v_nuevo = v_src THEN
    RAISE EXCEPTION 'emitir_comprobante_atomico: no se encontró el cambio de estado donde se esperaba';
  END IF;
  EXECUTE v_nuevo;
END
$cambio$;

-- Las ventas de oficina que ya están facturadas esperando camión se entregan
-- ahora: salen de Despacho y descuentan su stock.
UPDATE pedidos p
   SET estado = 'entregado', updated_at = NOW()
  FROM clientes cl
  LEFT JOIN zonas zc ON zc.id = cl.zona_id
 WHERE cl.id = p.cliente_id
   AND p.estado = 'facturado'
   AND NOT EXISTS (SELECT 1 FROM despachos_items di WHERE di.pedido_id = p.id)
   AND COALESCE(
         (SELECT z.sin_despacho FROM cliente_direcciones cd JOIN zonas z ON z.id = cd.zona_id WHERE cd.id = p.direccion_entrega_id),
         zc.sin_despacho, FALSE);

COMMIT;
