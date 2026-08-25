-- ============================================================================
-- Qué ticketera está usando cada computadora
-- ============================================================================
--
-- La columna `impresora` sirve para forzar una desde el ERP, pero el agente
-- nunca informaba cuál está usando en realidad. Cuando la computadora de
-- facturación no encontró la suya —una TEK, que la deteccion no reconocia—,
-- desde el ERP no habia forma de verlo: la lista mostraba el punto verde de
-- "conectada" igual que las demas.
--
-- Ahora el agente informa en cada consulta la impresora por la que va a
-- imprimir, o nada si no encontro ninguna. Se guarda aparte de `impresora`
-- para no pisar la eleccion manual.
-- ============================================================================

ALTER TABLE equipos_impresion
  ADD COLUMN IF NOT EXISTS impresora_detectada TEXT;

COMMENT ON COLUMN equipos_impresion.impresora_detectada IS
  'La ticketera por la que el agente esta imprimiendo, informada por el propio agente. Vacia significa que no encontro ninguna: esa computadora esta conectada pero no puede imprimir.';
