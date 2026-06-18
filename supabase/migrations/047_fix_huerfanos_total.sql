-- ─────────────────────────────────────────────────────────────────────────────
-- 047: Fix migración huérfanos — unificar con el trigger normal
--
-- El trigger sync_cobro_a_caja_movimiento crea el movimiento con
-- monto = c.total (incluye efectivo + yape + plin + transferencia).
-- La RPC abrir_caja_con_huerfanos (mig 044) en cambio usaba c.efectivo
-- y filtraba cobros sin efectivo. Eso causaba:
--   1) Inconsistencia: cobros con caja abierta cuentan total, cobros
--      migrados solo cuentan efectivo → el reporte da números distintos.
--   2) Cobros 100% Yape/Plin perdían trazabilidad al no migrarse.
--
-- Fix: migrar TODOS los cobros sin movimiento y usar c.total.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION abrir_caja_con_huerfanos(
  p_saldo_inicial NUMERIC,
  p_cargar_huerfanos BOOLEAN DEFAULT FALSE,
  p_notas TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_sesion_id UUID;
  v_huerfanos_migrados INT := 0;
  v_total_migrado NUMERIC := 0;
  v_existe_abierta BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT EXISTS (SELECT 1 FROM caja_sesiones WHERE estado = 'abierta') INTO v_existe_abierta;
  IF v_existe_abierta THEN
    RAISE EXCEPTION 'Ya existe una sesión de caja abierta. Cierra la actual antes de abrir una nueva.';
  END IF;

  IF p_saldo_inicial < 0 THEN
    RAISE EXCEPTION 'El saldo inicial no puede ser negativo';
  END IF;

  INSERT INTO caja_sesiones (cajero_id, fecha_apertura, saldo_inicial, estado)
  VALUES (v_user_id, NOW(), p_saldo_inicial, 'abierta')
  RETURNING id INTO v_sesion_id;

  IF p_cargar_huerfanos THEN
    -- Migrar TODOS los cobros sin movimiento (incluye 100% Yape/Plin) con el
    -- monto TOTAL del cobro, igual que el trigger normal sync_cobro_a_caja_movimiento.
    INSERT INTO caja_movimientos (
      sesion_id, tipo, categoria, descripcion, monto,
      cobro_id, cobrador_id, created_at
    )
    SELECT
      v_sesion_id,
      'ingreso',
      'cobro_retroactivo'::categoria_caja_movimiento,
      'Cobro previo · ' || COALESCE(c.numero, 'R-?') ||
        ' · ' || COALESCE(cl.razon_social, c.cliente_externo_nombre, 'CF'),
      c.total,  -- monto TOTAL del cobro (efectivo + yape + plin + transfer)
      c.id,
      c.cobrador_id,
      c.created_at
    FROM cobros c
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    WHERE NOT EXISTS (
      SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id
    )
      AND c.total > 0;

    GET DIAGNOSTICS v_huerfanos_migrados = ROW_COUNT;

    SELECT COALESCE(SUM(monto), 0) INTO v_total_migrado
      FROM caja_movimientos
      WHERE sesion_id = v_sesion_id AND categoria = 'cobro_retroactivo';

    IF v_huerfanos_migrados > 0 THEN
      UPDATE caja_sesiones
        SET notas = CONCAT_WS(' · ',
          NULLIF(p_notas, ''),
          'Cargados ' || v_huerfanos_migrados || ' cobros retroactivos por S/' || v_total_migrado)
        WHERE id = v_sesion_id;
    ELSIF p_notas IS NOT NULL AND p_notas <> '' THEN
      UPDATE caja_sesiones SET notas = p_notas WHERE id = v_sesion_id;
    END IF;
  ELSIF p_notas IS NOT NULL AND p_notas <> '' THEN
    UPDATE caja_sesiones SET notas = p_notas WHERE id = v_sesion_id;
  END IF;

  RETURN jsonb_build_object(
    'sesion_id', v_sesion_id,
    'huerfanos_migrados', v_huerfanos_migrados,
    'total_migrado', v_total_migrado
  );
END;
$$;
