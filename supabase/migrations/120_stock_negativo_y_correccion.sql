-- El stock puede quedar en negativo, y se corrige lo que se perdió.
--
-- Daniel, 01/10: "peperoni especial cortado x 1 kilo: ayer se hizo pedido de
-- 2 und y ya está facturado, hoy ingresé 4 und. Según el stock sigue 4, en
-- stock real solo tengo 2, no se descontó".
--
-- Sí se descontó: el kárdex tiene la salida de 2 al consolidar el despacho
-- (30/09 20:49). Pero el stock estaba en 0 —se puso en cero para arrancar— y
-- la función descontaba con GREATEST(0, cantidad - salida): 0 - 2 quedó en 0
-- y las 2 unidades se perdieron. Al entrar la compra de 4 quedó 4 en vez de 2.
-- Pasó con 16 productos despachados ayer.
--
-- El pedido ya permitía vender sin stock ("continuar de todos modos"), así
-- que el saldo tiene que poder quedar en negativo: es mercadería vendida que
-- todavía no se ingresó, y la próxima compra la compensa. Recortarlo a cero
-- borraba esa deuda sin dejar rastro.

BEGIN;

-- ── 1. El stock puede ser negativo ─────────────────────────────────────────
ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_cantidad_positive;

-- ── 2. Las funciones dejan de recortar a cero ──────────────────────────────
-- Solo la cantidad del producto. La reservada sigue sin bajar de cero, y los
-- lotes también: un lote negativo no significa nada.
DO $cambio$
DECLARE
  f TEXT;
  v_src TEXT;
  v_nuevo TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['descontar_stock_al_despachar', 'descontar_stock_al_entregar'] LOOP
    SELECT pg_get_functiondef(('public.' || f)::regproc) INTO v_src;
    v_nuevo := replace(v_src, 'cantidad = GREATEST(0, cantidad - item.cantidad)', 'cantidad = cantidad - item.cantidad');
    IF v_nuevo = v_src THEN
      RAISE EXCEPTION '%: no se encontró el descuento con GREATEST(0, …) donde se esperaba', f;
    END IF;
    EXECUTE v_nuevo;
  END LOOP;

  SELECT pg_get_functiondef('public.revertir_compra'::regproc) INTO v_src;
  v_nuevo := replace(v_src, 'SET cantidad = GREATEST(0, cantidad - v_cant_real)', 'SET cantidad = cantidad - v_cant_real');
  IF v_nuevo = v_src THEN
    RAISE EXCEPTION 'revertir_compra: no se encontró el descuento con GREATEST(0, …) donde se esperaba';
  END IF;
  EXECUTE v_nuevo;
END
$cambio$;

-- ── 3. Corregir lo que se perdió: el saldo vuelve a ser el del kárdex ──────
-- El kárdex arrancó en cero cuando el stock se puso en cero (30/09) y desde
-- entonces registra todas las entradas y salidas: el saldo correcto de cada
-- producto es entradas menos salidas. Solo se tocan los que no coinciden.
WITH k AS (
  SELECT producto_id,
         SUM(CASE WHEN tipo::text = 'entrada' THEN cantidad ELSE 0 END)
       - SUM(CASE WHEN tipo::text = 'salida' THEN cantidad ELSE 0 END) AS saldo
    FROM movimientos_stock
   GROUP BY producto_id
)
UPDATE stock s
   SET cantidad = k.saldo, updated_at = NOW()
  FROM k
 WHERE k.producto_id = s.producto_id
   AND s.cantidad <> k.saldo;

COMMIT;
