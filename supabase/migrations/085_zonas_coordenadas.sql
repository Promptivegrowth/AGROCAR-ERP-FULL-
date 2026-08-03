-- ─────────────────────────────────────────────────────────────────────────────
-- 085: Coordenadas de las zonas para el dashboard de análisis zonificado
--
-- De 49 zonas activas solo 12 tenían centro cargado, así que el mapa saldría
-- casi vacío. Se completa el resto ubicando cada zona en el CENTRO DE SU
-- DISTRITO (el campo `distrito` ya está lleno en las 49), con una separación
-- en espiral para que no se apilen unas sobre otras.
--
-- Estas ubicaciones son APROXIMADAS y quedan marcadas como tales: en el mapa
-- se dibujan con borde punteado y en Maestros → Zonas aparecen en la lista de
-- "zonas por afinar". Cuando alguien ajusta el punto a mano, la marca se
-- limpia sola.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE zonas ADD COLUMN IF NOT EXISTS centro_aproximado BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN zonas.centro_aproximado IS
  'TRUE = el centro se estimó por distrito, nadie lo ubicó a mano todavía.';

-- Centros reales de los distritos donde AGROCAR tiene zonas
WITH centros(distrito, lat, lng) AS (
  VALUES
    ('Tacna',                                 -18.01460, -70.25360),
    ('Coronel Gregorio Albarracín Lanchipa',  -18.05330, -70.24970),
    ('Alto de la Alianza',                    -17.99030, -70.24720),
    ('Ciudad Nueva',                          -17.98190, -70.24080),
    ('Pocollay',                              -17.99750, -70.21810),
    ('Calana',                                -17.92640, -70.18610),
    ('Sama',                                  -17.85060, -70.52280),
    ('Ilo',                                   -17.63940, -71.33750),
    ('Moquegua',                              -17.19390, -70.93500),
    ('Arequipa',                              -16.40900, -71.53750),
    ('San Juan de Lurigancho',                -11.97560, -76.99770)
),
-- Numerar las zonas sin centro dentro de cada distrito
pendientes AS (
  SELECT
    z.id,
    z.distrito,
    ROW_NUMBER() OVER (PARTITION BY z.distrito ORDER BY z.nombre) AS n
  FROM zonas z
  WHERE z.activo AND z.centro_lat IS NULL
),
-- Espiral de Fermat con el ángulo áureo: reparte los puntos de forma pareja
-- alrededor del centro del distrito sin que se superpongan.
ubicadas AS (
  SELECT
    p.id,
    c.lat + (0.0045 * SQRT(p.n) * COS(p.n * 2.39996)) AS lat,
    c.lng + (0.0045 * SQRT(p.n) * SIN(p.n * 2.39996)) AS lng
  FROM pendientes p
  JOIN centros c ON c.distrito = p.distrito
)
UPDATE zonas z
SET centro_lat = ROUND(u.lat::numeric, 6),
    centro_lng = ROUND(u.lng::numeric, 6),
    radio_km = COALESCE(z.radio_km, 1.5),
    centro_aproximado = TRUE
FROM ubicadas u
WHERE z.id = u.id;

-- Las zonas que ya tenían punto se consideran verificadas
UPDATE zonas SET centro_aproximado = FALSE
WHERE centro_lat IS NOT NULL AND centro_aproximado IS NOT TRUE;
