-- Ajustes de inventario que de verdad mueven el stock.
--
-- La pantalla Almacén > Ajustes insertaba solo el movimiento en
-- movimientos_stock, y nada lo llevaba a stock: el kárdex decía "+10" y el
-- stock seguía igual (ensayo del 05/10/2026: 35 → 35). No se notó porque no se
-- había registrado ningún ajuste. Salió al ver cómo ingresar la producción de
-- agua y hielo (Daniel, 05/10), que es una entrada con motivo "Producción".
--
-- Esto hace las dos cosas juntas: el movimiento y el stock.
--   * Entrada: suma al stock. Si se indica costo unitario (en producción, lo
--     que costó producir), recalcula el costo promedio como una compra; si no,
--     el costo promedio no cambia.
--   * Salida: resta (el stock puede quedar negativo, migración 120) al costo
--     promedio vigente.

CREATE OR REPLACE FUNCTION public.registrar_ajuste_inventario(
  p_producto_id uuid, p_tipo text, p_cantidad numeric, p_motivo text,
  p_notas text DEFAULT NULL, p_costo_unitario numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_rol TEXT;
  v_prod RECORD;
  v_stock RECORD;
  v_costo NUMERIC;
  v_nuevo NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_rol FROM profiles WHERE id = v_user AND activo;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'almacenero') THEN
    RAISE EXCEPTION 'Solo administración, gerencia o almacén pueden ajustar el inventario';
  END IF;
  IF p_tipo NOT IN ('entrada', 'salida') THEN RAISE EXCEPTION 'Tipo de ajuste inválido'; END IF;
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad tiene que ser mayor a cero'; END IF;
  IF COALESCE(TRIM(p_motivo), '') = '' THEN RAISE EXCEPTION 'Indica el motivo del ajuste'; END IF;
  IF p_costo_unitario IS NOT NULL AND p_costo_unitario < 0 THEN RAISE EXCEPTION 'El costo no puede ser negativo'; END IF;

  SELECT id, codigo, COALESCE(NULLIF(TRIM(descripcion), ''), nombre) AS nombre INTO v_prod
    FROM productos WHERE id = p_producto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El producto no existe'; END IF;

  SELECT cantidad, costo_promedio INTO v_stock FROM stock WHERE producto_id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO stock (producto_id, cantidad, cantidad_reservada, costo_promedio, updated_at)
    VALUES (p_producto_id, 0, 0, COALESCE(p_costo_unitario, 0), NOW());
    v_stock := ROW(0::numeric, COALESCE(p_costo_unitario, 0)::numeric);
  END IF;

  IF p_tipo = 'entrada' THEN
    v_costo := COALESCE(p_costo_unitario, v_stock.costo_promedio);
    UPDATE stock SET
      cantidad = cantidad + p_cantidad,
      costo_promedio = CASE
        WHEN p_costo_unitario IS NULL THEN costo_promedio
        WHEN cantidad > 0 AND cantidad + p_cantidad > 0
          THEN ((cantidad * COALESCE(costo_promedio, 0)) + (p_cantidad * p_costo_unitario)) / (cantidad + p_cantidad)
        ELSE p_costo_unitario
      END,
      updated_at = NOW()
     WHERE producto_id = p_producto_id
    RETURNING cantidad INTO v_nuevo;
  ELSE
    v_costo := v_stock.costo_promedio;
    UPDATE stock SET cantidad = cantidad - p_cantidad, updated_at = NOW()
     WHERE producto_id = p_producto_id
    RETURNING cantidad INTO v_nuevo;
  END IF;

  INSERT INTO movimientos_stock (producto_id, tipo, cantidad, costo_unitario, referencia_tipo, notas, created_by)
  VALUES (p_producto_id, p_tipo::tipo_movimiento_stock,
          p_cantidad,  -- siempre positiva: el sentido lo da el tipo, como en el resto del kárdex
          v_costo, 'ajuste',
          'Motivo: ' || TRIM(p_motivo) || COALESCE(' | ' || NULLIF(TRIM(p_notas), ''), ''),
          v_user);

  RETURN jsonb_build_object('ok', true, 'producto', v_prod.nombre, 'stock', v_nuevo);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.registrar_ajuste_inventario(uuid, text, numeric, text, text, numeric) TO authenticated;
