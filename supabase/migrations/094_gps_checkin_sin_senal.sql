-- ─────────────────────────────────────────────────────────────────────────────
-- 094: un check-in puede quedar sin coordenadas
--
-- `gps_checkins.latitud` y `longitud` eran NOT NULL, así que cuando el teléfono
-- no daba posición había que inventar una para poder guardar. El pedido usaba
-- la ubicación del cliente como relleno, y eso vacía de sentido el control: la
-- marca decía que el vendedor estuvo donde el cliente aunque el GPS jamás
-- hubiera respondido. Peor todavía con nueve clientes geocodificados a un punto
-- de la selva y otro a Lima, que arrastraban el mapa fuera de Tacna.
--
-- Ahora la visita se registra igual y la ubicación queda vacía cuando no hubo
-- señal. El módulo de GPS avisa cuántas marcas están en esa situación: un dato
-- ausente se ve y se puede reclamar; uno inventado, no.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE gps_checkins ALTER COLUMN latitud  DROP NOT NULL;
ALTER TABLE gps_checkins ALTER COLUMN longitud DROP NOT NULL;

COMMENT ON COLUMN gps_checkins.latitud IS
  'Latitud del dispositivo al marcar. NULL si no hubo señal GPS: no se rellena con la ubicación del cliente.';
COMMENT ON COLUMN gps_checkins.longitud IS
  'Longitud del dispositivo al marcar. NULL si no hubo señal GPS.';
