-- ─────────────────────────────────────────────────────────────────────────────
-- 044: Cargar cobros huérfanos a la nueva sesión de caja al abrir
--
-- Contexto: cuando un vendedor cobra y NO hay caja abierta, el trigger
-- sync_cobro_a_caja_movimiento (031) no crea el movimiento en
-- caja_movimientos. El cobro queda "huérfano" — existe pero sin
-- trazabilidad de caja.
--
-- Daniel sugirió: al abrir caja, avisar al cajero/admin que hay cobros
-- sin caja y ofrecer cargarlos a la nueva sesión. Coincido con su
-- planteamiento; es la opción más limpia (alternativas: rechazar cobros
-- sin caja — bloquearía al vendedor, o asignar automáticamente sin
-- avisar — pierde transparencia).
--
-- Esta migración expone:
--   1) contar_cobros_huerfanos() — cuántos cobros sin caja hay y su info
--   2) abrir_caja_con_huerfanos(p_saldo, p_cargar) — abre la sesión y
--      opcionalmente migra los huérfanos
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Función para listar/contar cobros huérfanos (sin movimiento de caja)
CREATE OR REPLACE FUNCTION contar_cobros_huerfanos()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resultado JSONB;
BEGIN
  SELECT jsonb_build_object(
    'count', COUNT(*),
    'total', COALESCE(SUM(c.total), 0),
    'efectivo_total', COALESCE(SUM(c.efectivo), 0),
    'fecha_minima', MIN(c.created_at),
    'fecha_maxima', MAX(c.created_at),
    'cobros', COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'numero', c.numero,
      'fecha', c.fecha,
      'created_at', c.created_at,
      'total', c.total,
      'efectivo', c.efectivo,
      'cobrador', p.full_name,
      'cliente', cl.razon_social
    ) ORDER BY c.created_at), '[]'::jsonb)
  )
  INTO v_resultado
  FROM cobros c
  LEFT JOIN profiles p ON p.id = c.cobrador_id
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  WHERE NOT EXISTS (
    SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id
  );

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION contar_cobros_huerfanos TO authenticated;

-- ── Función atómica: abrir caja + opcionalmente migrar huérfanos
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

  -- Validar que no haya otra sesión abierta
  SELECT EXISTS (SELECT 1 FROM caja_sesiones WHERE estado = 'abierta') INTO v_existe_abierta;
  IF v_existe_abierta THEN
    RAISE EXCEPTION 'Ya existe una sesión de caja abierta. Cierra la actual antes de abrir una nueva.';
  END IF;

  IF p_saldo_inicial < 0 THEN
    RAISE EXCEPTION 'El saldo inicial no puede ser negativo';
  END IF;

  -- Insertar la sesión
  INSERT INTO caja_sesiones (
    cajero_id, fecha_apertura, saldo_inicial, estado
  ) VALUES (
    v_user_id, NOW(), p_saldo_inicial, 'abierta'
  )
  RETURNING id INTO v_sesion_id;

  -- Si se pidió migrar, crear movimientos para los cobros huérfanos.
  -- El trigger sync_cobro_a_caja_movimiento NO se dispara porque
  -- insertamos directo en caja_movimientos.
  IF p_cargar_huerfanos THEN
    INSERT INTO caja_movimientos (
      sesion_id, tipo, categoria, descripcion, monto,
      cobro_id, cobrador_id, created_at
    )
    SELECT
      v_sesion_id,
      'ingreso',
      'cobro_retroactivo',
      'Cobro previo a apertura · ' || COALESCE(c.numero, 'R-?') ||
        ' · ' || COALESCE(cl.razon_social, c.cliente_externo_nombre, 'CF'),
      c.efectivo,  -- solo el efectivo cuenta como movimiento de caja
      c.id,
      c.cobrador_id,
      c.created_at  -- preservar la hora real del cobro, no la apertura
    FROM cobros c
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    WHERE NOT EXISTS (
      SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id
    )
      AND c.efectivo > 0; -- solo migrar los que tienen efectivo

    GET DIAGNOSTICS v_huerfanos_migrados = ROW_COUNT;

    SELECT COALESCE(SUM(monto), 0) INTO v_total_migrado
      FROM caja_movimientos
      WHERE sesion_id = v_sesion_id AND categoria = 'cobro_retroactivo';

    -- Anotación en la sesión para trazabilidad
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

GRANT EXECUTE ON FUNCTION abrir_caja_con_huerfanos TO authenticated;

-- ── Agregar columna notas a caja_sesiones si no existe (la usábamos arriba)
ALTER TABLE caja_sesiones
  ADD COLUMN IF NOT EXISTS notas TEXT;
