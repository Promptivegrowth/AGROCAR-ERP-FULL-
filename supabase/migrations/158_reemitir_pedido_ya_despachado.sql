-- Volver a emitir el comprobante de un pedido que ya salió del almacén.
--
-- Daniel, 07/11/2026: se anuló la boleta rechazada B002-1692 ("se vuelve a
-- emitir") y se emitió la B002-1822. Anular devuelve el pedido a "enviado" para
-- que aparezca en Pedidos pendientes; al emitir, quedaba "facturado", como si
-- todavía hubiera que repartirlo, aunque salió en el despacho del 05/11 y su
-- salida de stock está en el kárdex desde el 04/11.
--
-- Ahora, si el pedido ya tiene su salida de stock, al emitir vuelve a
-- "despachado". El resto sigue igual: zona sin despacho → entregado; si no,
-- facturado; lo ya despachado o entregado no se toca.

DO $$
DECLARE d TEXT; n TEXT;
BEGIN
  SELECT pg_get_functiondef('public.emitir_comprobante_atomico(uuid,text,text,text,date,numeric,numeric,numeric,uuid)'::regprocedure) INTO d;
  n := replace(d,
    $a$                 THEN 'entregado' ELSE 'facturado' END::estado_pedido,$a$,
    $b$                 THEN 'entregado'
                 -- Ya salió del almacén (se vuelve a emitir tras anular): sigue despachado.
                 WHEN EXISTS (SELECT 1 FROM movimientos_stock m
                               WHERE m.referencia_tipo = 'pedido' AND m.referencia_id = p.id AND m.tipo = 'salida')
                 THEN 'despachado'
                 ELSE 'facturado' END::estado_pedido,$b$);
  IF n = d THEN RAISE EXCEPTION 'emitir_comprobante_atomico no tenía el bloque esperado'; END IF;
  EXECUTE n;
END $$;
