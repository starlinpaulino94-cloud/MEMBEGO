-- ============================================================================
-- POSTGIS · G-4 — columnas `geography`, GiST y triggers de sincronización
-- (docs/GEOLOCALIZACION.md §6.2)
-- ============================================================================
--
-- Esto NO va en `prisma/migrations/`: Prisma no modela `geography(Point,4326)`
-- (tipo `Unsupported` que degrada la DX). El patrón acordado es doble escritura
-- con trigger:
--
--   1. PRISMA es la fuente de verdad de los datos: `Sucursal.latitud/longitud`
--      y `CustomerLocation.latitud/longitud` (Float) se gestionan con el ORM y
--      las Server Actions.
--   2. La columna `location` (geography) se SINCRONIZA sola con un BEFORE
--      INSERT/UPDATE trigger. Nunca se escribe a mano desde la aplicación.
--   3. Las consultas geoespaciales van por `prisma.$queryRaw` (siempre con
--      parámetros, nunca interpolando input del usuario): radio = ST_DWithin,
--      orden = <-> , viewport = && ST_MakeEnvelope.
--
-- Requiere que la extensión esté habilitada en Supabase (SQL Editor):
--   CREATE EXTENSION IF NOT EXISTS postgis;
-- Es gratis en Supabase. Si por cualquier razón no se habilita, el fallback
-- documentado (§6.3) es bounding box + Haversine en SQL sobre los Float — el
-- código de la app escribe contra `src/modules/geo/` que abstrae el proveedor
-- espacial.
--
-- Idempotente: se puede correr varias veces sin efecto.
-- ============================================================================

-- ── 1. Extensión (no-op si ya está) ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── 2. Sucursales ────────────────────────────────────────────────────────────
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "location" geography(Point, 4326);
CREATE INDEX IF NOT EXISTS "idx_sucursales_location_gist" ON "sucursales" USING GIST ("location");

CREATE OR REPLACE FUNCTION public.sync_sucursal_location() RETURNS trigger AS $$
BEGIN
  NEW."location" := CASE
    WHEN NEW.latitud IS NOT NULL AND NEW.longitud IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(NEW.longitud, NEW.latitud), 4326)::geography
    ELSE NULL
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sucursal_location ON "sucursales";
CREATE TRIGGER trg_sucursal_location
  BEFORE INSERT OR UPDATE OF latitud, longitud
  ON "sucursales" FOR EACH ROW
  EXECUTE FUNCTION public.sync_sucursal_location();

-- ── 3. Ubicaciones del cliente (G-1) ────────────────────────────────────────
ALTER TABLE "customer_locations" ADD COLUMN IF NOT EXISTS "location" geography(Point, 4326);
CREATE INDEX IF NOT EXISTS "idx_customer_locations_location_gist" ON "customer_locations" USING GIST ("location");

CREATE OR REPLACE FUNCTION public.sync_customer_location() RETURNS trigger AS $$
BEGIN
  NEW."location" := CASE
    WHEN NEW.latitud IS NOT NULL AND NEW.longitud IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(NEW.longitud, NEW.latitud), 4326)::geography
    ELSE NULL
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_location ON "customer_locations";
CREATE TRIGGER trg_customer_location
  BEFORE INSERT OR UPDATE OF latitud, longitud
  ON "customer_locations" FOR EACH ROW
  EXECUTE FUNCTION public.sync_customer_location();

-- ── 4. Backfill de las filas existentes (idempotente) ────────────────────────
UPDATE "sucursales"
   SET "location" = ST_SetSRID(ST_MakePoint("longitud", "latitud"), 4326)::geography
 WHERE "latitud" IS NOT NULL AND "longitud" IS NOT NULL;

UPDATE "customer_locations"
   SET "location" = ST_SetSRID(ST_MakePoint("longitud", "latitud"), 4326)::geography
 WHERE "latitud" IS NOT NULL AND "longitud" IS NOT NULL;

-- ── Verificación ─────────────────────────────────────────────────────────────
SELECT 'postgis' AS objeto,
       CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
             AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.sucursales'::regclass AND attname = 'location')
             AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_locations'::regclass AND attname = 'location')
            THEN 'OK' ELSE 'FALTA' END AS estado;
