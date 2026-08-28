-- ═══════════════════════════════════════════════════════════════════════════
-- 103 · Una sola serie activa por tipo de comprobante
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `siguiente_correlativo` elige la serie activa "más recientemente
-- actualizada". Con una sola serie activa por tipo eso es determinista y no
-- hay nada que discutir. Con dos, la numeración salta de una a otra según cuál
-- se tocó último, y nadie se entera hasta que SUNAT rechaza por correlativo
-- fuera de secuencia.
--
-- Se comprobó activando B001 junto a B002 en una transacción revertida: las
-- seis boletas siguientes salieron B001-00000374 en adelante, abandonando la
-- serie B002 que venía en curso.
--
-- El índice lo vuelve imposible. Para pasar de una serie a otra —cuando se
-- agota una, o al empezar un año— hay que desactivar la anterior primero, que
-- es exactamente el orden correcto.
-- ═══════════════════════════════════════════════════════════════════════════

-- Si hubiera más de una activa, dejar viva solo la de correlativo más alto:
-- es la que está en uso.
UPDATE series_correlativos s
   SET activo = FALSE
 WHERE activo
   AND EXISTS (
     SELECT 1 FROM series_correlativos o
      WHERE o.tipo_comprobante = s.tipo_comprobante
        AND o.activo
        AND (o.correlativo_actual, o.id) > (s.correlativo_actual, s.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS series_correlativos_una_activa_por_tipo
  ON series_correlativos (tipo_comprobante)
  WHERE activo;

COMMENT ON INDEX series_correlativos_una_activa_por_tipo IS
  'Solo una serie activa por tipo de comprobante: con dos, siguiente_correlativo alterna entre ellas y rompe la secuencia.';
