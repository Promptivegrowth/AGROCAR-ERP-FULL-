-- ============================================================================
-- Las impresoras que ve cada computadora
-- ============================================================================
--
-- El agente elige la ticketera adivinando por el nombre. Cuando una
-- computadora tiene mas de una entrada parecida —la real y alguna que quedo
-- de una instalacion anterior— puede elegir la equivocada: Windows acepta el
-- trabajo, el agente lo da por impreso y no sale ningun papel.
--
-- Para poder resolverlo sin ir hasta la computadora, el agente informa la
-- lista completa de impresoras que tiene instaladas. Desde el ERP se elige
-- cual usar y esa eleccion viaja de vuelta en `impresora`, que el agente ya
-- respeta por encima de lo que adivine.
-- ============================================================================

ALTER TABLE equipos_impresion
  ADD COLUMN IF NOT EXISTS impresoras_disponibles TEXT;

COMMENT ON COLUMN equipos_impresion.impresoras_disponibles IS
  'Las impresoras instaladas en esa computadora, separadas por |, informadas por el agente. Sirven para elegir a distancia cual usar cuando la deteccion automatica falla.';
