-- ─────────────────────────────────────────────────────────────────────────────
-- 031: Caja — cableado automático de cobros como movimientos de caja
--
-- Problema: el módulo de Caja calculaba "ingresos de la sesión" filtrando
-- la tabla cobros por fecha de apertura, pero los cobros no quedaban
-- registrados como movimientos en `caja_movimientos`. Resultado: la sesión
-- de caja era frágil (depende de timestamps y zona horaria) y no había
-- trazabilidad cuando un cobro y una sesión se solapaban.
--
-- Fix:
--   - Trigger AFTER INSERT en cobros: si existe sesión de caja abierta,
--     crea automáticamente un movimiento tipo='ingreso', categoria='cobro_cliente'
--     vinculado a la sesión activa y al cobro original.
--   - Trigger AFTER UPDATE en cobros (cambio de monto): actualiza el monto
--     del movimiento espejo si existe.
--   - Trigger AFTER DELETE en cobros: elimina el movimiento espejo.
--
-- Nota: agregamos columna `cobro_id` a `caja_movimientos` para enlazar
-- al cobro origen. Es nullable: egresos y ajustes no tienen cobro_id.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Columna cobro_id en caja_movimientos
ALTER TABLE caja_movimientos
  ADD COLUMN IF NOT EXISTS cobro_id UUID REFERENCES cobros(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_caja_movimientos_cobro_id
  ON caja_movimientos(cobro_id)
  WHERE cobro_id IS NOT NULL;

-- 2) Función: sincronizar cobro -> caja_movimientos
CREATE OR REPLACE FUNCTION sync_cobro_a_caja_movimiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sesion_id UUID;
  v_descripcion TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Busca sesión abierta más reciente
    SELECT id INTO v_sesion_id
      FROM caja_sesiones
      WHERE estado = 'abierta'
      ORDER BY fecha_apertura DESC
      LIMIT 1;

    -- Si no hay sesión abierta, NO crea el movimiento (cobro queda solo en cobros)
    IF v_sesion_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Descripción legible
    v_descripcion := 'Cobro #' || substr(NEW.id::text, 1, 8);

    INSERT INTO caja_movimientos (
      sesion_id, tipo, categoria, descripcion, monto, cobrador_id, cobro_id
    ) VALUES (
      v_sesion_id, 'ingreso', 'cobro_cliente', v_descripcion,
      NEW.total, NEW.cobrador_id, NEW.id
    );

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Si cambió el monto total, actualiza el espejo
    IF NEW.total IS DISTINCT FROM OLD.total THEN
      UPDATE caja_movimientos
        SET monto = NEW.total
        WHERE cobro_id = NEW.id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- El ON DELETE CASCADE de cobro_id ya borra, pero por defensa lo hacemos explícito
    DELETE FROM caja_movimientos WHERE cobro_id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- 3) Drop + recreate triggers (idempotente)
DROP TRIGGER IF EXISTS trg_cobro_insert_caja_mov ON cobros;
DROP TRIGGER IF EXISTS trg_cobro_update_caja_mov ON cobros;
DROP TRIGGER IF EXISTS trg_cobro_delete_caja_mov ON cobros;

CREATE TRIGGER trg_cobro_insert_caja_mov
AFTER INSERT ON cobros
FOR EACH ROW
EXECUTE FUNCTION sync_cobro_a_caja_movimiento();

CREATE TRIGGER trg_cobro_update_caja_mov
AFTER UPDATE ON cobros
FOR EACH ROW
EXECUTE FUNCTION sync_cobro_a_caja_movimiento();

CREATE TRIGGER trg_cobro_delete_caja_mov
AFTER DELETE ON cobros
FOR EACH ROW
EXECUTE FUNCTION sync_cobro_a_caja_movimiento();

-- 4) Backfill: cobros del día actual sin movimiento espejo, dentro de la sesión abierta
DO $$
DECLARE
  v_sesion_id UUID;
  v_apertura TIMESTAMPTZ;
BEGIN
  SELECT id, fecha_apertura INTO v_sesion_id, v_apertura
    FROM caja_sesiones
    WHERE estado = 'abierta'
    ORDER BY fecha_apertura DESC
    LIMIT 1;

  IF v_sesion_id IS NOT NULL THEN
    INSERT INTO caja_movimientos (
      sesion_id, tipo, categoria, descripcion, monto, cobrador_id, cobro_id
    )
    SELECT
      v_sesion_id, 'ingreso', 'cobro_cliente',
      'Cobro #' || substr(c.id::text, 1, 8),
      c.total, c.cobrador_id, c.id
    FROM cobros c
    WHERE c.created_at >= v_apertura
      AND NOT EXISTS (
        SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id
      );
  END IF;
END
$$;

-- 5) Habilitar realtime en las tablas relevantes (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cobros'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cobros;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'caja_sesiones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE caja_sesiones;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'caja_movimientos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE caja_movimientos;
  END IF;
END
$$;
