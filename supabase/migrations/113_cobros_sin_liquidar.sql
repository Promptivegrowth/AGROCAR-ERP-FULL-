-- ═══════════════════════════════════════════════════════════════════════════
-- 113 · Los cobros pendientes de liquidar, sin que se corten a las mil filas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Daniel: "no puedo cerrar [la caja] del 17 y no se carga a la caja automático".
--
-- Lo que realmente pasaba
-- -----------------------
-- Nada estaba pendiente. Los 43 cobros del 17/09 —S/ 5.098,28— entraron solos
-- en la sesión del 18/09 y esa sesión está cerrada. La apertura automática hizo
-- su trabajo: 43 del 17 más 11 del 18 son los 54 movimientos de esa sesión.
--
-- Lo que fallaba era el AVISO. La pantalla mostraba "hay 21 cobros sin liquidar
-- del 17/09 · S/ 3.612,56" sobre cobros que ya estaban liquidados, y como al
-- abrir caja no se cargaba nada —no había nada que cargar—, parecía que el
-- sistema no los levantaba.
--
-- Por qué el aviso mentía
-- -----------------------
-- Para saber qué cobros ya están en caja, la pantalla traía TODOS los
-- movimientos con cobro y armaba un conjunto en memoria:
--
--     .from('caja_movimientos').select('cobro_id').not('cobro_id','is',null)
--
-- Sin `limit`, PostgREST devuelve como mucho mil filas. Hoy hay 1.065
-- movimientos con cobro: los 65 que no entraban quedaban fuera del conjunto y
-- sus cobros aparecían como pendientes aunque estuvieran liquidados hace días.
--
-- La otra consulta tenía el mismo problema: los 1.065 cobros tampoco entran en
-- mil filas.
--
-- Es el mismo defecto que apareció en Facturación con el tope de mil
-- comprobantes. Un tope que nadie puso a propósito y que no avisa cuando corta:
-- la consulta simplemente devuelve menos.
--
-- El arreglo
-- ----------
-- Una sola consulta que responde la pregunta de verdad —qué cobros no tienen
-- movimiento de caja— en vez de traerse dos listas enteras para cruzarlas en el
-- navegador. Sin listas que traer, no hay nada que se pueda cortar.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cobros_sin_liquidar()
RETURNS TABLE (
  id      UUID,
  numero  TEXT,
  fecha   DATE,
  total   NUMERIC,
  cliente TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id,
         c.numero,
         c.fecha,
         c.total,
         COALESCE(NULLIF(TRIM(cl.razon_social), ''),
                  NULLIF(TRIM(c.cliente_externo_nombre), ''),
                  '—') AS cliente
    FROM cobros c
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
   WHERE c.fecha <> (NOW() AT TIME ZONE 'America/Lima')::date
     AND COALESCE(c.total, 0) > 0
     AND NOT EXISTS (
           SELECT 1 FROM caja_movimientos m WHERE m.cobro_id = c.id
         )
   ORDER BY c.fecha, c.created_at;
$$;

COMMENT ON FUNCTION cobros_sin_liquidar IS
  'Cobros de dias anteriores que todavia no entraron a ninguna sesion de caja. Se resuelve en una consulta: cruzarlo en el navegador obligaba a traer todos los movimientos, y PostgREST los cortaba en mil.';

GRANT EXECUTE ON FUNCTION cobros_sin_liquidar TO authenticated;
