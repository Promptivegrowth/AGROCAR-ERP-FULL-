-- ============================================================================
-- Código SUNAT de las unidades de medida (Catálogo 03)
-- ============================================================================
--
-- Cada ítem de una factura o boleta electrónica tiene que declarar su unidad
-- según el Catálogo N.° 03 del Anexo N.° 8 de SUNAT. Un código que no exista
-- en ese catálogo hace que SUNAT rechace el comprobante, así que sin esto el
-- sistema no puede emitir aunque tenga el certificado digital.
--
-- Las tres unidades de AGROCAR:
--
--   Unidades (Und)  -> NIU
--   Kilogramos (Kg) -> KGM
--   Moldes (Mld)    -> NIU
--
-- "Molde" no existe en el catálogo. Se consultó a Daniel y su respuesta fue
-- manejarlos como unidades de bienes, o sea NIU: son cinco productos
-- —jamonadas y mortadelas de 2 y 3 kg— que se venden por pieza entera y no
-- fraccionados, así que cada molde es una unidad. La alternativa era ZZ
-- ("unidad acordada entre las partes"), que es correcta pero le dice menos a
-- quien recibe el comprobante.
--
-- El código de producto SUNAT (Catálogo 25, el UNSPSC) no se agrega: no es
-- requisito en facturas ni boletas —solo en liquidaciones de compra, que
-- AGROCAR no emite— y mandarlo mal hace que rechacen el comprobante, mientras
-- que no mandarlo no tiene consecuencia.
-- ============================================================================

ALTER TABLE unidades_medida
  ADD COLUMN IF NOT EXISTS codigo_sunat TEXT;

COMMENT ON COLUMN unidades_medida.codigo_sunat IS
  'Código de la unidad según el Catálogo N.° 03 del Anexo N.° 8 de SUNAT. Obligatorio en el XML de cada ítem: un código que no exista en el catálogo hace que se rechace el comprobante.';

UPDATE unidades_medida SET codigo_sunat = 'NIU' WHERE simbolo ILIKE 'und%' AND codigo_sunat IS NULL;
UPDATE unidades_medida SET codigo_sunat = 'KGM' WHERE simbolo ILIKE 'kg%'  AND codigo_sunat IS NULL;
UPDATE unidades_medida SET codigo_sunat = 'NIU' WHERE simbolo ILIKE 'mld%' AND codigo_sunat IS NULL;

/*
 * Que no se pueda quedar sin código sin que nadie se entere.
 *
 * Si mañana alguien agrega una unidad nueva —cajas, litros— y no le pone el
 * código, los comprobantes de esos productos van a ser rechazados por SUNAT
 * recién al emitirlos. Mejor que falle al crear la unidad, que es cuando hay
 * alguien mirando y sabe qué eligió.
 */
ALTER TABLE unidades_medida
  ADD CONSTRAINT unidades_medida_codigo_sunat_requerido
  CHECK (activo IS NOT TRUE OR codigo_sunat IS NOT NULL) NOT VALID;

ALTER TABLE unidades_medida VALIDATE CONSTRAINT unidades_medida_codigo_sunat_requerido;
