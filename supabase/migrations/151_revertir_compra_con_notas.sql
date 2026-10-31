-- Una compra con notas del proveedor vigentes no se revierte.
--
-- Revertir saca el stock al precio de la factura, pero el costo ya incluye la
-- nota de débito o crédito (migración 150): quedaría un costo que no
-- corresponde a nada. Primero se anula la nota (que devuelve el costo) y
-- recién después se revierte la compra.
CREATE OR REPLACE FUNCTION public.revertir_compra(p_compra_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_compra RECORD;
  v_notas TEXT;
BEGIN
  SELECT id, estado, regulariza_internos INTO v_compra FROM compras WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada'; END IF;
  SELECT string_agg(numero, ', ') INTO v_notas FROM notas_proveedor WHERE compra_id = p_compra_id AND estado = 'aplicada';
  IF v_notas IS NOT NULL THEN
    RAISE EXCEPTION 'La compra tiene notas del proveedor vigentes (%): anúlalas antes de revertirla', v_notas;
  END IF;
  IF v_compra.regulariza_internos THEN
    IF v_compra.estado <> 'aplicada' THEN
      RAISE EXCEPTION 'Solo se puede revertir una compra aplicada (estado actual: %)', v_compra.estado;
    END IF;
    UPDATE compras SET estado = 'registrada' WHERE id = p_compra_id;
    RETURN;
  END IF;
  PERFORM _revertir_compra_con_stock(p_compra_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.revertir_compra(uuid) TO authenticated;
