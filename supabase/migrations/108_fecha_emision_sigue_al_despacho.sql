-- ═══════════════════════════════════════════════════════════════════════════
-- 108 · Corregir el despacho mueve también la emisión
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La 107 corregía la fecha de despacho y dejaba la de emisión quieta, con este
-- razonamiento: la emisión es la fecha legal, está impresa y el cliente la
-- tiene en la mano.
--
-- Ese razonamiento valía cuando las dos fechas eran cosas distintas. Ya no lo
-- son. Daniel lo planteó en la reunión del 9 de setiembre:
--
--   "la emisión debe ser el día que se va repartir... las dos fechas deberían
--    ser uno solo, emisión y despacho"
--
-- Y es lo que manda el art. 5 del Reglamento de Comprobantes de Pago: en la
-- transferencia de bienes muebles el comprobante se emite cuando se entrega el
-- bien. El bien se entrega el día del reparto.
--
-- Desde ahora el comprobante nace con `fecha_emision = fecha_despacho`. Si esa
-- fecha estaba mal, corregir una y dejar la otra las pondría a decir cosas
-- distintas, que es exactamente el problema que la 107 vino a resolver.
--
-- Por qué se puede mover la fecha de emisión
-- ------------------------------------------
-- Porque acá todavía no fue declarada. La 107 ya se negaba a tocar un
-- comprobante con `enviado_sunat`, y esa puerta sigue cerrada. Mientras no se
-- declaró, la fecha de emisión no es un hecho ante SUNAT: es un dato del
-- sistema, y corregirlo antes de declarar es preferible a declarar algo que se
-- sabe equivocado.
--
-- Lo que esto obliga
-- ------------------
-- El QR impreso lleva el resumen de la firma, y la firma se calcula sobre un
-- XML que incluye la fecha. Cambiada la fecha, hay que volver a firmar y
-- volver a imprimir ese comprobante. De eso se encarga la pantalla, que llama
-- a /api/sunat/firmar después de corregir y avisa que hay que reimprimir.
--
-- Se saca además la validación que impedía poner un despacho anterior a la
-- emisión: con las dos fechas siendo la misma, no tiene nada que comparar.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION corregir_fecha_despacho_comprobante(
  p_comprobante_id UUID,
  p_fecha_despacho DATE,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_rol  TEXT;
  v_comp RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role INTO v_rol FROM profiles WHERE id = v_user;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo un administrador o gerente puede corregir la fecha de un comprobante emitido';
  END IF;

  IF p_fecha_despacho IS NULL THEN
    RAISE EXCEPTION 'Hay que indicar la nueva fecha de despacho';
  END IF;
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Hay que explicar por qué se corrige (mínimo 5 caracteres)';
  END IF;

  SELECT id, serie, numero, estado, enviado_sunat,
         fecha_emision, fecha_despacho, pedido_id
    INTO v_comp
    FROM comprobantes WHERE id = p_comprobante_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'El comprobante no existe'; END IF;

  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'El comprobante % - % está anulado', v_comp.serie, v_comp.numero;
  END IF;

  IF v_comp.enviado_sunat THEN
    RAISE EXCEPTION 'El comprobante % - % ya fue declarado a SUNAT: para corregirlo hay que emitir una nota de crédito',
      v_comp.serie, v_comp.numero;
  END IF;

  IF p_fecha_despacho = v_comp.fecha_despacho THEN
    RAISE EXCEPTION 'El comprobante % - % ya tiene esa fecha', v_comp.serie, v_comp.numero;
  END IF;

  -- Las dos juntas: son la misma fecha. `comprobantes` no lleva updated_at;
  -- cuándo y quién queda en la bitácora.
  UPDATE comprobantes
     SET fecha_despacho = p_fecha_despacho,
         fecha_emision  = p_fecha_despacho
   WHERE id = p_comprobante_id;

  IF v_comp.pedido_id IS NOT NULL THEN
    UPDATE pedidos
       SET fecha_despacho = p_fecha_despacho, updated_at = NOW()
     WHERE id = v_comp.pedido_id;
  END IF;

  -- Dos renglones en la bitácora, uno por campo, para que después se pueda
  -- reconstruir qué cambió sin tener que deducirlo.
  INSERT INTO comprobantes_ediciones (
    comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, nota
  ) VALUES (
    p_comprobante_id, v_user,
    COALESCE((SELECT full_name FROM profiles WHERE id = v_user), 'desconocido'),
    v_rol, 'fecha_despacho',
    v_comp.fecha_despacho::TEXT, p_fecha_despacho::TEXT, TRIM(p_motivo)
  ), (
    p_comprobante_id, v_user,
    COALESCE((SELECT full_name FROM profiles WHERE id = v_user), 'desconocido'),
    v_rol, 'fecha_emision',
    v_comp.fecha_emision::TEXT, p_fecha_despacho::TEXT, TRIM(p_motivo)
  );

  RETURN jsonb_build_object(
    'comprobante', v_comp.serie || '-' || v_comp.numero,
    'anterior', v_comp.fecha_despacho,
    'nueva', p_fecha_despacho,
    'emision_anterior', v_comp.fecha_emision,
    'requiere_reimprimir', TRUE
  );
END;
$$;

COMMENT ON FUNCTION corregir_fecha_despacho_comprobante IS
  'Corrige la fecha de un comprobante no declarado: mueve emision y despacho juntas, porque son la misma fecha, y tambien la del pedido. Solo administrador o gerente. Obliga a volver a firmar y reimprimir.';

GRANT EXECUTE ON FUNCTION corregir_fecha_despacho_comprobante TO authenticated;
