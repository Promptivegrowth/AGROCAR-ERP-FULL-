-- ─────────────────────────────────────────────────────────────────────────────
-- 049: Fix RPC anular_comprobante y editar_cliente_comprobante
--
-- Bug: ambas RPCs (mig 048) hacían SET updated_at = NOW() pero la tabla
-- comprobantes NO tiene esa columna (a diferencia de otras tablas).
-- Error: 'column "updated_at" of relation "comprobantes" does not exist'.
--
-- Fix: quitar updated_at de los UPDATE. La auditoría queda en
-- anulado_at y editado_at que sí existen.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION anular_comprobante(
  p_comprobante_id UUID,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_comp RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administradores y gerentes pueden anular comprobantes';
  END IF;

  IF p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Debes ingresar un motivo de anulación (mínimo 5 caracteres)';
  END IF;

  SELECT * INTO v_comp FROM comprobantes WHERE id = p_comprobante_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante % no existe', p_comprobante_id; END IF;

  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'El comprobante ya está anulado';
  END IF;

  IF v_comp.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede anular localmente: el comprobante fue enviado a SUNAT. Genera una NOTA DE CRÉDITO o usa la comunicación de baja en SUNAT.';
  END IF;

  UPDATE comprobantes
    SET estado = 'anulado'::estado_comprobante,
        anulado_at = NOW(),
        anulado_por = v_user_id,
        motivo_anulacion = p_motivo
    WHERE id = p_comprobante_id;

  INSERT INTO comprobantes_ediciones (
    comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, nota
  ) VALUES (
    p_comprobante_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
    'estado', v_comp.estado::text, 'anulado', 'Anulación: ' || p_motivo
  );

  IF v_comp.pedido_id IS NOT NULL THEN
    UPDATE pedidos
      SET estado = 'enviado'::estado_pedido, updated_at = NOW()
      WHERE id = v_comp.pedido_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', p_comprobante_id,
    'numero', v_comp.serie || '-' || LPAD(v_comp.numero::text, 8, '0'),
    'pedido_id', v_comp.pedido_id,
    'estado_pedido', 'enviado'
  );
END;
$$;


CREATE OR REPLACE FUNCTION editar_cliente_comprobante(
  p_comprobante_id UUID,
  p_cliente_id UUID DEFAULT NULL,
  p_cliente_externo_nombre TEXT DEFAULT NULL,
  p_cliente_externo_doc TEXT DEFAULT NULL,
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
  v_comp RECORD;
  v_cliente_anterior TEXT;
  v_cliente_nuevo TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permiso para editar el cliente del comprobante';
  END IF;

  SELECT c.*, cl.razon_social AS cliente_actual_nombre
    INTO v_comp
  FROM comprobantes c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  WHERE c.id = p_comprobante_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante % no existe', p_comprobante_id; END IF;
  IF v_comp.enviado_sunat THEN
    RAISE EXCEPTION 'No se puede editar el cliente: el comprobante ya fue enviado a SUNAT';
  END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede editar un comprobante anulado';
  END IF;
  IF p_cliente_id IS NULL AND (p_cliente_externo_nombre IS NULL OR LENGTH(TRIM(p_cliente_externo_nombre)) = 0) THEN
    RAISE EXCEPTION 'Debes pasar p_cliente_id o p_cliente_externo_nombre';
  END IF;

  v_cliente_anterior := COALESCE(
    v_comp.cliente_actual_nombre,
    v_comp.cliente_externo_nombre,
    'Sin cliente'
  );

  IF p_cliente_id IS NOT NULL THEN
    SELECT razon_social INTO v_cliente_nuevo FROM clientes WHERE id = p_cliente_id;
    IF v_cliente_nuevo IS NULL THEN
      RAISE EXCEPTION 'Cliente % no existe', p_cliente_id;
    END IF;
    UPDATE comprobantes
      SET cliente_id = p_cliente_id,
          cliente_externo_nombre = NULL,
          cliente_externo_doc = NULL,
          editado = TRUE,
          editado_at = NOW()
      WHERE id = p_comprobante_id;
  ELSE
    v_cliente_nuevo := p_cliente_externo_nombre;
    UPDATE comprobantes
      SET cliente_id = NULL,
          cliente_externo_nombre = p_cliente_externo_nombre,
          cliente_externo_doc = p_cliente_externo_doc,
          editado = TRUE,
          editado_at = NOW()
      WHERE id = p_comprobante_id;
  END IF;

  INSERT INTO comprobantes_ediciones (
    comprobante_id, usuario_id, usuario_nombre, usuario_rol,
    campo, valor_anterior, valor_nuevo, nota
  ) VALUES (
    p_comprobante_id, v_user_id, COALESCE(v_profile.full_name, 'Sistema'), v_profile.role,
    'cliente', v_cliente_anterior, v_cliente_nuevo, p_motivo
  );

  RETURN jsonb_build_object(
    'ok', true,
    'cliente_anterior', v_cliente_anterior,
    'cliente_nuevo', v_cliente_nuevo
  );
END;
$$;
