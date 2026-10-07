-- Reacomodar los cobros cuando cambia el total de un comprobante.
--
-- Daniel, 07/10/2026, cliente VELASQUEZ CALISAYA DIONISIO: el 02/10 a las 15:44
-- se cobró S/ 71.10 por la B002-00000096, que en ese momento valía S/ 56.10.
-- El cobro se aplicó 56.10 a la boleta y 15.00 "a cuenta" (saldo a favor). A
-- las 16:32 la boleta se editó (se agregó un producto) y pasó a S/ 71.10, pero
-- nadie reacomodó el cobro: el estado de cuenta mostró a la vez "saldo
-- pendiente 15.00" y "saldo a favor 15.00", y el reporte de cobranza el total.
--
-- Los saldos a favor ya se aplicaban solos, pero solo al EMITIR un comprobante
-- (migración 101, aplicar_anticipos_cliente). Ahora también cuando cambia su
-- total o su estado:
--   * si lo aplicado supera el nuevo total (bajó, o se anuló), el excedente
--     vuelve a ser saldo a favor del cliente, con el mismo cobro;
--   * y después el saldo a favor del cliente se aplica a lo que deba (subió).

BEGIN;

CREATE OR REPLACE FUNCTION public.reacomodar_aplicaciones_comprobante(p_comprobante_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
  v_tope NUMERIC;
  v_aplicado NUMERIC;
  v_exceso NUMERIC;
  v_ap RECORD;
  v_quitar NUMERIC;
BEGIN
  SELECT id, cliente_id, total, estado INTO v_comp FROM comprobantes WHERE id = p_comprobante_id;
  IF NOT FOUND OR v_comp.cliente_id IS NULL THEN RETURN; END IF;

  v_tope := CASE WHEN v_comp.estado = 'anulado' THEN 0 ELSE COALESCE(v_comp.total, 0) END;
  SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_aplicado
    FROM cobros_aplicaciones WHERE comprobante_id = p_comprobante_id AND NOT es_a_cuenta;
  v_exceso := ROUND(v_aplicado - v_tope, 2);

  -- Lo cobrado de más vuelve a cuenta del cliente, empezando por lo último aplicado.
  IF v_exceso > 0.005 THEN
    FOR v_ap IN
      SELECT id, cobro_id, monto_aplicado FROM cobros_aplicaciones
       WHERE comprobante_id = p_comprobante_id AND NOT es_a_cuenta
       ORDER BY created_at DESC, id DESC
    LOOP
      EXIT WHEN v_exceso <= 0.005;
      v_quitar := LEAST(v_exceso, v_ap.monto_aplicado);
      IF v_quitar >= v_ap.monto_aplicado - 0.005 THEN
        DELETE FROM cobros_aplicaciones WHERE id = v_ap.id;
      ELSE
        UPDATE cobros_aplicaciones SET monto_aplicado = ROUND(monto_aplicado - v_quitar, 2) WHERE id = v_ap.id;
      END IF;
      INSERT INTO cobros_aplicaciones (cobro_id, comprobante_id, monto_aplicado, es_a_cuenta)
      VALUES (v_ap.cobro_id, NULL, ROUND(v_quitar, 2), TRUE);
      v_exceso := ROUND(v_exceso - v_quitar, 2);
    END LOOP;
  END IF;

  -- Y el saldo a favor del cliente cubre lo que deba (incluida esta, si subió).
  PERFORM aplicar_anticipos_cliente(v_comp.cliente_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_reacomodar_cobros_al_editar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM reacomodar_aplicaciones_comprobante(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_comprobantes_reacomodar_cobros ON public.comprobantes;
CREATE TRIGGER trg_comprobantes_reacomodar_cobros
  AFTER UPDATE OF total, estado ON public.comprobantes
  FOR EACH ROW
  WHEN (OLD.total IS DISTINCT FROM NEW.total OR OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.trg_reacomodar_cobros_al_editar();

-- El caso de Daniel: el saldo a favor de 15.00 pasa a cubrir la B002-00000096.
SELECT public.aplicar_anticipos_cliente(id)
  FROM public.clientes WHERE razon_social ILIKE 'VELASQUEZ CALISAYA DIONISIO%';

COMMIT;
