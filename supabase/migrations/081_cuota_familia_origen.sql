-- ─────────────────────────────────────────────────────────────────────────────
-- 081: Origen de la cuota por familia (manual vs rollup de productos)
--
-- Problema detectado al probar la migración 080: al guardar cuotas por producto,
-- el rollup ponía en CERO las cuotas de las familias sin detalle de producto,
-- borrando las que Daniel había cargado a mano en la matriz por familia.
--
-- Solución: cada cuota de familia recuerda de dónde viene.
--   'manual'    → la digitó una persona en la matriz por familia. Intocable.
--   'productos' → la calculó el rollup. Solo estas se recalculan o ponen en cero.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cuotas_vendedor_familia
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'manual'
  CHECK (origen IN ('manual', 'productos'));

COMMENT ON COLUMN cuotas_vendedor_familia.origen IS
  'manual = digitada en la matriz por familia; productos = calculada como suma de las cuotas por producto.';

-- Marcar como "productos" las que hoy ya provienen de un rollup
UPDATE cuotas_vendedor_familia cf
SET origen = 'productos'
WHERE EXISTS (
  SELECT 1 FROM cuotas_vendedor_producto cp
  JOIN productos pr ON pr.id = cp.producto_id
  WHERE cp.vendedor_id = cf.vendedor_id AND cp.anio = cf.anio AND cp.mes = cf.mes
    AND pr.familia_id = cf.familia_id
);

-- ── Rollup: ahora marca origen='productos'
CREATE OR REPLACE FUNCTION sincronizar_cuota_familia_desde_productos(
  p_anio INT,
  p_mes INT,
  p_vendedor_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INT := 0;
BEGIN
  INSERT INTO cuotas_vendedor_familia (
    vendedor_id, familia_id, anio, mes, cuota_monto, origen, created_by, updated_by
  )
  SELECT cp.vendedor_id, pr.familia_id, p_anio, p_mes,
         SUM(cp.cuota_valor), 'productos', v_uid, v_uid
  FROM cuotas_vendedor_producto cp
  JOIN productos pr ON pr.id = cp.producto_id
  WHERE cp.anio = p_anio AND cp.mes = p_mes
    AND pr.familia_id IS NOT NULL
    AND (p_vendedor_id IS NULL OR cp.vendedor_id = p_vendedor_id)
  GROUP BY cp.vendedor_id, pr.familia_id
  ON CONFLICT (vendedor_id, familia_id, anio, mes) DO UPDATE
    SET cuota_monto = EXCLUDED.cuota_monto,
        origen      = 'productos',
        updated_by  = v_uid,
        updated_at  = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION sincronizar_cuota_familia_desde_productos TO authenticated;

-- ── Upsert de cuotas por producto: la limpieza ya NO toca las cuotas manuales
CREATE OR REPLACE FUNCTION upsert_cuotas_producto_mes(
  p_anio INT,
  p_mes INT,
  p_vendedor_id UUID,
  p_cuotas JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rol TEXT;
  v_item JSONB;
  v_prod UUID;
  v_cant NUMERIC;
  v_val  NUMERIC;
  v_guardadas INT := 0;
  v_borradas  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role::text INTO v_rol FROM profiles WHERE id = v_uid;
  IF v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo administrador o gerencia pueden asignar cuotas';
  END IF;

  IF p_vendedor_id IS NULL THEN RAISE EXCEPTION 'Debe indicar el vendedor'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_cuotas, '[]'::jsonb)) LOOP
    v_prod := (v_item->>'producto_id')::UUID;
    v_cant := COALESCE((v_item->>'cuota_cantidad')::NUMERIC, 0);
    v_val  := COALESCE((v_item->>'cuota_valor')::NUMERIC, 0);

    IF v_prod IS NULL THEN CONTINUE; END IF;

    IF v_cant = 0 AND v_val = 0 THEN
      DELETE FROM cuotas_vendedor_producto
      WHERE vendedor_id = p_vendedor_id AND producto_id = v_prod
        AND anio = p_anio AND mes = p_mes;
      IF FOUND THEN v_borradas := v_borradas + 1; END IF;
    ELSE
      INSERT INTO cuotas_vendedor_producto (
        vendedor_id, producto_id, anio, mes, cuota_cantidad, cuota_valor,
        created_by, updated_by
      ) VALUES (
        p_vendedor_id, v_prod, p_anio, p_mes, v_cant, v_val, v_uid, v_uid
      )
      ON CONFLICT (vendedor_id, producto_id, anio, mes) DO UPDATE
        SET cuota_cantidad = EXCLUDED.cuota_cantidad,
            cuota_valor    = EXCLUDED.cuota_valor,
            updated_by     = v_uid,
            updated_at     = NOW();
      v_guardadas := v_guardadas + 1;
    END IF;
  END LOOP;

  -- Recalcular el rollup de este vendedor
  PERFORM sincronizar_cuota_familia_desde_productos(p_anio, p_mes, p_vendedor_id);

  -- Familias cuya cuota VENÍA del rollup y ya no tienen productos → 0.
  -- Las cuotas cargadas a mano (origen='manual') se respetan siempre.
  UPDATE cuotas_vendedor_familia cf
  SET cuota_monto = 0, updated_by = v_uid, updated_at = NOW()
  WHERE cf.vendedor_id = p_vendedor_id AND cf.anio = p_anio AND cf.mes = p_mes
    AND cf.origen = 'productos'
    AND NOT EXISTS (
      SELECT 1 FROM cuotas_vendedor_producto cp
      JOIN productos pr ON pr.id = cp.producto_id
      WHERE cp.vendedor_id = p_vendedor_id AND cp.anio = p_anio AND cp.mes = p_mes
        AND pr.familia_id = cf.familia_id
    );

  RETURN jsonb_build_object('guardadas', v_guardadas, 'borradas', v_borradas);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_cuotas_producto_mes TO authenticated;

-- ── La matriz por familia marca lo que se digita a mano como 'manual',
-- pero NO pisa una familia que ya se controla por productos (esa manda).
CREATE OR REPLACE FUNCTION upsert_cuotas_mes(
  p_anio INT,
  p_mes INT,
  p_cuotas JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rol TEXT;
  v_item JSONB;
  v_count INT := 0;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT role::text INTO v_rol FROM profiles WHERE id = v_user_id;
  IF v_rol NOT IN ('administrador', 'gerente') THEN
    RAISE EXCEPTION 'Solo admin/gerente pueden asignar cuotas';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cuotas) LOOP
    -- Si esa familia ya tiene cuotas por producto, el detalle manda: no la pisamos
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM cuotas_vendedor_producto cp
      JOIN productos pr ON pr.id = cp.producto_id
      WHERE cp.vendedor_id = (v_item->>'vendedor_id')::UUID
        AND cp.anio = p_anio AND cp.mes = p_mes
        AND pr.familia_id = (v_item->>'familia_id')::UUID
    );

    INSERT INTO cuotas_vendedor_familia (
      vendedor_id, familia_id, anio, mes, cuota_monto, origen, created_by, updated_by
    ) VALUES (
      (v_item->>'vendedor_id')::UUID,
      (v_item->>'familia_id')::UUID,
      p_anio, p_mes,
      COALESCE((v_item->>'cuota_monto')::NUMERIC, 0),
      'manual', v_user_id, v_user_id
    )
    ON CONFLICT (vendedor_id, familia_id, anio, mes) DO UPDATE
      SET cuota_monto = EXCLUDED.cuota_monto,
          origen      = 'manual',
          updated_by  = v_user_id,
          updated_at  = NOW();
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_cuotas_mes TO authenticated;
