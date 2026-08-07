-- ============================================================================
-- Geolocalización · Fundaciones (docs/GEOLOCALIZACION.md §11 Fase A)
-- ============================================================================
-- Catálogo geográfico normalizado, ubicaciones del cliente (G-1: cuelgan de
-- User, cross-empresa), consentimiento de ubicación, segmentos y campañas
-- dirigidas, y ampliación de `sucursales` con geo.
--
-- 100% ADITIVA (regla de compatibilidad): columnas nuevas nullable o con
-- default que reproduce el comportamiento actual. Las filas existentes de
-- `sucursales`, `users` y `companies` no cambian en nada.
--
-- La columna PostGIS `location` (geography) NO va aquí: se añade en
-- `prisma/migrations_manual/2026-08-postgis.sql` (depende de la extensión y
-- Prisma no la modela).
--
-- RLS: las tablas con companyId (saved_segments, campanas_dirigidas,
-- campana_audiencia_snapshots, campana_entregas) las cubre el script de
-- aislamiento de Capa 2 al recorrer el esquema; los catálogos geo y las
-- tablas "de la persona" llevan políticas propias en
-- `prisma/migrations_manual/2026-08-rls-geo.sql`.
--
-- Idempotente: se puede correr varias veces sin efecto.
-- ============================================================================

-- ── Enums (con guard de objeto duplicado) ───────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomerLocationType') THEN
    CREATE TYPE "CustomerLocationType" AS ENUM ('HOME', 'WORK', 'OTHER');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomerLocationSource') THEN
    CREATE TYPE "CustomerLocationSource" AS ENUM (
      'MANUAL', 'MAP_SELECTION', 'GEOCODED_ADDRESS', 'DEVICE_LOCATION', 'ADMIN_ASSIGNED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LocationVerificationStatus') THEN
    CREATE TYPE "LocationVerificationStatus" AS ENUM ('UNVERIFIED', 'CONFIRMED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GeoConsentTipo') THEN
    CREATE TYPE "GeoConsentTipo" AS ENUM (
      'FUNCTIONAL_USAGE', 'HOME_STORAGE', 'MARKETING_GEO', 'DEVICE_LOCATION_SESSION'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GeoConsentEstado') THEN
    CREATE TYPE "GeoConsentEstado" AS ENUM ('ACTIVE', 'REVOKED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SegmentoEstado') THEN
    CREATE TYPE "SegmentoEstado" AS ENUM ('BORRADOR', 'ACTIVO', 'ARCHIVADO');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampanaDirigidaEstado') THEN
    CREATE TYPE "CampanaDirigidaEstado" AS ENUM (
      'BORRADOR', 'PROGRAMADA', 'ACTIVA', 'PAUSADA', 'FINALIZADA'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampanaCanal') THEN
    CREATE TYPE "CampanaCanal" AS ENUM ('IN_APP', 'EMAIL', 'PUSH_FUTURO');
  END IF;
END $$;

-- ── Catálogo geográfico: país → región → ciudad → sector ─────────────────────
CREATE TABLE IF NOT EXISTS "geo_countries" (
  "id" TEXT NOT NULL,
  "isoCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "regionLabel" TEXT NOT NULL,
  "isOperative" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "geo_countries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "geo_countries_isoCode_key" ON "geo_countries"("isoCode");

CREATE TABLE IF NOT EXISTS "geo_regions" (
  "id" TEXT NOT NULL,
  "countryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "isOperative" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "geo_regions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "geo_regions_countryId_isOperative_idx" ON "geo_regions"("countryId", "isOperative");
CREATE UNIQUE INDEX IF NOT EXISTS "geo_regions_countryId_normalizedName_key" ON "geo_regions"("countryId", "normalizedName");

CREATE TABLE IF NOT EXISTS "geo_cities" (
  "id" TEXT NOT NULL,
  "regionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "isOperative" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "geo_cities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "geo_cities_regionId_isOperative_idx" ON "geo_cities"("regionId", "isOperative");
CREATE INDEX IF NOT EXISTS "geo_cities_normalizedName_idx" ON "geo_cities"("normalizedName");
CREATE UNIQUE INDEX IF NOT EXISTS "geo_cities_regionId_normalizedName_key" ON "geo_cities"("regionId", "normalizedName");

CREATE TABLE IF NOT EXISTS "geo_sectors" (
  "id" TEXT NOT NULL,
  "cityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "latitud" DOUBLE PRECISION,
  "longitud" DOUBLE PRECISION,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "isOperative" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "geo_sectors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "geo_sectors_cityId_isOperative_idx" ON "geo_sectors"("cityId", "isOperative");
CREATE UNIQUE INDEX IF NOT EXISTS "geo_sectors_cityId_normalizedName_key" ON "geo_sectors"("cityId", "normalizedName");

DO $$ BEGIN ALTER TABLE "geo_regions" ADD CONSTRAINT "geo_regions_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "geo_countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "geo_cities" ADD CONSTRAINT "geo_cities_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "geo_regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "geo_sectors" ADD CONSTRAINT "geo_sectors_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "geo_cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Ubicaciones del cliente (G-1 · cuelgan de User, cross-empresa) ──────────
CREATE TABLE IF NOT EXISTS "customer_locations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT,
  "type" "CustomerLocationType" NOT NULL DEFAULT 'HOME',
  "countryId" TEXT,
  "regionId" TEXT,
  "cityId" TEXT,
  "sectorId" TEXT,
  "regionNameRaw" TEXT,
  "cityNameRaw" TEXT,
  "sectorNameRaw" TEXT,
  "formattedAddress" TEXT,
  "latitud" DOUBLE PRECISION,
  "longitud" DOUBLE PRECISION,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "source" "CustomerLocationSource" NOT NULL,
  "verificationStatus" "LocationVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "consentForPersonalization" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_locations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "customer_locations_userId_isPrimary_idx" ON "customer_locations"("userId", "isPrimary");
CREATE INDEX IF NOT EXISTS "customer_locations_cityId_idx" ON "customer_locations"("cityId");
CREATE INDEX IF NOT EXISTS "customer_locations_sectorId_idx" ON "customer_locations"("sectorId");

DO $$ BEGIN ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "geo_countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "geo_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "geo_cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_sectorId_fkey"
  FOREIGN KEY ("sectorId") REFERENCES "geo_sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Consentimiento de ubicación (un registro por tipo, revocable) ───────────
CREATE TABLE IF NOT EXISTS "geo_consents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tipo" "GeoConsentTipo" NOT NULL,
  "estado" "GeoConsentEstado" NOT NULL DEFAULT 'ACTIVE',
  "version" TEXT NOT NULL,
  "canal" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "geo_consents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "geo_consents_userId_estado_idx" ON "geo_consents"("userId", "estado");
CREATE UNIQUE INDEX IF NOT EXISTS "geo_consents_userId_tipo_key" ON "geo_consents"("userId", "tipo");

DO $$ BEGIN ALTER TABLE "geo_consents" ADD CONSTRAINT "geo_consents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Sucursales: geolocalización (ampliación) ─────────────────────────────────
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "countryId" TEXT;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "regionId" TEXT;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "cityId" TEXT;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "sectorId" TEXT;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "ciudadTexto" TEXT;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "sectorTexto" TEXT;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "latitud" DOUBLE PRECISION;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "longitud" DOUBLE PRECISION;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "mostrarEnMapa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "radioServicioKm" INTEGER;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "ubicacionVerificada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "ubicacionActualizadaAt" TIMESTAMP(3);
ALTER TABLE "sucursales" ADD COLUMN IF NOT EXISTS "horarioDetallado" JSONB;

CREATE INDEX IF NOT EXISTS "sucursales_companyId_activa_mostrarEnMapa_idx"
  ON "sucursales"("companyId", "activa", "mostrarEnMapa");
CREATE INDEX IF NOT EXISTS "sucursales_cityId_idx" ON "sucursales"("cityId");
CREATE INDEX IF NOT EXISTS "sucursales_sectorId_idx" ON "sucursales"("sectorId");

DO $$ BEGIN ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "geo_countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "geo_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "geo_cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_sectorId_fkey"
  FOREIGN KEY ("sectorId") REFERENCES "geo_sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Segmentos guardados (constructor de audiencias) ─────────────────────────
CREATE TABLE IF NOT EXISTS "saved_segments" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdById" TEXT,
  "estado" "SegmentoEstado" NOT NULL DEFAULT 'BORRADOR',
  "ultimaAudienciaEstimada" INTEGER,
  "ultimaEvaluacionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_segments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "saved_segments_companyId_estado_idx" ON "saved_segments"("companyId", "estado");

DO $$ BEGIN ALTER TABLE "saved_segments" ADD CONSTRAINT "saved_segments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "segment_condition_groups" (
  "id" TEXT NOT NULL,
  "segmentId" TEXT NOT NULL,
  "parentId" TEXT,
  "operator" TEXT NOT NULL DEFAULT 'AND',
  "orden" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "segment_condition_groups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "segment_condition_groups_segmentId_idx" ON "segment_condition_groups"("segmentId");
CREATE INDEX IF NOT EXISTS "segment_condition_groups_parentId_idx" ON "segment_condition_groups"("parentId");

DO $$ BEGIN ALTER TABLE "segment_condition_groups" ADD CONSTRAINT "segment_condition_groups_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "saved_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "segment_condition_groups" ADD CONSTRAINT "segment_condition_groups_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "segment_condition_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "segment_conditions" (
  "id" TEXT NOT NULL,
  "segmentId" TEXT NOT NULL,
  "groupId" TEXT,
  "campo" TEXT NOT NULL,
  "operador" TEXT NOT NULL,
  "valor" JSONB NOT NULL DEFAULT '{}',
  "orden" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "segment_conditions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "segment_conditions_segmentId_orden_idx" ON "segment_conditions"("segmentId", "orden");
CREATE INDEX IF NOT EXISTS "segment_conditions_groupId_idx" ON "segment_conditions"("groupId");

DO $$ BEGIN ALTER TABLE "segment_conditions" ADD CONSTRAINT "segment_conditions_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "saved_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "segment_conditions" ADD CONSTRAINT "segment_conditions_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "segment_condition_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Campañas dirigidas (audiencia + canales + entregas) ─────────────────────
CREATE TABLE IF NOT EXISTS "campanas_dirigidas" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "segmentId" TEXT,
  "nombre" TEXT NOT NULL,
  "mensaje" TEXT NOT NULL,
  "canales" "CampanaCanal"[] NOT NULL,
  "programadaEn" TIMESTAMP(3),
  "estado" "CampanaDirigidaEstado" NOT NULL DEFAULT 'BORRADOR',
  "maxPorDia" INTEGER DEFAULT 1,
  "maxPorSemana" INTEGER DEFAULT 2,
  "prioridad" INTEGER NOT NULL DEFAULT 0,
  "sucursalId" TEXT,
  "radioKm" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campanas_dirigidas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "campanas_dirigidas_companyId_estado_idx" ON "campanas_dirigidas"("companyId", "estado");

DO $$ BEGIN ALTER TABLE "campanas_dirigidas" ADD CONSTRAINT "campanas_dirigidas_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "campanas_dirigidas" ADD CONSTRAINT "campanas_dirigidas_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "saved_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "campanas_dirigidas" ADD CONSTRAINT "campanas_dirigidas_sucursalId_fkey"
  FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "campana_audiencia_snapshots" (
  "id" TEXT NOT NULL,
  "campanaId" TEXT NOT NULL,
  "totalElegibles" INTEGER NOT NULL,
  "totalExcluidos" INTEGER NOT NULL,
  "sinConsentimiento" INTEGER NOT NULL,
  "porCiudad" JSONB NOT NULL DEFAULT '{}',
  "porSector" JSONB NOT NULL DEFAULT '{}',
  "advertencias" JSONB NOT NULL DEFAULT '[]',
  "calculadaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campana_audiencia_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "campana_audiencia_snapshots_campanaId_idx" ON "campana_audiencia_snapshots"("campanaId");

DO $$ BEGIN ALTER TABLE "campana_audiencia_snapshots" ADD CONSTRAINT "campana_audiencia_snapshots_campanaId_fkey"
  FOREIGN KEY ("campanaId") REFERENCES "campanas_dirigidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "campana_entregas" (
  "id" TEXT NOT NULL,
  "campanaId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "canal" "CampanaCanal" NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "motivoExclusion" TEXT,
  "enviadaAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campana_entregas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "campana_entregas_campanaId_estado_idx" ON "campana_entregas"("campanaId", "estado");
CREATE INDEX IF NOT EXISTS "campana_entregas_clienteId_idx" ON "campana_entregas"("clienteId");

DO $$ BEGIN ALTER TABLE "campana_entregas" ADD CONSTRAINT "campana_entregas_campanaId_fkey"
  FOREIGN KEY ("campanaId") REFERENCES "campanas_dirigidas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Eventos de búsqueda en el mapa (analítica agregada, §35) ────────────────
CREATE TABLE IF NOT EXISTS "location_search_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "contexto" TEXT NOT NULL,
  "countryId" TEXT,
  "cityId" TEXT,
  "sectorId" TEXT,
  "latitud" DOUBLE PRECISION,
  "longitud" DOUBLE PRECISION,
  "radioKm" INTEGER,
  "filtros" JSONB NOT NULL DEFAULT '{}',
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_search_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "location_search_events_contexto_createdAt_idx" ON "location_search_events"("contexto", "createdAt");
CREATE INDEX IF NOT EXISTS "location_search_events_cityId_createdAt_idx" ON "location_search_events"("cityId", "createdAt");

-- Centinela: confirma que los objetos quedaron creados.
SELECT 'geo_fundaciones' AS objeto,
       CASE WHEN to_regclass('public.customer_locations') IS NOT NULL
             AND to_regclass('public.geo_countries') IS NOT NULL
             AND to_regclass('public.campanas_dirigidas') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
