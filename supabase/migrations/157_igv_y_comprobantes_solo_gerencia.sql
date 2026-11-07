-- El IGV y la edición de comprobantes, solo para gerencia y administración.
--
-- Daniel, 07/11/2026: "en el aplicativo no tiene que tener acceso a modificar
-- el IGV los vendedores ni los repartidores, solo la gerencia y administrador
-- tengan acceso a modificar comprobante o igv". Un pedido "sin IGV" que hizo
-- un vendedor desde la PWA terminó en la boleta B002-1692, rechazada por SUNAT.
--
--   1. Un pedido "sin IGV" solo lo puede dejar así administración o gerencia.
--      Si lo guarda otro (incluida una PWA vieja que todavía muestre el
--      interruptor), se guarda con IGV incluido en el mismo total: el cliente
--      paga lo mismo. Los procesos del sistema (sin usuario) no se tocan.
--   2. Editar un comprobante (líneas, cliente, agregar o quitar productos):
--      antes también el rol facturador; ahora solo administración y gerencia.
--      (Anular ya era solo de ellos. El único usuario facturador nunca entró.)
--   3. emitir_comprobante_atomico: si el pedido lleva IGV y llega sin el
--      desglose, se desglosa del total también en el documento interno, para
--      que la cabecera y las líneas digan lo mismo.

-- ── 1. Pedidos: "sin IGV" solo gerencia y administración ────────────────────
CREATE OR REPLACE FUNCTION public.pedido_igv_solo_gerencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rol TEXT;
BEGIN
  IF NEW.incluir_igv IS DISTINCT FROM FALSE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.incluir_igv IS NOT DISTINCT FROM FALSE THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT role::text INTO v_rol FROM profiles WHERE id = auth.uid();
  IF v_rol IN ('administrador', 'gerente') THEN RETURN NEW; END IF;

  NEW.incluir_igv := TRUE;
  IF COALESCE(NEW.total, 0) > 0 THEN
    NEW.igv := ROUND(NEW.total - NEW.total / (1 + igv_vigente() / 100.0), 2);
    NEW.subtotal := NEW.total - NEW.igv;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pedido_igv_solo_gerencia ON public.pedidos;
CREATE TRIGGER trg_pedido_igv_solo_gerencia
  BEFORE INSERT OR UPDATE OF incluir_igv ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedido_igv_solo_gerencia();

-- ── 2. Editar comprobantes: solo administración y gerencia ─────────────────
-- Se reescribe cada función cambiando solo la lista de roles (y el texto del
-- mensaje si lo nombra), sin tocar el resto de su lógica.
DO $$
DECLARE f TEXT; d TEXT; n TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['editar_comprobante_item', 'editar_cliente_comprobante',
                           'agregar_item_comprobante', 'eliminar_item_comprobante'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d
      FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname = 'public' AND p.proname = f;
    IF d IS NULL THEN RAISE EXCEPTION 'No existe la función %', f; END IF;
    n := replace(d, '''administrador'', ''gerente'', ''facturador''', '''administrador'', ''gerente''');
    IF n = d THEN RAISE EXCEPTION 'La función % no tenía la lista de roles esperada', f; END IF;
    n := replace(n, '(requiere administrador/gerente/facturador)', '(solo administración o gerencia)');
    EXECUTE n;
  END LOOP;
END $$;

-- ── 3. Documento interno con IGV: desglosado como las líneas ───────────────
DO $$
DECLARE d TEXT; n TEXT;
BEGIN
  SELECT pg_get_functiondef('public.emitir_comprobante_atomico(uuid,text,text,text,date,numeric,numeric,numeric,uuid)'::regprocedure) INTO d;
  n := replace(d,
    'IF p_tipo IN (''factura'', ''boleta'') AND COALESCE(p_igv, 0) = 0 AND COALESCE(p_total, 0) > 0 THEN',
    'IF (p_tipo IN (''factura'', ''boleta'') OR v_pedido.incluir_igv) AND COALESCE(p_igv, 0) = 0 AND COALESCE(p_total, 0) > 0 THEN');
  IF n = d THEN RAISE EXCEPTION 'emitir_comprobante_atomico no tenía la condición esperada (migración 156)'; END IF;
  EXECUTE n;
END $$;
