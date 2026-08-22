-- ─────────────────────────────────────────────────────────────────────────────
-- 095: cola de impresión de tickets
--
-- Hasta ahora el navegador le hablaba directo al agente de impresión, y los
-- navegadores están cerrando esa puerta: Chrome y Edge restringen que una
-- página de internet se comunique con programas de la propia computadora
-- (Local Network Access). Se hizo funcionar a fuerza de cabeceras y permisos,
-- pero es una pelea que se pierde sola: la restricción se endurece con cada
-- versión y habría que tocar la configuración de cada equipo.
--
-- Se da vuelta la relación. El ERP deja el ticket acá; el agente —que es un
-- programa local y no tiene ninguna restricción— pregunta si hay algo para
-- imprimir y lo imprime. El navegador nunca habla con la impresora.
--
-- Efectos secundarios buenos: se puede facturar desde el celular en la calle y
-- que el ticket salga en la impresora de la oficina, y se puede mandar a una
-- impresora que está en otra computadora.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Equipos con ticketera ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipos_impresion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           TEXT NOT NULL,
  -- Con este token el agente se identifica. No se usa la clave de Supabase
  -- para que un equipo comprometido no dé acceso a nada más que a su cola.
  token            UUID NOT NULL DEFAULT gen_random_uuid(),
  impresora        TEXT,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  ultima_conexion  TIMESTAMPTZ,
  version_agente   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_equipos_impresion_token ON equipos_impresion (token);
CREATE INDEX IF NOT EXISTS idx_equipos_impresion_activo ON equipos_impresion (activo);

-- ── Trabajos pendientes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cola_impresion (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipo_id      UUID REFERENCES equipos_impresion(id) ON DELETE CASCADE,
  -- Los bytes ESC/POS del ticket, en base64. El formato lo arma el ERP: así
  -- se cambia el diseño actualizando el sistema, sin reinstalar nada.
  contenido      TEXT NOT NULL,
  descripcion    TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','impreso','error','cancelado')),
  intentos       INT NOT NULL DEFAULT 0,
  error          TEXT,
  creado_por     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  impreso_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cola_pendientes
  ON cola_impresion (equipo_id, estado, created_at)
  WHERE estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_cola_creado ON cola_impresion (created_at DESC);

-- ── Permisos ─────────────────────────────────────────────────────────────────
--
-- El agente no entra por acá: usa las rutas del ERP con su token. Estas
-- políticas son para las pantallas del sistema.
ALTER TABLE equipos_impresion ENABLE ROW LEVEL SECURITY;
ALTER TABLE cola_impresion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipos_lectura ON equipos_impresion;
CREATE POLICY equipos_lectura ON equipos_impresion FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS equipos_admin ON equipos_impresion;
CREATE POLICY equipos_admin ON equipos_impresion FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('administrador','gerente')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('administrador','gerente')));

-- Cualquiera que factura puede encolar y ver el estado de lo suyo
DROP POLICY IF EXISTS cola_lectura ON cola_impresion;
CREATE POLICY cola_lectura ON cola_impresion FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS cola_insertar ON cola_impresion;
CREATE POLICY cola_insertar ON cola_impresion FOR INSERT TO authenticated WITH CHECK (TRUE);

-- ── Limpieza ─────────────────────────────────────────────────────────────────
--
-- Los tickets impresos no sirven para nada después: se borran los de más de
-- tres días para que la tabla no crezca sin control. Con 40 tickets diarios y
-- unos 400 bytes cada uno esto es poco, pero conviene dejarlo previsto.
CREATE OR REPLACE FUNCTION limpiar_cola_impresion()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_borrados INT;
BEGIN
  DELETE FROM cola_impresion
  WHERE estado <> 'pendiente'
    AND created_at < NOW() - INTERVAL '3 days';
  GET DIAGNOSTICS v_borrados = ROW_COUNT;
  RETURN v_borrados;
END;
$$;

GRANT EXECUTE ON FUNCTION limpiar_cola_impresion TO authenticated;

COMMENT ON TABLE cola_impresion IS
  'Tickets esperando salir por la ticketera. El ERP los deja acá y el agente de impresión los levanta; el navegador nunca habla con la impresora.';
COMMENT ON TABLE equipos_impresion IS
  'Computadoras con ticketera. El token identifica al agente sin darle acceso al resto del sistema.';
