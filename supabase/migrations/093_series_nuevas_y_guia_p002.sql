-- ─────────────────────────────────────────────────────────────────────────────
-- 093: series nuevas para el arranque en producción
--
-- Daniel pidió dejar el sistema en cero movimientos y reiniciar la numeración:
-- facturas en F002, boletas en B002, guías de remisión en P002 y el documento
-- interno de vuelta a 0.
--
-- Las series F002, B002 y T002 ya existían creadas e inactivas desde julio; acá
-- se activan las dos primeras y se retiran F001 y B001, que quedan con su
-- histórico cerrado. El documento interno sigue en T001 —Daniel no pidió
-- cambiarle la serie, solo el correlativo— y vuelve a 0.
--
-- Las guías de remisión no viven en series_correlativos: se numeran solas
-- tomando el máximo de la tabla, y la serie estaba escrita a mano como 'T001'
-- dentro de emitir_guia_desde_comprobante. Pasa a P002.
--
-- IMPORTANTE: las series viejas no se borran. Quedan inactivas para que, si
-- alguna vez hay que consultar o reimprimir un comprobante histórico, el
-- sistema siga sabiendo de dónde salió su numeración.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Facturas: F001 se retira, F002 arranca en 0
UPDATE series_correlativos SET activo = FALSE, updated_at = NOW()
WHERE tipo_comprobante = 'factura' AND serie = 'F001';

UPDATE series_correlativos SET activo = TRUE, correlativo_actual = 0, updated_at = NOW()
WHERE tipo_comprobante = 'factura' AND serie = 'F002';

-- ── 2. Boletas: B001 se retira, B002 arranca en 0
UPDATE series_correlativos SET activo = FALSE, updated_at = NOW()
WHERE tipo_comprobante = 'boleta' AND serie = 'B001';

UPDATE series_correlativos SET activo = TRUE, correlativo_actual = 0, updated_at = NOW()
WHERE tipo_comprobante = 'boleta' AND serie = 'B002';

-- ── 3. Documento interno: misma serie T001, correlativo de vuelta a 0
UPDATE series_correlativos SET activo = TRUE, correlativo_actual = 0, updated_at = NOW()
WHERE tipo_comprobante = 'nota_pedido_interna' AND serie = 'T001';

UPDATE series_correlativos SET activo = FALSE, updated_at = NOW()
WHERE tipo_comprobante = 'nota_pedido_interna' AND serie = 'T002';

-- ── 4. Notas de crédito: FC01 sigue siendo la activa, en 0
UPDATE series_correlativos SET correlativo_actual = 0, updated_at = NOW()
WHERE tipo_comprobante = 'nota_credito';

-- ── 5. Guías de remisión en P002
CREATE OR REPLACE FUNCTION siguiente_numero_guia(p_serie TEXT DEFAULT 'P002')
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('guia_' || p_serie));
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_max
    FROM guias_remision WHERE serie = p_serie;
  RETURN v_max;
END;
$$;

GRANT EXECUTE ON FUNCTION siguiente_numero_guia TO authenticated;

-- La serie estaba escrita a mano dentro del cuerpo de la RPC que emite la guía
DO $emisor$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'emitir_guia_desde_comprobante';

  IF v_src IS NULL THEN
    RAISE NOTICE 'emitir_guia_desde_comprobante no existe; nada que reemplazar';
  ELSE
    -- 'T001' aparece tres veces y las tres son la serie de la guía: al pedir el
    -- correlativo, al insertar la fila y al devolverla en el JSON de respuesta.
    v_src := replace(v_src, '''T001''', '''P002''');
    EXECUTE v_src;
  END IF;
END
$emisor$;

COMMENT ON FUNCTION siguiente_numero_guia IS
  'Correlativo siguiente de guía de remisión. Serie P002 desde el arranque en producción (Daniel, agosto 2026).';
