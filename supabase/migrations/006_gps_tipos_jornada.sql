-- Migración 006: ampliar tipos de check-in GPS para jornada y ruta

ALTER TYPE tipo_gps_checkin ADD VALUE IF NOT EXISTS 'inicio_jornada';
ALTER TYPE tipo_gps_checkin ADD VALUE IF NOT EXISTS 'fin_jornada';
ALTER TYPE tipo_gps_checkin ADD VALUE IF NOT EXISTS 'en_ruta';
ALTER TYPE tipo_gps_checkin ADD VALUE IF NOT EXISTS 'regreso';

-- Permitir cliente_id NULL para check-ins sin cliente asignado
ALTER TABLE gps_checkins ALTER COLUMN cliente_id DROP NOT NULL;
