-- ═══════════════════════════════════════════════════════════════════════════
-- 107 · Corregir la fecha de despacho de un comprobante ya emitido
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Daniel lo pidió en la reunión del 5 de setiembre, y con un caso concreto: un
-- preventista cargó dos pedidos con fecha del mismo día en vez del día
-- siguiente, se facturaron así, y recién se repartieron al otro día. Como
-- Movimientos del día agrupa por fecha de despacho, esa mercadería quedó
-- contada el día equivocado y el consolidado no cuadra.
--
--   B002-00000571   S/    45.00   MAMANI MAMANI JHON CHRISTOPER
--   B002-00000606   S/   268.80   YOLANDA MAGDALENA TUNQUE MAMANI
--
-- La migración 106 dejó cambiar la fecha solo mientras el pedido no estuviera
-- facturado, que es lo correcto por omisión: después de facturar el papel ya
-- salió. Pero el error humano existe y hasta ahora no había forma de
-- arreglarlo — la única salida era anular y rehacer.
--
-- Por qué el comprobante y no solo el pedido
-- ------------------------------------------
-- Movimientos del día lee `comprobantes.fecha_despacho`, no la del pedido.
-- Cambiar solo el pedido no movería nada en el reporte, que es justamente lo
-- que Daniel necesita corregir. Se cambian los dos, para que no queden
-- diciendo cosas distintas.
--
-- Lo que NO se toca
-- -----------------
-- La fecha de EMISIÓN no se mueve. Es la fecha legal del comprobante: es la
-- que va a SUNAT, la que está impresa y la que el cliente tiene en la mano.
-- Acá se corrige el dato operativo —cuándo sale la mercadería— y nada más.
--
-- Y si el comprobante ya fue declarado, no se toca nada: para eso está la nota
-- de crédito. Hoy ninguno lo está, pero la puerta queda cerrada desde ahora.
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
  v_rol TEXT;
  v_comp RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  -- Solo administración: es una corrección sobre un documento ya emitido, no
  -- una operación del día a día.
  SELECT role INTO v_rol FROM profiles WHERE id = v_user;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo un administrador o gerente puede corregir la fecha de despacho de un comprobante emitido';
  END IF;

  IF p_fecha_despacho IS NULL THEN
    RAISE EXCEPTION 'Hay que indicar la nueva fecha de despacho';
  END IF;
  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Hay que explicar por qué se corrige (mínimo 5 caracteres)';
  END IF;

  SELECT id, serie, numero, estado::TEXT AS estado, enviado_sunat,
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

  -- La mercadería no puede salir antes de que el comprobante exista.
  IF p_fecha_despacho < v_comp.fecha_emision THEN
    RAISE EXCEPTION 'La fecha de despacho (%) no puede ser anterior a la de emisión (%)',
      p_fecha_despacho, v_comp.fecha_emision;
  END IF;

  IF p_fecha_despacho = v_comp.fecha_despacho THEN
    RAISE EXCEPTION 'El comprobante % - % ya tiene esa fecha de despacho',
      v_comp.serie, v_comp.numero;
  END IF;

  -- `comprobantes` no lleva updated_at: cuando y quien queda en la bitacora.
  UPDATE comprobantes
     SET fecha_despacho = p_fecha_despacho
   WHERE id = p_comprobante_id;

  -- El pedido acompaña, para que las dos caras del mismo hecho digan lo mismo.
  IF v_comp.pedido_id IS NOT NULL THEN
    UPDATE pedidos
       SET fecha_despacho = p_fecha_despacho, updated_at = NOW()
     WHERE id = v_comp.pedido_id;
  END IF;

  -- Queda registrado quién y por qué, en la misma bitácora que las demás
  -- ediciones de comprobantes.
  INSERT INTO comprobantes_ediciones (
    comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, nota
  ) VALUES (
    p_comprobante_id, v_user,
    COALESCE((SELECT full_name FROM profiles WHERE id = v_user), 'desconocido'),
    v_rol,
    'fecha_despacho',
    v_comp.fecha_despacho::TEXT, p_fecha_despacho::TEXT, TRIM(p_motivo)
  );

  RETURN jsonb_build_object(
    'comprobante', v_comp.serie || '-' || v_comp.numero,
    'anterior', v_comp.fecha_despacho,
    'nueva', p_fecha_despacho
  );
END;
$$;

COMMENT ON FUNCTION corregir_fecha_despacho_comprobante IS
  'Corrige la fecha de despacho de un comprobante ya emitido y su pedido. Solo administrador o gerente, solo si no fue declarado a SUNAT. La fecha de emision no se toca.';

GRANT EXECUTE ON FUNCTION corregir_fecha_despacho_comprobante TO authenticated;
