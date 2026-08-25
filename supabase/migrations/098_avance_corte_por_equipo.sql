-- ============================================================================
-- Cuánto adelanta el papel cada ticketera antes de cortar
-- ============================================================================
--
-- La cuchilla está unos milímetros por encima del cabezal, así que el ticket
-- adelanta papel antes de cortar para que el corte no caiga sobre el texto.
-- Esa distancia depende del modelo: con 15 mm la ticketera de la oficina corta
-- justo, y la de Daniel se come la última línea del comprobante.
--
-- Se guarda por computadora en vez de subir el número para todas: poner 20 mm
-- en todas resolvería el caso de Daniel y regalaría medio centímetro de papel
-- en cada ticket de las demás, que es justo lo que se venía corrigiendo.
-- ============================================================================

ALTER TABLE equipos_impresion
  ADD COLUMN IF NOT EXISTS avance_corte_mm NUMERIC(4,1) NOT NULL DEFAULT 15;

COMMENT ON COLUMN equipos_impresion.avance_corte_mm IS
  'Milímetros de papel que se adelantan antes de cortar. Depende de cuán lejos esté la cuchilla del cabezal en ese modelo de ticketera. Si el corte se come la última línea, hay que subirlo; si sobra papel en blanco al final, bajarlo.';

-- Entre 5 y 40 mm: por debajo la cuchilla corta contenido en cualquier modelo,
-- y por encima se estaría desperdiciando papel a propósito.
ALTER TABLE equipos_impresion
  ADD CONSTRAINT equipos_impresion_avance_corte_razonable
  CHECK (avance_corte_mm >= 5 AND avance_corte_mm <= 40);
