-- ═══════════════════════════════════════════════════════════════════════════
-- 111 · Consolidar el despacho en una sola operación, y una sola vez
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Daniel lo reportó: "por error involuntario dieron doble click en consolidar y
-- emitir hoja de ruta, se cargó 2 veces".
--
-- Lo que pasó de verdad no fue un doble clic
-- ------------------------------------------
-- Los dos despachos del 16/09 se crearon con SEIS MINUTOS de diferencia
-- (00:46:09 y 00:52:09 UTC), con los mismos diez pedidos y el mismo total. No
-- fue una carrera de dos clics seguidos: fue la pantalla apretada dos veces con
-- la lista vieja en el medio.
--
-- Y eso importa, porque deshabilitar el botón mientras guarda —que es el
-- reflejo habitual— no habría evitado nada. Seis minutos después el botón ya
-- estaba habilitado otra vez.
--
-- Tampoco es la primera vez: hay 39 pedidos repartidos en más de un despacho,
-- sobre 7 despachos. El 29/08 los mismos 22 pedidos se consolidaron TRES veces.
--
-- Por qué podía pasar
-- -------------------
-- La consolidación eran tres escrituras sueltas desde el navegador:
--
--   1. INSERT en despachos
--   2. INSERT en despachos_items
--   3. UPDATE de pedidos a 'despachado'
--
-- Sin transacción —si la segunda fallaba quedaba un despacho huérfano— y, sobre
-- todo, sin volver a mirar el estado de los pedidos al guardar. La lista se
-- arma con los pedidos en 'facturado', pero esa lista vive en el navegador: una
-- vez consolidados pasan a 'despachado' y la pantalla no se entera. Quien
-- vuelva a apretar consolida de nuevo lo mismo.
--
-- El arreglo
-- ----------
-- Todo en una función, en una transacción, y comprobando contra la base —no
-- contra lo que el navegador cree— que cada pedido esté en 'facturado' y no
-- figure ya en otro despacho. Si alguno no cumple, no se crea nada y el mensaje
-- dice cuáles son.
--
-- Lo que NO se toca
-- -----------------
-- Los 7 despachos que ya tienen pedidos repetidos se dejan como están. Cinco
-- son de agosto, están en 'completado' y tienen salida, retorno y kilómetros
-- registrados: reescribir eso sería inventar historia. Por eso la garantía va
-- en la función y no en un índice único, que obligaría a limpiarlos.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION consolidar_despacho(
  p_vehiculo_id   UUID,
  p_pedido_ids    UUID[],
  p_repartidor_id UUID    DEFAULT NULL,
  p_orden_entrega JSONB   DEFAULT NULL,
  p_peso_total_kg NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user       UUID := auth.uid();
  v_rol        TEXT;
  v_despacho   UUID;
  v_numero     TEXT;
  v_total      NUMERIC := 0;
  v_cuantos    INT;
  v_malos      TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT role INTO v_rol FROM profiles WHERE id = v_user;
  IF v_rol IS NULL OR v_rol NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'Sin permisos para consolidar despachos';
  END IF;

  IF p_vehiculo_id IS NULL THEN RAISE EXCEPTION 'Hay que indicar el vehículo'; END IF;
  IF p_pedido_ids IS NULL OR array_length(p_pedido_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No hay pedidos para consolidar';
  END IF;

  /*
   * El bloqueo. Se toman las filas de los pedidos para este despacho antes de
   * mirarlas: si dos pantallas consolidan a la vez, la segunda espera acá y
   * cuando entra ya ve los pedidos en 'despachado'.
   */
  PERFORM 1 FROM pedidos WHERE id = ANY(p_pedido_ids) FOR UPDATE;

  -- ¿Alguno dejó de estar disponible mientras la pantalla miraba otra cosa?
  SELECT STRING_AGG(numero || ' (' || estado || ')', ', ' ORDER BY numero)
    INTO v_malos
    FROM pedidos
   WHERE id = ANY(p_pedido_ids) AND estado <> 'facturado';

  IF v_malos IS NOT NULL THEN
    RAISE EXCEPTION 'Estos pedidos ya no están para despachar: %. '
      'Probablemente ya se consolidaron desde otra pantalla: recargá y volvé a intentar.', v_malos;
  END IF;

  -- ¿Alguno figura ya en un despacho? Es la misma pregunta por el otro lado,
  -- y cubre el caso de un pedido cuyo estado quedó mal por una mano anterior.
  SELECT STRING_AGG(DISTINCT p.numero || ' → ' || d.numero, ', ')
    INTO v_malos
    FROM despachos_items i
    JOIN despachos d ON d.id = i.despacho_id
    JOIN pedidos   p ON p.id = i.pedido_id
   WHERE i.pedido_id = ANY(p_pedido_ids);

  IF v_malos IS NOT NULL THEN
    RAISE EXCEPTION 'Estos pedidos ya están en un despacho: %.', v_malos;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(total), 0) INTO v_cuantos, v_total
    FROM pedidos WHERE id = ANY(p_pedido_ids);

  IF v_cuantos <> array_length(p_pedido_ids, 1) THEN
    RAISE EXCEPTION 'Alguno de los pedidos no existe';
  END IF;

  /*
   * El número. Antes salía de los últimos cuatro dígitos del reloj del
   * navegador, que pueden repetirse. Se busca uno libre acá, y la unicidad la
   * garantiza el índice de la tabla.
   */
  LOOP
    v_numero := 'D-' || TO_CHAR((NOW() AT TIME ZONE 'America/Lima')::date, 'YYYYMMDD')
                || '-' || LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM despachos WHERE numero = v_numero);
  END LOOP;

  INSERT INTO despachos (
    numero, vehiculo_id, fecha_despacho, estado,
    total_pedidos, total_monto, peso_total_kg,
    orden_entrega, hoja_ruta_emitida_at, repartidor_id, created_by
  ) VALUES (
    v_numero, p_vehiculo_id, (NOW() AT TIME ZONE 'America/Lima')::date, 'preparacion',
    v_cuantos, v_total, COALESCE(p_peso_total_kg, 0),
    p_orden_entrega, NOW(), p_repartidor_id, v_user
  ) RETURNING id INTO v_despacho;

  INSERT INTO despachos_items (despacho_id, pedido_id, estado)
  SELECT v_despacho, unnest(p_pedido_ids), 'pendiente';

  UPDATE pedidos
     SET estado = 'despachado', updated_at = NOW()
   WHERE id = ANY(p_pedido_ids);

  RETURN jsonb_build_object(
    'id', v_despacho,
    'numero', v_numero,
    'pedidos', v_cuantos,
    'total', v_total
  );
END;
$$;

COMMENT ON FUNCTION consolidar_despacho IS
  'Crea un despacho con sus items y marca los pedidos, todo en una transaccion. Se niega si algun pedido no esta en facturado o ya figura en otro despacho: eso es lo que evitaba que la misma pantalla consolide dos veces lo mismo.';

GRANT EXECUTE ON FUNCTION consolidar_despacho TO authenticated;

-- ── Que no quede otro camino ───────────────────────────────────────────────
--
-- La función es inútil si la pantalla puede seguir insertando por su cuenta. Se
-- quita el permiso de INSERT sobre las dos tablas; el UPDATE se conserva,
-- porque iniciar y cerrar la ruta —salida, retorno, kilómetros— sí se hace
-- directo desde la pantalla y no tiene este problema.
--
-- La función no se ve afectada: corre como su dueño.
REVOKE INSERT ON despachos       FROM authenticated;
REVOKE INSERT ON despachos_items FROM authenticated;
