-- ═══════════════════════════════════════════════════════════════════════════
-- 114 · La guía de remisión, lista para declararse ante SUNAT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La guía de remisión electrónica es obligatoria desde el 1 de enero de 2024, y
-- la discrecionalidad para no sancionar al REMITENTE —que es el caso de
-- AGROCAR, que traslada su propia mercadería— venció el 31 de agosto de 2026
-- (RS 000031-2026-SUNAT/700000).
--
-- Esta migración prepara la base. No activa nada.
--
-- 1. La serie estaba mal
-- ----------------------
-- SUNAT exige que la serie de una guía electrónica tenga cuatro caracteres y
-- empiece con la letra T (T001). La migración 093 la dejó en 'P002' junto con
-- las series nuevas de facturas y boletas, y con esa serie SUNAT rechaza el
-- documento.
--
-- Se corrige a T001. Las dos guías que existen nunca se enviaron —no hay nada
-- declarado que quede inconsistente—, así que se renumeran con la serie buena.
--
-- Ojo: los documentos internos usan T001 y T002 en `series_correlativos`, pero
-- son otra tabla y otro documento; no chocan. La guía se numera sola tomando el
-- máximo de `guias_remision`.
--
-- 2. Faltaban los ubigeos
-- -----------------------
-- SUNAT los exige en los dos extremos del traslado, y las dos guías existentes
-- los tienen en NULL. Se deja cargado el de partida —el almacén de AGROCAR, en
-- Tacna— como valor por omisión, porque siempre sale del mismo sitio. El de
-- llegada depende del cliente y se completa al emitir.
--
-- 3. Dónde se guarda el resultado
-- -------------------------------
-- El envío de guías es ASÍNCRONO: SUNAT devuelve un ticket y el veredicto se
-- consulta después. Por eso hace falta guardar el ticket, y no solo un estado:
-- sin el ticket no hay forma de volver a preguntar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La serie ────────────────────────────────────────────────────────────
ALTER TABLE guias_remision ALTER COLUMN serie SET DEFAULT 'T001';

UPDATE guias_remision SET serie = 'T001'
 WHERE serie = 'P002' AND COALESCE(enviado_sunat, FALSE) = FALSE;

CREATE OR REPLACE FUNCTION siguiente_numero_guia(p_serie TEXT DEFAULT 'T001')
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

COMMENT ON COLUMN guias_remision.serie IS
  'Serie de la guia. SUNAT exige cuatro caracteres empezando con T (T001): con otra letra rechaza el documento.';


-- ── 2. Ubigeos ─────────────────────────────────────────────────────────────
-- 230101 = Tacna / Tacna / Tacna, donde está el almacén.
INSERT INTO configuracion (clave, valor, descripcion)
VALUES ('gre_ubigeo_partida', '230101',
        'Ubigeo del almacen, punto de partida de los traslados. SUNAT lo exige en la guia.')
ON CONFLICT (clave) DO NOTHING;

UPDATE guias_remision SET ubigeo_partida = '230101'
 WHERE ubigeo_partida IS NULL;


-- ── 3. El resultado del envío ──────────────────────────────────────────────
ALTER TABLE guias_remision
  ADD COLUMN IF NOT EXISTS sunat_ticket      TEXT,
  ADD COLUMN IF NOT EXISTS sunat_estado      TEXT,
  ADD COLUMN IF NOT EXISTS sunat_codigo      TEXT,
  ADD COLUMN IF NOT EXISTS sunat_mensaje     TEXT,
  ADD COLUMN IF NOT EXISTS sunat_xml         TEXT,
  ADD COLUMN IF NOT EXISTS sunat_cdr         TEXT,
  ADD COLUMN IF NOT EXISTS sunat_enviado_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sunat_intentos    INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN guias_remision.sunat_ticket IS
  'El envio es asincrono: SUNAT devuelve un ticket y el veredicto se consulta despues. Sin el ticket no hay forma de volver a preguntar.';
COMMENT ON COLUMN guias_remision.sunat_estado IS
  'procesando | aceptado | rechazado | error';

CREATE INDEX IF NOT EXISTS idx_guias_sunat_pendientes
  ON guias_remision (sunat_estado)
  WHERE sunat_estado = 'procesando';


-- ── 4. Los interruptores, apagados ─────────────────────────────────────────
--
-- Se crean para que existan, no para prenderlos. Igual que con los
-- comprobantes: el dia que se arranque se prenden desde la pantalla, y hasta
-- entonces `configuracionGre` se niega a enviar y dice por que.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('gre_activo', 'false',
   'Declarar guias de remision a SUNAT. La guia NO tiene ambiente de pruebas: lo que se manda, queda.'),
  ('gre_declarar_desde', '',
   'Desde que fecha se declaran guias. Vacio: no se declara ninguna.')
ON CONFLICT (clave) DO NOTHING;
