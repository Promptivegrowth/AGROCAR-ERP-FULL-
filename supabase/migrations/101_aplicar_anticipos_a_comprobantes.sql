-- ═══════════════════════════════════════════════════════════════════════════
-- 101 · Los anticipos se aplican solos a las boletas que vienen después
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El problema
-- -----------
-- Cuando un cliente paga de más, `aplicar_cobro_fifo` cancela lo que debe y
-- deja el excedente como una línea "a cuenta" (comprobante_id NULL,
-- es_a_cuenta TRUE). Hasta ahí, bien: es plata a favor del cliente.
--
-- Lo que faltaba es la otra mitad. Cuando después se le emite una boleta
-- nueva, nadie iba a buscar ese saldo a favor: el anticipo quedaba flotando
-- para siempre y la boleta nacía con toda su deuda.
--
-- El estado de cuenta suma saldo comprobante por comprobante y descarta las
-- líneas a cuenta, así que le mostraba al cliente una deuda que ya estaba
-- pagada. El caso que lo destapó: VALENTIN HUANCOLLO MACHACA pagó S/ 745
-- contra una boleta de S/ 648 el 19/08; los S/ 97 de vuelto quedaron a
-- cuenta. El 26/08 se le facturó S/ 753.34 y el cobrador le cobró S/ 656.34
-- descontando esos 97 —correcto en la calle—, pero el reporte seguía
-- reclamándole S/ 97.
--
-- Al medirlo en toda la base eran S/ 15,410.32 en anticipos sueltos de 32
-- clientes, de los cuales S/ 5,346.72 aparecían como deuda pendiente de 17
-- clientes que en realidad no debían nada. La PWA nunca se equivocó, porque
-- compara facturado contra cobrado a nivel cliente y no mira aplicaciones.
--
-- La solución
-- -----------
-- 1. `aplicar_anticipos_cliente` consume los saldos a favor contra los
--    comprobantes con deuda, del más viejo al más nuevo.
-- 2. Un trigger la llama cada vez que se emite un comprobante.
-- 3. Al final, un backfill que salda lo que ya está en la base.
--
-- Un anticipo consumido no se borra: se parte. La línea a cuenta baja por el
-- monto usado y nace una línea normal apuntando al comprobante. Así la suma
-- de aplicaciones de un cobro sigue siendo igual a su total, que es la
-- invariante de la que cuelga todo el módulo de cobranzas.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION aplicar_anticipos_cliente(p_cliente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ant RECORD;
  v_comp RECORD;
  v_disponible NUMERIC;
  v_aplicar NUMERIC;
  v_total_aplicado NUMERIC := 0;
  v_movimientos JSONB := '[]'::JSONB;
BEGIN
  IF p_cliente_id IS NULL THEN
    RETURN jsonb_build_object('aplicado', 0, 'movimientos', '[]'::JSONB);
  END IF;

  -- Saldos a favor del cliente, del más antiguo primero: si tiene varios,
  -- se gasta el que lleva más tiempo esperando.
  FOR v_ant IN
    SELECT ca.id, ca.cobro_id, ca.monto_aplicado, co.numero AS cobro_numero
    FROM cobros_aplicaciones ca
    JOIN cobros co ON co.id = ca.cobro_id
    WHERE co.cliente_id = p_cliente_id
      AND ca.es_a_cuenta
      AND ca.comprobante_id IS NULL
      AND ca.monto_aplicado > 0.005
    ORDER BY co.fecha ASC, ca.created_at ASC
  LOOP
    v_disponible := v_ant.monto_aplicado;

    -- Comprobantes con deuda, del más viejo al más nuevo (FIFO), igual que
    -- hace `aplicar_cobro_fifo` con un cobro fresco.
    FOR v_comp IN
      SELECT c.id, c.serie, c.numero,
        ROUND(c.total - COALESCE((
          SELECT SUM(ca2.monto_aplicado) FROM cobros_aplicaciones ca2
          WHERE ca2.comprobante_id = c.id
        ), 0), 2) AS saldo
      FROM comprobantes c
      WHERE c.cliente_id = p_cliente_id
        AND c.estado <> 'anulado'
      ORDER BY c.fecha_emision ASC, c.created_at ASC
    LOOP
      EXIT WHEN v_disponible <= 0.005;
      CONTINUE WHEN v_comp.saldo <= 0.005;

      v_aplicar := ROUND(LEAST(v_disponible, v_comp.saldo), 2);

      INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
      VALUES (v_ant.cobro_id, v_comp.id, v_aplicar, FALSE);

      v_disponible := ROUND(v_disponible - v_aplicar, 2);
      v_total_aplicado := v_total_aplicado + v_aplicar;

      v_movimientos := v_movimientos || jsonb_build_object(
        'cobro', v_ant.cobro_numero,
        'comprobante', v_comp.serie || '-' || v_comp.numero,
        'monto', v_aplicar
      );
    END LOOP;

    -- Lo que sobró sigue siendo saldo a favor. Si se consumió entero, la
    -- línea a cuenta desaparece.
    IF v_disponible <= 0.005 THEN
      DELETE FROM cobros_aplicaciones WHERE id = v_ant.id;
    ELSIF v_disponible < v_ant.monto_aplicado THEN
      UPDATE cobros_aplicaciones SET monto_aplicado = v_disponible WHERE id = v_ant.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('aplicado', v_total_aplicado, 'movimientos', v_movimientos);
END;
$$;

COMMENT ON FUNCTION aplicar_anticipos_cliente IS
  'Consume los saldos a favor (lineas es_a_cuenta) del cliente contra sus comprobantes con deuda, del mas viejo al mas nuevo. Idempotente: si no hay anticipos o no hay deuda, no hace nada.';

GRANT EXECUTE ON FUNCTION aplicar_anticipos_cliente TO authenticated;


-- ── Al emitir un comprobante, cobrarle primero al saldo a favor ────────────
--
-- Va AFTER INSERT y no BEFORE porque el anticipo se aplica contra un
-- comprobante que ya existe. El total viene puesto desde el INSERT
-- (`emitir_comprobante_atomico` y las demás lo calculan antes), así que acá
-- ya se sabe cuánto debe.
CREATE OR REPLACE FUNCTION trg_aplicar_anticipos_al_emitir()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cliente_id IS NOT NULL AND NEW.estado <> 'anulado' THEN
    PERFORM aplicar_anticipos_cliente(NEW.cliente_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comprobantes_aplicar_anticipos ON comprobantes;
CREATE TRIGGER trg_comprobantes_aplicar_anticipos
  AFTER INSERT ON comprobantes
  FOR EACH ROW
  EXECUTE FUNCTION trg_aplicar_anticipos_al_emitir();


-- ── Saldar lo que ya está en la base ──────────────────────────────────────
DO $$
DECLARE
  v_cli UUID;
  v_res JSONB;
  v_total NUMERIC := 0;
  v_clientes INT := 0;
BEGIN
  FOR v_cli IN
    SELECT DISTINCT co.cliente_id
    FROM cobros_aplicaciones ca
    JOIN cobros co ON co.id = ca.cobro_id
    WHERE ca.es_a_cuenta
      AND ca.comprobante_id IS NULL
      AND ca.monto_aplicado > 0.005
      AND co.cliente_id IS NOT NULL
  LOOP
    v_res := aplicar_anticipos_cliente(v_cli);
    IF (v_res->>'aplicado')::NUMERIC > 0 THEN
      v_clientes := v_clientes + 1;
      v_total := v_total + (v_res->>'aplicado')::NUMERIC;
    END IF;
  END LOOP;

  RAISE NOTICE 'Anticipos aplicados: S/ % en % clientes', v_total, v_clientes;
END $$;
