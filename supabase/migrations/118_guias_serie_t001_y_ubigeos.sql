-- Las guías de remisión, listas para declararse a SUNAT.
--
-- Daniel, 01/10: el fiscalizador del control móvil no encontró las guías en
-- SUNAT. No estaban: la guía electrónica quedó construida pero apagada, y las
-- guías se seguían imprimiendo sin declararse. Además salían con serie P002.
--
-- La migración 114 corrigió la serie a T001 en el valor por omisión y en
-- `siguiente_numero_guia`, pero `emitir_guia_desde_comprobante` la tenía
-- escrita a mano ('P002', desde la migración 093) y siguió emitiendo P002.
-- SUNAT exige que la serie de la guía electrónica de remitente empiece con T.
--
-- También faltaban los ubigeos de partida y llegada, que SUNAT exige en los
-- dos extremos del traslado: se toman de la configuración y del cliente.

BEGIN;

-- ── 1. Las guías P002 que nunca se declararon pasan a T001, mismo número ──
-- P002-1 queda como T001-1: la correspondencia con el papel es directa.
UPDATE guias_remision g
   SET serie = 'T001'
 WHERE g.serie = 'P002'
   AND COALESCE(g.enviado_sunat, FALSE) = FALSE
   AND NOT EXISTS (SELECT 1 FROM guias_remision o WHERE o.serie = 'T001' AND o.numero = g.numero);

-- Ubigeos que faltan en las guías sin declarar.
UPDATE guias_remision g
   SET ubigeo_partida = COALESCE(NULLIF(trim(g.ubigeo_partida), ''),
         (SELECT NULLIF(trim(valor), '') FROM configuracion WHERE clave = 'gre_ubigeo_partida'))
 WHERE COALESCE(g.enviado_sunat, FALSE) = FALSE;

UPDATE guias_remision g
   SET ubigeo_llegada = cl.ubigeo
  FROM clientes cl
 WHERE cl.id = g.cliente_id
   AND COALESCE(g.enviado_sunat, FALSE) = FALSE
   AND COALESCE(NULLIF(trim(g.ubigeo_llegada), ''), '') = ''
   AND cl.ubigeo ~ '^\d{6}$';

-- ── 2. La función que emite la guía: serie T001 y ubigeos ─────────────────
CREATE OR REPLACE FUNCTION public.emitir_guia_desde_comprobante(
  p_comprobante_id uuid, p_fecha_inicio_traslado date, p_motivo_traslado text DEFAULT 'venta'::text,
  p_punto_partida text DEFAULT NULL::text, p_punto_llegada text DEFAULT NULL::text,
  p_peso_bruto numeric DEFAULT 0, p_vehiculo_placa text DEFAULT NULL::text,
  p_conductor_nombre text DEFAULT NULL::text, p_conductor_doc text DEFAULT NULL::text,
  p_conductor_licencia text DEFAULT NULL::text, p_modalidad text DEFAULT 'privado'::text,
  p_transportista_razon_social text DEFAULT NULL::text, p_transportista_ruc text DEFAULT NULL::text,
  p_motivo_descripcion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_comp RECORD;
  v_guia_id UUID;
  v_numero INT;
  v_punto_partida TEXT;
  v_punto_llegada TEXT;
  v_ubigeo_partida TEXT;
  v_ubigeo_llegada TEXT;
  -- La serie de la guía electrónica de remitente: SUNAT exige que empiece con T.
  c_serie CONSTANT TEXT := 'T001';
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT id, full_name, role::text INTO v_profile FROM profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.role NOT IN ('administrador', 'gerente', 'facturador') THEN
    RAISE EXCEPTION 'No tienes permiso para emitir guías de remisión';
  END IF;

  IF p_vehiculo_placa IS NULL OR LENGTH(TRIM(p_vehiculo_placa)) = 0 THEN
    RAISE EXCEPTION 'Debes ingresar la placa del vehículo';
  END IF;
  IF p_conductor_nombre IS NULL OR LENGTH(TRIM(p_conductor_nombre)) = 0 THEN
    RAISE EXCEPTION 'Debes ingresar el nombre del conductor';
  END IF;
  IF p_conductor_doc IS NULL OR LENGTH(TRIM(p_conductor_doc)) = 0 THEN
    RAISE EXCEPTION 'Debes ingresar el documento del conductor';
  END IF;

  SELECT c.*, cl.razon_social AS cli_razon, cl.direccion AS cli_direccion, cl.ubigeo AS cli_ubigeo
    INTO v_comp
  FROM comprobantes c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  WHERE c.id = p_comprobante_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprobante % no existe', p_comprobante_id; END IF;
  IF v_comp.estado = 'anulado' THEN
    RAISE EXCEPTION 'No se puede emitir guía de un comprobante anulado';
  END IF;

  v_punto_partida := COALESCE(NULLIF(TRIM(p_punto_partida), ''),
    'CALLE EMILIO FORERO 553-A PARA GRANDE TACNA FUNDO PARA GRANDE PARCELA 31 SUB.LT.1 TACNA - TACNA - TACNA');
  v_punto_llegada := COALESCE(NULLIF(TRIM(p_punto_llegada), ''), v_comp.cli_direccion, 'TACNA');
  SELECT NULLIF(TRIM(valor), '') INTO v_ubigeo_partida FROM configuracion WHERE clave = 'gre_ubigeo_partida';
  v_ubigeo_llegada := CASE WHEN v_comp.cli_ubigeo ~ '^\d{6}$' THEN v_comp.cli_ubigeo END;

  v_numero := siguiente_numero_guia(c_serie);

  INSERT INTO guias_remision (
    serie, numero, comprobante_id, cliente_id,
    cliente_externo_nombre, cliente_externo_doc,
    fecha_emision, fecha_inicio_traslado,
    motivo_traslado, motivo_descripcion,
    punto_partida, punto_llegada, ubigeo_partida, ubigeo_llegada,
    peso_bruto_total, unidad_peso,
    modalidad_traslado,
    transportista_razon_social, transportista_ruc,
    vehiculo_placa,
    conductor_nombre, conductor_doc, conductor_licencia,
    emisor_id
  ) VALUES (
    c_serie, v_numero, p_comprobante_id, v_comp.cliente_id,
    v_comp.cliente_externo_nombre, v_comp.cliente_externo_doc,
    NOW(), p_fecha_inicio_traslado,
    p_motivo_traslado::motivo_traslado_guia,
    p_motivo_descripcion,
    v_punto_partida, v_punto_llegada, v_ubigeo_partida, v_ubigeo_llegada,
    COALESCE(p_peso_bruto, 0), 'KGM',
    p_modalidad::modalidad_traslado_guia,
    p_transportista_razon_social, p_transportista_ruc,
    TRIM(p_vehiculo_placa),
    TRIM(p_conductor_nombre), TRIM(p_conductor_doc), TRIM(p_conductor_licencia),
    v_user_id
  )
  RETURNING id INTO v_guia_id;

  INSERT INTO guias_remision_items (
    guia_id, producto_id, codigo, descripcion,
    unidad_medida, cantidad, orden
  )
  SELECT
    v_guia_id,
    ci.producto_id,
    COALESCE(p.codigo, ''),
    COALESCE(TRIM(p.descripcion), p.nombre, ci.descripcion, '—'),
    'NIU',
    ci.cantidad,
    ROW_NUMBER() OVER (ORDER BY ci.id)
  FROM comprobantes_items ci
  LEFT JOIN productos p ON p.id = ci.producto_id
  WHERE ci.comprobante_id = p_comprobante_id;

  RETURN jsonb_build_object(
    'id', v_guia_id,
    'serie', c_serie,
    'numero', v_numero,
    'numero_completo', c_serie || '-' || LPAD(v_numero::text, 8, '0')
  );
END;
$function$;

-- ── 3. Una guía no puede repetir número en su serie ────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guia_serie_numero ON guias_remision (serie, numero);

COMMIT;
