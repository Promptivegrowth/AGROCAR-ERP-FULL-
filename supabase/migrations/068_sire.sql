-- ─────────────────────────────────────────────────────────────────────────────
-- 068: SIRE — Registro de Ventas (RVIE 14.x) + Registro de Compras (RCE 8.x)
--
-- Requerimiento Vaneza (R1):
-- "estamos obligados a presentar sire, tanto para ventas como compras...
--  sacar los archivos de sunat y hacer un match, a ver si todo está y cuál
--  no está. Eso nos va a ayudar un montón para hacerlo mucho más automático
--  y no estar con la antigua de revisar uno por uno"
--
-- Diseño:
-- - RPC sire_registro_ventas(anio, mes): filas con estructura RVIE
-- - RPC sire_registro_compras(anio, mes): filas con estructura RCE
-- - Tabla sire_matches: historial de conciliaciones con SUNAT
-- - El TXT se genera en el frontend; el match se hace subiendo el archivo
--   descargado del portal SIRE
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Registro de Ventas e Ingresos (RVIE)
-- Tipos SUNAT: 01=Factura, 03=Boleta, 07=Nota de crédito
-- Tipo doc identidad: 6=RUC, 1=DNI, 0=Sin documento
CREATE OR REPLACE FUNCTION sire_registro_ventas(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date AS hasta
  ),
  filas AS (
    SELECT
      c.fecha_emision,
      CASE c.tipo::text
        WHEN 'factura' THEN '01'
        WHEN 'boleta' THEN '03'
        WHEN 'nota_credito' THEN '07'
        ELSE '00'
      END AS tipo_cpe,
      c.serie,
      LPAD(c.numero::text, 8, '0') AS numero,
      CASE
        WHEN cl.ruc IS NOT NULL THEN '6'
        WHEN cl.dni IS NOT NULL THEN '1'
        WHEN c.cliente_externo_doc IS NOT NULL AND LENGTH(c.cliente_externo_doc) = 11 THEN '6'
        WHEN c.cliente_externo_doc IS NOT NULL AND LENGTH(c.cliente_externo_doc) = 8 THEN '1'
        ELSE '0'
      END AS tipo_doc_cliente,
      COALESCE(cl.ruc, cl.dni, c.cliente_externo_doc, '-') AS num_doc_cliente,
      COALESCE(cl.razon_social, c.cliente_externo_nombre, 'CLIENTES VARIOS') AS razon_social,
      -- NC va con signo negativo en el registro
      CASE WHEN c.tipo::text = 'nota_credito' THEN -c.subtotal ELSE c.subtotal END AS base_imponible,
      CASE WHEN c.tipo::text = 'nota_credito' THEN -c.igv ELSE c.igv END AS igv,
      CASE WHEN c.tipo::text = 'nota_credito' THEN -c.total ELSE c.total END AS total,
      c.estado::text AS estado,
      -- Referencia del comprobante original si es NC
      ref.serie AS ref_serie,
      CASE WHEN ref.numero IS NOT NULL THEN LPAD(ref.numero::text, 8, '0') END AS ref_numero,
      c.id
    FROM comprobantes c
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN comprobantes ref ON ref.id = c.referencia_comprobante_id
    CROSS JOIN rango r
    WHERE c.fecha_emision BETWEEN r.desde AND r.hasta
      AND c.tipo::text IN ('factura', 'boleta', 'nota_credito')
    ORDER BY c.fecha_emision, c.serie, c.numero
  )
  SELECT jsonb_build_object(
    'periodo', LPAD(p_anio::text, 4, '0') || LPAD(p_mes::text, 2, '0'),
    'filas', COALESCE(jsonb_agg(row_to_json(filas)), '[]'::jsonb),
    'total_base', COALESCE((SELECT SUM(base_imponible) FROM filas WHERE estado <> 'anulado'), 0),
    'total_igv', COALESCE((SELECT SUM(igv) FROM filas WHERE estado <> 'anulado'), 0),
    'total_total', COALESCE((SELECT SUM(total) FROM filas WHERE estado <> 'anulado'), 0),
    'cantidad', (SELECT COUNT(*) FROM filas),
    'anulados', (SELECT COUNT(*) FROM filas WHERE estado = 'anulado')
  ) FROM filas;
$$;

GRANT EXECUTE ON FUNCTION sire_registro_ventas TO authenticated;

-- ── 2. Registro de Compras (RCE)
CREATE OR REPLACE FUNCTION sire_registro_compras(p_anio INT, p_mes INT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION sire_registro_compras TO authenticated;

-- ── 3. Historial de matches SIRE
CREATE TABLE IF NOT EXISTS sire_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('ventas', 'compras')),
  anio INT NOT NULL,
  mes INT NOT NULL,
  fecha_match TIMESTAMPTZ DEFAULT NOW(),
  realizado_por UUID REFERENCES profiles(id),
  total_sistema INT NOT NULL DEFAULT 0,       -- comprobantes en el sistema
  total_sunat INT NOT NULL DEFAULT 0,         -- líneas en el archivo SUNAT
  coincidencias INT NOT NULL DEFAULT 0,       -- en ambos
  solo_sistema INT NOT NULL DEFAULT 0,        -- en sistema pero no en SUNAT
  solo_sunat INT NOT NULL DEFAULT 0,          -- en SUNAT pero no en sistema
  detalle JSONB,                              -- las diferencias exactas
  notas TEXT
);

ALTER TABLE sire_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY sire_read ON sire_matches FOR SELECT USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
CREATE POLICY sire_write ON sire_matches FOR ALL USING (
  has_role(VARIADIC ARRAY['administrador', 'gerente', 'contador'])
);
