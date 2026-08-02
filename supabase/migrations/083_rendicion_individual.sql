-- ─────────────────────────────────────────────────────────────────────────────
-- 083: Rendición diaria INDIVIDUAL por vendedor / repartidor
--
-- Daniel en la reunión:
--   "cada vendedor debe salir este mismo reportito pero por cada vendedor...
--    este cuadrito de cada vendedor, totalizado así, porque cada vendedor
--    tiene que rendir su cuenta con ese reporte"
--   "caja debería imprimírselo para que ellos dejen constancia: sabes qué,
--    imprímame esto, yo estoy dejando esta cantidad"
--   "el vendedor: mi liquidación hasta esta hora, mira en efectivo ya cobré
--    mil soles" → el vendedor lo genera desde su celular en tiempo real
--   "controlamos cuántos documentos han quedado en crédito y cuántos se ha
--    vendido al contado"
--   "el número de operación todo eso para hacer seguimiento para poder
--    cuadrar en cuentas corrientes"
--
-- Quién puede pedirla:
--   - administrador, gerente, caja, contador → la de cualquier persona
--   - vendedor, repartidor, chofer          → SOLO la suya
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rendicion_persona(
  p_persona_id UUID,
  p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol_solicitante TEXT;
  v_persona RECORD;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role::text INTO v_rol_solicitante FROM profiles WHERE id = v_uid;

  -- El personal de campo solo puede ver su propia rendición
  IF v_rol_solicitante IN ('vendedor', 'repartidor', 'chofer')
     AND p_persona_id <> v_uid THEN
    RAISE EXCEPTION 'Solo puede consultar su propia rendición';
  END IF;

  IF v_rol_solicitante NOT IN
     ('administrador', 'gerente', 'caja', 'contador', 'vendedor', 'repartidor', 'chofer') THEN
    RAISE EXCEPTION 'Sin permiso para consultar rendiciones';
  END IF;

  SELECT id, COALESCE(full_name, email) AS nombre, role::text AS rol
  INTO v_persona FROM profiles WHERE id = p_persona_id;

  IF v_persona.id IS NULL THEN RAISE EXCEPTION 'Persona no encontrada'; END IF;

  WITH ventas AS (
    SELECT
      c.id, c.tipo::text AS tipo, c.serie, c.numero, c.total,
      COALESCE(pe.tipo_pago::text, 'credito') AS tipo_pago,
      COALESCE(cl.razon_social, c.cliente_externo_nombre, '—') AS cliente
    FROM comprobantes c
    JOIN pedidos pe ON pe.id = c.pedido_id
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    WHERE c.fecha_emision = p_fecha
      AND c.estado <> 'anulado'
      AND pe.vendedor_id = p_persona_id
  ),
  cobranzas AS (
    SELECT
      co.id, co.created_at, co.numero,
      COALESCE(cl.razon_social, co.cliente_externo_nombre, '—') AS cliente,
      co.efectivo, co.yape, co.plin, co.transferencia, co.total,
      co.nro_operacion, co.voucher_url
    FROM cobros co
    LEFT JOIN clientes cl ON cl.id = co.cliente_id
    WHERE co.fecha = p_fecha AND co.cobrador_id = p_persona_id
  )
  SELECT jsonb_build_object(
    'persona', jsonb_build_object(
      'id', v_persona.id, 'nombre', v_persona.nombre, 'rol', v_persona.rol
    ),
    'fecha', p_fecha,
    'generado_at', NOW(),
    'ventas', jsonb_build_object(
      'count',          (SELECT COUNT(*) FROM ventas),
      'monto',          (SELECT COALESCE(SUM(total), 0) FROM ventas),
      'contado_count',  (SELECT COUNT(*) FROM ventas WHERE tipo_pago = 'contado'),
      'contado_monto',  (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE tipo_pago = 'contado'),
      'credito_count',  (SELECT COUNT(*) FROM ventas WHERE tipo_pago <> 'contado'),
      'credito_monto',  (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE tipo_pago <> 'contado'),
      'documentos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'tipo', tipo, 'serie', serie, 'numero', numero,
          'cliente', cliente, 'total', total, 'tipo_pago', tipo_pago
        ) ORDER BY serie, numero) FROM ventas
      ), '[]'::jsonb)
    ),
    'cobros', jsonb_build_object(
      'count',         (SELECT COUNT(*) FROM cobranzas),
      'efectivo',      (SELECT COALESCE(SUM(efectivo), 0) FROM cobranzas),
      'yape',          (SELECT COALESCE(SUM(yape), 0) FROM cobranzas),
      'plin',          (SELECT COALESCE(SUM(plin), 0) FROM cobranzas),
      'transferencia', (SELECT COALESCE(SUM(transferencia), 0) FROM cobranzas),
      'total',         (SELECT COALESCE(SUM(total), 0) FROM cobranzas),
      'detalle', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'hora', to_char(created_at AT TIME ZONE 'America/Lima', 'HH24:MI'),
          'numero', numero,
          'cliente', cliente,
          'efectivo', efectivo, 'yape', yape, 'plin', plin,
          'transferencia', transferencia, 'total', total,
          'nro_operacion', nro_operacion,
          'tiene_voucher', (voucher_url IS NOT NULL)
        ) ORDER BY created_at) FROM cobranzas
      ), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION rendicion_persona TO authenticated;

COMMENT ON FUNCTION rendicion_persona IS
  'Rendición diaria individual: ventas del día (contado/crédito) y cobranzas por medio de pago con número de operación. El personal de campo solo puede consultar la suya.';
