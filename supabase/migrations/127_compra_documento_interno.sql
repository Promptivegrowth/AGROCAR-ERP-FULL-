-- Compras con documento interno: ingresar mercadería que no viene con factura.
--
-- Daniel, 05/10/2026: "implementar en compras documento interno para ingresar
-- productos que no cuentan con factura". Hasta acá una compra exigía el número
-- de factura del proveedor, y todas se trataban como factura con IGV.
--
-- Un documento interno:
--   * se numera solo: DI-000001, DI-000002… (no hay comprobante del que copiar
--     el número);
--   * no lleva IGV: sin comprobante no hay crédito fiscal que recuperar, así
--     que el costo de la mercadería es lo que se pagó, entero;
--   * NO va al Registro de Compras del SIRE (que se presenta a SUNAT y antes
--     informaba todo como factura, tipo 01) ni suma como "compra acreditada con
--     comprobante" (base del tope de gastos sin comprobante, migración 063);
--   * en el asiento contable queda glosado como "COMPRA SIN COMPROBANTE".
-- Todo lo demás es igual a una compra: se valida la recepción, se aplica al
-- almacén (stock, lotes, costo promedio) y se puede revertir.
--
-- Si quien vende es una persona sin RUC que vende productos primarios, el
-- documento legal es la liquidación de compra electrónica (la emite el
-- comprador ante SUNAT). Eso lo decide el contador; esto es control interno de
-- almacén y costos.

BEGIN;

ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS documento_interno BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.compras.documento_interno IS
  'Compra sin comprobante del proveedor: numerada DI-000001, sin IGV, fuera del Registro de Compras (SIRE).';

CREATE SEQUENCE IF NOT EXISTS public.compras_documento_interno_seq START 1;

CREATE OR REPLACE FUNCTION public.compras_documento_interno()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.documento_interno THEN
    IF COALESCE(TRIM(NEW.numero_factura_proveedor), '') = ''
       OR (TG_OP = 'UPDATE' AND NOT COALESCE(OLD.documento_interno, FALSE)) THEN
      NEW.numero_factura_proveedor := 'DI-' || LPAD(nextval('public.compras_documento_interno_seq')::text, 6, '0');
    END IF;
    -- Sin comprobante no hay IGV: el costo es el total pagado.
    NEW.incluir_igv := FALSE;
    NEW.igv := 0;
    NEW.subtotal := NEW.total;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_compras_documento_interno ON public.compras;
CREATE TRIGGER trg_compras_documento_interno
  BEFORE INSERT OR UPDATE ON public.compras
  FOR EACH ROW EXECUTE FUNCTION public.compras_documento_interno();

-- Proveedor genérico para lo que se compra a alguien sin RUC.
INSERT INTO public.proveedores (razon_social, ruc, pais, activo)
SELECT 'VARIOS - SIN COMPROBANTE', NULL, 'PE', TRUE
 WHERE NOT EXISTS (SELECT 1 FROM public.proveedores WHERE razon_social = 'VARIOS - SIN COMPROBANTE');

-- El Registro de Compras de SUNAT: solo lo que tiene comprobante.
CREATE OR REPLACE FUNCTION public.sire_registro_compras(p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  filas AS (
    SELECT
      co.fecha,
      '01' AS tipo_cpe,  -- factura (las compras registradas son con factura)
      -- Parse serie-numero del campo libre numero_factura_proveedor "F001-00012345"
      COALESCE(NULLIF(SPLIT_PART(co.numero_factura_proveedor, '-', 1), ''), '-') AS serie,
      COALESCE(NULLIF(SPLIT_PART(co.numero_factura_proveedor, '-', 2), ''), co.numero_factura_proveedor, '-') AS numero,
      '6' AS tipo_doc_proveedor,
      COALESCE(pr.ruc, '-') AS ruc_proveedor,
      COALESCE(pr.razon_social, 'SIN PROVEEDOR') AS razon_social,
      co.subtotal AS base_imponible,
      co.igv,
      co.total,
      co.estado::text AS estado,
      co.id
    FROM compras co
    LEFT JOIN proveedores pr ON pr.id = co.proveedor_id
    CROSS JOIN rango r
    WHERE co.fecha BETWEEN r.desde AND r.hasta
      -- Un documento interno no es comprobante: no se informa a SUNAT.
      AND NOT co.documento_interno
    ORDER BY co.fecha, co.numero_factura_proveedor
  )
  SELECT jsonb_build_object(
    'periodo', LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0'),
    'filas', COALESCE(jsonb_agg(row_to_json(filas)), '[]'::jsonb),
    'total_base', COALESCE((SELECT SUM(base_imponible) FROM filas WHERE estado <> 'anulada'), 0),
    'total_igv', COALESCE((SELECT SUM(igv) FROM filas WHERE estado <> 'anulada'), 0),
    'total_total', COALESCE((SELECT SUM(total) FROM filas WHERE estado <> 'anulada'), 0),
    'cantidad', (SELECT COUNT(*) FROM filas)
  ) FROM filas;
$function$;

-- Compras acreditadas con comprobante (base del 6% de la migración 063).
CREATE OR REPLACE VIEW public.v_compras_acreditadas_anio AS
SELECT
  EXTRACT(YEAR FROM fecha)::int AS anio,
  COALESCE(SUM(subtotal), 0) AS total_compras
FROM compras
WHERE estado <> 'anulada' AND NOT documento_interno
GROUP BY EXTRACT(YEAR FROM fecha);

-- Asiento de compra: igual, con la glosa que dice que no hubo comprobante.
CREATE OR REPLACE FUNCTION public.generar_asiento_compra(p_compra_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_compra RECORD;
  v_existente UUID;
  v_asiento_id UUID;
  v_numero TEXT;
  v_user_id UUID := auth.uid();
  v_cta_compras UUID; v_cta_igv_cf UUID; v_cta_cxp UUID;
  v_cc_alm UUID;
  v_glosa TEXT;
BEGIN
  SELECT id INTO v_existente FROM asientos_contables
    WHERE referencia_tabla = 'compras' AND referencia_id = p_compra_id
      AND estado <> 'anulado';
  IF v_existente IS NOT NULL THEN RETURN v_existente; END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra % no existe', p_compra_id; END IF;
  IF v_compra.estado = 'anulada' THEN
    RAISE EXCEPTION 'No se genera asiento para compras anuladas';
  END IF;

  v_cta_compras := _cuenta_id_por_codigo('6011');
  v_cta_igv_cf := _cuenta_id_por_codigo('40112');
  v_cta_cxp := _cuenta_id_por_codigo('4212');
  v_cc_alm := _cc_id_por_codigo('ALM');

  v_numero := siguiente_numero_asiento();
  v_glosa := CASE WHEN v_compra.documento_interno
    THEN 'COMPRA SIN COMPROBANTE ' || COALESCE(v_compra.numero_factura_proveedor, 'sin ref')
    ELSE 'COMPRA ' || COALESCE(v_compra.numero_factura_proveedor, 'sin ref') END;

  INSERT INTO asientos_contables (
    numero, fecha, glosa, origen, estado,
    referencia_tabla, referencia_id, creado_por,
    tipo_operacion_sunat
  ) VALUES (
    v_numero, v_compra.fecha, v_glosa, 'compra', 'borrador',
    'compras', p_compra_id, v_user_id, '01'
  )
  RETURNING id INTO v_asiento_id;

  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id) VALUES
    (v_asiento_id, v_cta_compras, v_compra.subtotal, 0, 1, v_cc_alm);
  IF v_compra.igv > 0 AND v_cta_igv_cf IS NOT NULL THEN
    INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, centro_costo_id)
    VALUES (v_asiento_id, v_cta_igv_cf, v_compra.igv, 0, 2, v_cc_alm);
  END IF;
  INSERT INTO asientos_partidas (asiento_id, cuenta_id, debe, haber, orden, proveedor_id, centro_costo_id)
  VALUES (v_asiento_id, v_cta_cxp, 0, v_compra.total, 3, v_compra.proveedor_id, v_cc_alm);

  RETURN v_asiento_id;
END;
$function$;

COMMIT;
