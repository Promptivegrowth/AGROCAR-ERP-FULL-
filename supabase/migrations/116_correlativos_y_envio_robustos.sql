-- Correlativos que no se saltan, un comprobante por pedido, y lo declarado
-- que no se toca.
--
-- Daniel: usar los tres días del plazo de SUNAT para corregir o anular desde
-- el sistema, "bien robusto y que los correlativos corran bien". Revisando
-- el flujo completo aparecieron cuatro puntos flojos. Ninguno había dejado
-- marcas —el respaldo de 1.472 comprobantes no tiene saltos ni pedidos con
-- dos facturas—, pero nada los impedía.

BEGIN;

-- ── 1. El número se asigna en la misma transacción que crea el comprobante ──
--
-- La pantalla pedía el número con `siguiente_correlativo` y DESPUÉS llamaba a
-- `emitir_comprobante_atomico`. Si la emisión fallaba —un corte de internet,
-- un pedido sin productos, un doble clic— el número ya estaba consumido y la
-- serie quedaba con un salto.
--
-- Ahora, si no se le pasa serie y número, los toma ella misma: el correlativo
-- se incrementa dentro de la transacción y, si algo falla, vuelve atrás con
-- todo lo demás. Si se le pasan, los respeta: así sigue funcionando la
-- pantalla vieja mientras el navegador no se recarga, sin gastar dos números.
--
-- Y no deja facturar dos veces el mismo pedido.
CREATE OR REPLACE FUNCTION public.emitir_comprobante_atomico(
  p_pedido_id uuid, p_tipo text, p_serie text, p_numero text, p_fecha_emision date,
  p_subtotal numeric, p_igv numeric, p_total numeric, p_facturador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido RECORD;
  v_comp_id UUID;
  v_items_count INT;
  v_serie TEXT;
  v_numero TEXT;
  v_previo RECORD;
BEGIN
  -- El pedido queda bloqueado hasta terminar: dos emisiones del mismo pedido
  -- al mismo tiempo se ponen en fila y la segunda ve el comprobante de la
  -- primera.
  SELECT p.id, p.cliente_id, p.incluir_igv, p.estado, p.fecha_despacho
    INTO v_pedido FROM pedidos p WHERE p.id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;

  IF p_tipo IN ('factura', 'boleta', 'nota_pedido_interna') THEN
    SELECT serie, numero INTO v_previo FROM comprobantes
     WHERE pedido_id = p_pedido_id AND estado <> 'anulado'
       AND tipo IN ('factura', 'boleta', 'nota_pedido_interna')
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Este pedido ya tiene el comprobante %-%. Para emitir otro, primero hay que anular ese.',
        v_previo.serie, v_previo.numero;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_items_count FROM pedidos_items WHERE pedido_id = p_pedido_id;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'No se puede emitir comprobante: el pedido % no tiene productos', p_pedido_id;
  END IF;

  IF p_serie IS NULL OR p_numero IS NULL OR trim(p_serie) = '' OR trim(p_numero) = '' THEN
    SELECT s.serie, s.numero INTO v_serie, v_numero
      FROM siguiente_correlativo(p_tipo::tipo_comprobante) s;
  ELSE
    v_serie := p_serie;
    v_numero := p_numero;
  END IF;

  INSERT INTO comprobantes (
    pedido_id, cliente_id, tipo, serie, numero,
    fecha_emision, fecha_despacho,
    subtotal, igv, total, moneda, estado,
    facturador_id
  ) VALUES (
    p_pedido_id, v_pedido.cliente_id,
    p_tipo::tipo_comprobante,
    v_serie, v_numero,
    p_fecha_emision, v_pedido.fecha_despacho,
    p_subtotal, p_igv, p_total,
    'PEN'::moneda,
    'emitido'::estado_comprobante,
    p_facturador_id
  )
  RETURNING id INTO v_comp_id;

  INSERT INTO comprobantes_items (
    comprobante_id, producto_id, descripcion, cantidad,
    precio_unitario, subtotal, igv_porcentaje
  )
  SELECT
    v_comp_id,
    pi.producto_id,
    COALESCE(NULLIF(TRIM(pi.descripcion_libre), ''), TRIM(p.descripcion), p.nombre, '—'),
    pi.cantidad,
    pi.precio_unitario,
    pi.subtotal,
    -- El IGV configurado (migración 112), no un 18 escrito a mano.
    CASE WHEN v_pedido.incluir_igv THEN igv_vigente() ELSE 0 END
  FROM pedidos_items pi
  LEFT JOIN productos p ON p.id = pi.producto_id
  WHERE pi.pedido_id = p_pedido_id;

  GET DIAGNOSTICS v_items_count = ROW_COUNT;
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'Error al copiar items del pedido al comprobante. Rollback.';
  END IF;

  UPDATE pedidos SET estado = 'facturado'::estado_pedido, updated_at = NOW() WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'id', v_comp_id,
    'serie', v_serie,
    'numero', v_numero,
    'items_count', v_items_count
  );
END;
$function$;

-- ── 2. Un comprobante vigente por pedido, también para la base ─────────────
-- Lo de arriba lo controla la función; esto lo garantiza aunque alguien
-- inserte por otro camino. Anulado el anterior, se puede emitir otro.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_comprobante_vigente_por_pedido
  ON comprobantes (pedido_id)
  WHERE pedido_id IS NOT NULL
    AND estado <> 'anulado'
    AND tipo IN ('factura', 'boleta', 'nota_pedido_interna');

-- ── 3. Lo declarado no se toca ─────────────────────────────────────────────
--
-- Las funciones de editar, anular y corregir fecha ya se niegan con un
-- comprobante enviado. Pero el facturador también puede escribir directo en
-- las tablas, y entre que la pantalla carga y guarda el envío de la mañana
-- puede haberlo declarado. Esto lo frena en la base, venga de donde venga.
--
-- Protege también mientras se está enviando (sunat_estado = 'enviando', menos
-- de diez minutos): si se edita en ese instante, SUNAT recibiría una versión
-- y el ERP guardaría otra. Pasados diez minutos se da por trabado y se libera.
CREATE OR REPLACE FUNCTION public.comprobante_bloqueado_por_sunat(c comprobantes)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  -- COALESCE: un comprobante recién emitido tiene todo esto en NULL, y en
  -- SQL "NULL AND algo" no es falso sino NULL.
  SELECT COALESCE(c.enviado_sunat AND c.sunat_modo = 'produccion', false)
      OR COALESCE(c.sunat_estado = 'enviando' AND c.sunat_enviado_at > NOW() - INTERVAL '10 minutes', false)
$function$;

CREATE OR REPLACE FUNCTION public.proteger_comprobante_declarado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF comprobante_bloqueado_por_sunat(OLD) THEN
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

DROP TRIGGER IF EXISTS trg_proteger_comprobante_declarado ON comprobantes;
CREATE TRIGGER trg_proteger_comprobante_declarado
  BEFORE UPDATE OR DELETE ON comprobantes
  FOR EACH ROW EXECUTE FUNCTION proteger_comprobante_declarado();

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
    RAISE EXCEPTION 'El comprobante %-% ya fue declarado a SUNAT (o se está enviando): sus productos no se pueden modificar.',
      v_comp.serie, v_comp.numero;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.comprobante_id IS DISTINCT FROM OLD.comprobante_id THEN
    SELECT * INTO v_comp FROM comprobantes WHERE id = NEW.comprobante_id;
    IF FOUND AND comprobante_bloqueado_por_sunat(v_comp) THEN
      RAISE EXCEPTION 'El comprobante %-% ya fue declarado a SUNAT: no se le pueden agregar productos.',
        v_comp.serie, v_comp.numero;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_proteger_items_comprobante_declarado ON comprobantes_items;
CREATE TRIGGER trg_proteger_items_comprobante_declarado
  BEFORE INSERT OR UPDATE OR DELETE ON comprobantes_items
  FOR EACH ROW EXECUTE FUNCTION proteger_items_comprobante_declarado();

-- ── 4. Un solo proceso envía cada comprobante ──────────────────────────────
--
-- Pueden coincidir el envío de la mañana, el de respaldo y alguien apretando
-- "Declarar". Quien llama acá primero se queda con el comprobante; los demás
-- reciben falso y lo saltan. Si un envío quedó trabado más de diez minutos,
-- se libera.
CREATE OR REPLACE FUNCTION public.reservar_envio_sunat(p_comprobante_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  UPDATE comprobantes
     SET sunat_estado = 'enviando', sunat_enviado_at = NOW()
   WHERE id = p_comprobante_id
     AND NOT COALESCE(enviado_sunat AND sunat_modo = 'produccion', false)
     AND NOT COALESCE(sunat_estado = 'enviando' AND sunat_enviado_at > NOW() - INTERVAL '10 minutes', false)
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$function$;

-- Solo el servidor (service role) reserva envíos.
REVOKE ALL ON FUNCTION public.reservar_envio_sunat(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Los días de espera, a la vista en la configuración ──────────────────
INSERT INTO configuracion (clave, valor, descripcion)
VALUES ('sunat_dias_espera', '2',
  'Días después de la emisión en que el envío automático declara a SUNAT (0 a 2). '
  || 'Es el margen para editar o anular desde el sistema. El plazo de SUNAT es de 3 días: '
  || 'el tercero queda de reserva para reintentar.')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
