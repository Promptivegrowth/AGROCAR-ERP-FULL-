-- ─────────────────────────────────────────────────────────────────────────────
-- 050: Eliminar línea de un comprobante
--
-- Daniel pidió poder quitar productos del comprobante. Hoy solo se podía
-- editar cantidad a 0 (queda la línea con monto 0). Ahora hay una RPC
-- para borrar la línea completa.
--
-- Reglas:
-- - Solo admin/gerente/facturador
-- - No se permite si el comprobante ya se envió a SUNAT
-- - No se permite si es la ÚLTIMA línea (un comprobante no puede quedar vacío:
--   en ese caso mejor anular el comprobante completo)
-- - Recalcula totales después de borrar (igual lógica que editar_comprobante_item)
-- - Audit trail
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION eliminar_item_comprobante(
  p_item_id UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_item RECORD;
  v_count_restante INT;
  v_suma NUMERIC;
  v_total NUMERIC;
  v_igv NUMERIC;
  v_subtotal NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permiso para eliminar líneas del comprobante';
  END IF;

  SELECT ci.*, c.id AS comp_id, c.estado, c.enviado_sunat, c.igv AS igv_compr
    INTO v_item
  FROM comprobantes_items ci
  JOIN comprobantes c ON c.id = ci.comprobante_id
  WHERE ci.id = p_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Línea % no existe', p_item_id; END IF;
  IF v_item.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede modificar: el comprobante ya fue enviado a SUNAT';
  END IF;
  IF v_item.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede modificar un comprobante anulado';
  END IF;

  -- Validar que no sea la última línea
  SELECT COUNT(*) INTO v_count_restante FROM comprobantes_items
    WHERE comprobante_id = v_item.comp_id;
  IF v_count_restante <= 1 THEN
    RAISE EXCEPTION 'No se puede eliminar la única línea del comprobante. Si quieres dejarlo vacío, mejor ANULA el comprobante completo.';
  END IF;

  -- Audit log antes de borrar
  INSERT INTO comprobantes_ediciones (
    comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, item_id, item_descripcion, nota
  ) VALUES (
    v_item.comp_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
    'item.eliminado',
    'cant=' || v_item.cantidad || ' precio=' || v_item.precio_unitario || ' subtotal=' || v_item.subtotal,
    'eliminado',
    p_item_id, v_item.descripcion, p_motivo
  );

  -- Borrar la línea
  DELETE FROM comprobantes_items WHERE id = p_item_id;

  -- Recalcular totales del comprobante (misma lógica que editar_comprobante_item)
  SELECT COALESCE(SUM(subtotal), 0) INTO v_suma
    FROM comprobantes_items WHERE comprobante_id = v_item.comp_id;

  IF v_item.igv_compr > 0 THEN
    v_total := v_suma;
    v_igv := ROUND(v_total - (v_total / 1.18), 2);
    v_subtotal := v_total - v_igv;
  ELSE
    v_total := v_suma;
    v_igv := 0;
    v_subtotal := v_suma;
  END IF;

  UPDATE comprobantes
    SET subtotal = v_subtotal,
        igv = v_igv,
        total = v_total,
        editado = TRUE,
        editado_at = NOW()
    WHERE id = v_item.comp_id;

  RETURN jsonb_build_object(
    'ok', true,
    'comprobante_id', v_item.comp_id,
    'lineas_restantes', v_count_restante - 1,
    'subtotal', v_subtotal,
    'igv', v_igv,
    'total', v_total
  );
END;
$$;

COMMENT ON FUNCTION eliminar_item_comprobante IS
  'Elimina una línea del comprobante y recalcula totales. Bloquea si se envió a SUNAT o si es la única línea.';

GRANT EXECUTE ON FUNCTION eliminar_item_comprobante TO authenticated;
