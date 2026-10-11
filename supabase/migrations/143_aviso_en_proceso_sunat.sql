-- Mensaje propio cuando el comprobante está "en proceso" en SUNAT.
--
-- Auditoría 11/10/2026: la 142 bloquea editar/anular un comprobante en proceso,
-- pero el aviso decía "ya fue declarado a SUNAT", que no es cierto y confunde.
-- Se agrega, antes de cada aviso, uno que dice lo que pasa. Lo demás de las
-- funciones queda igual (copiadas de la versión vigente en la base).

CREATE OR REPLACE FUNCTION public.proteger_comprobante_declarado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF comprobante_bloqueado_por_sunat(OLD) THEN
      IF OLD.sunat_estado = 'en_proceso' THEN
        RAISE EXCEPTION 'El comprobante %-% está en proceso en SUNAT (se reintenta solo): no se puede modificar ni anular hasta que SUNAT responda.',
          OLD.serie, OLD.numero;
      END IF;
      RAISE EXCEPTION 'El comprobante %-% ya fue declarado a SUNAT: no se puede borrar. Para dejarlo sin efecto hay que emitir una nota de crédito.',
        OLD.serie, OLD.numero;
    END IF;
    RETURN OLD;
  END IF;

  IF comprobante_bloqueado_por_sunat(OLD) THEN
    IF ROW(NEW.tipo, NEW.serie, NEW.numero, NEW.pedido_id, NEW.cliente_id, NEW.fecha_emision,
           NEW.fecha_vencimiento, NEW.subtotal, NEW.igv, NEW.percepcion, NEW.total, NEW.moneda,
           NEW.tipo_cambio, NEW.estado, NEW.cliente_externo_nombre, NEW.cliente_externo_doc,
           NEW.fecha_despacho, NEW.referencia_comprobante_id)
       IS DISTINCT FROM
       ROW(OLD.tipo, OLD.serie, OLD.numero, OLD.pedido_id, OLD.cliente_id, OLD.fecha_emision,
           OLD.fecha_vencimiento, OLD.subtotal, OLD.igv, OLD.percepcion, OLD.total, OLD.moneda,
           OLD.tipo_cambio, OLD.estado, OLD.cliente_externo_nombre, OLD.cliente_externo_doc,
           OLD.fecha_despacho, OLD.referencia_comprobante_id)
    THEN
      IF OLD.sunat_estado = 'en_proceso' THEN
        RAISE EXCEPTION 'El comprobante %-% está en proceso en SUNAT (se reintenta solo): no se puede modificar ni anular hasta que SUNAT responda.',
          OLD.serie, OLD.numero;
      END IF;
      RAISE EXCEPTION 'El comprobante %-% ya fue declarado a SUNAT (o se está enviando en este momento): no se puede modificar. Para corregirlo hay que emitir una nota de crédito.',
        OLD.serie, OLD.numero;
    END IF;
    -- El XML que se declaró es el que vale: no se reemplaza.
    IF OLD.enviado_sunat AND OLD.sunat_modo = 'produccion' AND NEW.sunat_xml IS DISTINCT FROM OLD.sunat_xml THEN
      RAISE EXCEPTION 'El XML declarado de %-% no se puede reemplazar.', OLD.serie, OLD.numero;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.proteger_items_comprobante_declarado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp comprobantes;
BEGIN
  -- Borrar o desvincular un producto del catálogo pone producto_id en NULL en
  -- las líneas viejas: eso no cambia lo declarado y no tiene que trabarse.
  IF TG_OP = 'UPDATE'
     AND NEW.producto_id IS NULL AND OLD.producto_id IS NOT NULL
     AND ROW(NEW.comprobante_id, NEW.descripcion, NEW.cantidad, NEW.precio_unitario, NEW.subtotal, NEW.igv_porcentaje)
         IS NOT DISTINCT FROM
         ROW(OLD.comprobante_id, OLD.descripcion, OLD.cantidad, OLD.precio_unitario, OLD.subtotal, OLD.igv_porcentaje)
  THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_comp FROM comprobantes
   WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.comprobante_id ELSE OLD.comprobante_id END;
  IF FOUND AND comprobante_bloqueado_por_sunat(v_comp) THEN
    IF v_comp.sunat_estado = 'en_proceso' THEN
      RAISE EXCEPTION 'El comprobante %-% está en proceso en SUNAT (se reintenta solo): no se puede modificar ni anular hasta que SUNAT responda.',
        v_comp.serie, v_comp.numero;
    END IF;
    RAISE EXCEPTION 'El comprobante %-% ya fue declarado a SUNAT (o se está enviando): sus productos no se pueden modificar.',
      v_comp.serie, v_comp.numero;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.comprobante_id IS DISTINCT FROM OLD.comprobante_id THEN
    SELECT * INTO v_comp FROM comprobantes WHERE id = NEW.comprobante_id;
    IF FOUND AND comprobante_bloqueado_por_sunat(v_comp) THEN
      IF v_comp.sunat_estado = 'en_proceso' THEN
        RAISE EXCEPTION 'El comprobante %-% está en proceso en SUNAT (se reintenta solo): no se puede modificar ni anular hasta que SUNAT responda.',
          v_comp.serie, v_comp.numero;
      END IF;
      RAISE EXCEPTION 'El comprobante %-% ya fue declarado a SUNAT: no se le pueden agregar productos.',
        v_comp.serie, v_comp.numero;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
