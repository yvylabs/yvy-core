-- 0001_eventos: contadores agregados de telemetría (nunca filas crudas).
-- Aplicar: wrangler d1 execute yvy-telemetry --file migrations/0001_eventos.sql
CREATE TABLE IF NOT EXISTS eventos (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  yvy_id INTEGER,
  nivel TEXT,
  country TEXT,
  n INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, event, yvy_id, nivel, country)
);
