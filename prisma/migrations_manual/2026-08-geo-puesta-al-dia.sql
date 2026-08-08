-- ============================================================================
-- GEOLOCALIZACIÓN · PUESTA AL DÍA EN UN SOLO PASO
-- ============================================================================
-- Pégalo entero en el editor SQL de Supabase y córrelo UNA vez. Hace, en el
-- único orden que funciona:
--
--   1. Crear las tablas de la fase geo  (= 20260801_geo_fundaciones)
--   2. Sembrar el catálogo de República Dominicana
--
-- Se puede correr las veces que haga falta: todo lleva IF NOT EXISTS o
-- ON CONFLICT. Es 100% ADITIVO — ninguna fila existente de `users`,
-- `companies` ni `sucursales` cambia.
--
-- NO incluye PostGIS ni las políticas RLS a propósito: PostGIS necesita la
-- extensión instalada y el RLS necesita el rol `membego_app`. Los dos son
-- opcionales y van aparte, DESPUÉS de este archivo.
--
-- Al final imprime una tabla de comprobación. Espera:
--   paises=1  provincias=32  ciudades=81  sectores=73
-- ============================================================================

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


-- ── 2. Catálogo geográfico ───────────────────────────────────────────────

INSERT INTO public.geo_countries (id, "isoCode", name, "regionLabel", "isOperative", "createdAt")
VALUES (gen_random_uuid()::text, 'DO', 'República Dominicana', 'Provincia', true, now())
ON CONFLICT ("isoCode") DO UPDATE SET name = EXCLUDED.name, "regionLabel" = EXCLUDED."regionLabel", "isOperative" = true;

INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Distrito Nacional', 'DISTRITO NACIONAL', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL'), 'Santo Domingo', 'SANTO DOMINGO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Gazcue', 'GAZCUE', 18.4683, -69.8989, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Naco', 'NACO', 18.4705, -69.9416, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Piantini', 'PIANTINI', 18.4773, -69.9443, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Arroyo Hondo', 'ARROYO HONDO', 18.5097, -69.9605, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Bella Vista', 'BELLA VISTA', 18.4555, -69.9504, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Evaristo Morales', 'EVARISTO MORALES', 18.4627, -69.9306, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'La Esperilla', 'LA ESPERILLA', 18.4667, -69.9306, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Los Prados', 'LOS PRADOS', 18.4806, -69.9461, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Mirador Sur', 'MIRADOR SUR', 18.4524, -69.9631, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Los Cacicazgos', 'LOS CACICAZGOS', 18.4495, -69.9623, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Ciudad Universitaria', 'CIUDAD UNIVERSITARIA', 18.465, -69.954, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Ensanche La Paz', 'ENSANCHE LA PAZ', 18.4877, -69.943, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Villa Juana', 'VILLA JUANA', 18.4833, -69.9066, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Villa Consuelo', 'VILLA CONSUELO', 18.4874, -69.9085, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Villa Francisca', 'VILLA FRANCISCA', 18.4754, -69.901, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'San Carlos', 'SAN CARLOS', 18.4723, -69.9057, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Simón Bolívar', 'SIMON BOLIVAR', 18.4934, -69.9144, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Cristo Rey', 'CRISTO REY', 18.4957, -69.9144, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Capotillo', 'CAPOTILLO', 18.4922, -69.907, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Ensanche Luperón', 'ENSANCHE LUPERON', 18.4759, -69.9125, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Gascue', 'GASCUE', 18.4683, -69.8989, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Honduras del Norte', 'HONDURAS DEL NORTE', 18.5, -69.926, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'La Julia', 'LA JULIA', 18.4639, -69.9347, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Mata Hambre', 'MATA HAMBRE', 18.4892, -69.9284, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Palma Real', 'PALMA REAL', 18.453, -69.9419, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DISTRITO NACIONAL') AND "normalizedName" = 'SANTO DOMINGO'), 'Los Restauradores', 'LOS RESTAURADORES', 18.4858, -69.946, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Santo Domingo', 'SANTO DOMINGO', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO'), 'Santo Domingo Este', 'SANTO DOMINGO ESTE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO') AND "normalizedName" = 'SANTO DOMINGO ESTE'), 'Los Mina', 'LOS MINA', 18.4922, -69.876, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO'), 'Santo Domingo Norte', 'SANTO DOMINGO NORTE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO') AND "normalizedName" = 'SANTO DOMINGO NORTE'), 'Villa Mella', 'VILLA MELLA', 18.5309, -69.9027, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO'), 'Santo Domingo Oeste', 'SANTO DOMINGO OESTE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO') AND "normalizedName" = 'SANTO DOMINGO OESTE'), 'Herrea', 'HERREA', 18.4774, -69.977, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO'), 'Boca Chica', 'BOCA CHICA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO') AND "normalizedName" = 'BOCA CHICA'), 'Playa Boca Chica', 'PLAYA BOCA CHICA', 18.4535, -69.6066, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO'), 'San Antonio de Guerra', 'SAN ANTONIO DE GUERRA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO'), 'Los Alcarrizos', 'LOS ALCARRIZOS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTO DOMINGO'), 'Pedro Brand', 'PEDRO BRAND', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Santiago', 'SANTIAGO', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO'), 'Santiago de los Caballeros', 'SANTIAGO DE LOS CABALLEROS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Centro Histórico', 'CENTRO HISTORICO', 19.4517, -70.697, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Los Jardines Metropolitanos', 'LOS JARDINES METROPOLITANOS', 19.441, -70.71, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Los Pepines', 'LOS PEPINES', 19.466, -70.7, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Bella Vista', 'BELLA VISTA', 19.473, -70.694, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'La Trinitaria', 'LA TRINITARIA', 19.465, -70.709, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Villa Olga', 'VILLA OLGA', 19.46, -70.709, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Nibaje', 'NIBAJE', 19.47, -70.713, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Ensanche Bolívar', 'ENSANCHE BOLIVAR', 19.458, -70.704, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'El Ensueño', 'EL ENSUENO', 19.471, -70.707, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Reparto del Este', 'REPARTO DEL ESTE', 19.458, -70.689, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Cerro Alto', 'CERRO ALTO', 19.4776, -70.691, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO') AND "normalizedName" = 'SANTIAGO DE LOS CABALLEROS'), 'Urbanización Los Reyes', 'URBANIZACION LOS REYES', 19.4699, -70.6866, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO'), 'Bisonó (Navarrete)', 'BISONO NAVARRETE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO'), 'Jánico', 'JANICO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO'), 'Licey al Medio', 'LICEY AL MEDIO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO'), 'San José de las Matas', 'SAN JOSE DE LAS MATAS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO'), 'Tamboril', 'TAMBORIL', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO'), 'Villa González', 'VILLA GONZALEZ', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'La Altagracia', 'LA ALTAGRACIA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA'), 'Higüey', 'HIGUEY', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA') AND "normalizedName" = 'HIGUEY'), 'Centro de Higüey', 'CENTRO DE HIGUEY', 18.618, -68.707, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA'), 'Punta Cana', 'PUNTA CANA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA') AND "normalizedName" = 'PUNTA CANA'), 'Bávaro', 'BAVARO', 18.6809, -68.4372, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA') AND "normalizedName" = 'PUNTA CANA'), 'Verón', 'VERON', 18.63, -68.45, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA') AND "normalizedName" = 'PUNTA CANA'), 'Cabeza de Toro', 'CABEZA DE TORO', 18.648, -68.392, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA') AND "normalizedName" = 'PUNTA CANA'), 'El Cortecito', 'EL CORTECITO', 18.682, -68.435, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA') AND "normalizedName" = 'PUNTA CANA'), 'Los Corales', 'LOS CORALES', 18.646, -68.396, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ALTAGRACIA'), 'San Rafael del Yuma', 'SAN RAFAEL DEL YUMA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'La Romana', 'LA ROMANA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ROMANA'), 'La Romana', 'LA ROMANA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ROMANA') AND "normalizedName" = 'LA ROMANA'), 'Centro', 'CENTRO', 18.427, -68.973, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ROMANA') AND "normalizedName" = 'LA ROMANA'), 'Villa Hermosa', 'VILLA HERMOSA', 18.44, -68.996, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ROMANA'), 'Guaymate', 'GUAYMATE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA ROMANA'), 'Villa Hermosa', 'VILLA HERMOSA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'San Cristóbal', 'SAN CRISTOBAL', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'San Cristóbal', 'SAN CRISTOBAL', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL') AND "normalizedName" = 'SAN CRISTOBAL'), 'Centro', 'CENTRO', 18.417, -70.106, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL') AND "normalizedName" = 'SAN CRISTOBAL'), 'Madre Vieja', 'MADRE VIEJA', 18.405, -70.126, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'Bajos de Haina', 'BAJOS DE HAINA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'Cambita Garabitos', 'CAMBITA GARABITOS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'Los Cacaos', 'LOS CACAOS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'Sabana Grande de Palenque', 'SABANA GRANDE DE PALENQUE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'San Gregorio de Nigua', 'SAN GREGORIO DE NIGUA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'Villa Altagracia', 'VILLA ALTAGRACIA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN CRISTOBAL'), 'Yaguate', 'YAGUATE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Puerto Plata', 'PUERTO PLATA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA'), 'San Felipe de Puerto Plata', 'SAN FELIPE DE PUERTO PLATA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA') AND "normalizedName" = 'SAN FELIPE DE PUERTO PLATA'), 'Centro', 'CENTRO', 19.7974, -70.6918, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA') AND "normalizedName" = 'SAN FELIPE DE PUERTO PLATA'), 'Playa Dorada', 'PLAYA DORADA', 19.783, -70.664, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA') AND "normalizedName" = 'SAN FELIPE DE PUERTO PLATA'), 'El Mamey', 'EL MAMEY', 19.776, -70.704, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA'), 'Sosúa', 'SOSUA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA') AND "normalizedName" = 'SOSUA'), 'El Batey', 'EL BATEY', 19.75, -70.521, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA'), 'Altamira', 'ALTAMIRA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA'), 'Imbert', 'IMBERT', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA'), 'Luperón', 'LUPERON', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA'), 'Villa Isabela', 'VILLA ISABELA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PUERTO PLATA'), 'Villa Montellano', 'VILLA MONTELLANO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'La Vega', 'LA VEGA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA VEGA'), 'Concepción de la Vega', 'CONCEPCION DE LA VEGA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA VEGA') AND "normalizedName" = 'CONCEPCION DE LA VEGA'), 'Centro', 'CENTRO', 19.222, -70.528, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA VEGA'), 'Constanza', 'CONSTANZA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA VEGA'), 'Jarabacoa', 'JARABACOA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'LA VEGA'), 'Jima Abajo', 'JIMA ABAJO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'San Pedro de Macorís', 'SAN PEDRO DE MACORIS', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN PEDRO DE MACORIS'), 'San Pedro de Macorís', 'SAN PEDRO DE MACORIS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN PEDRO DE MACORIS') AND "normalizedName" = 'SAN PEDRO DE MACORIS'), 'Centro', 'CENTRO', 18.4539, -69.3086, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN PEDRO DE MACORIS'), 'Consuelo', 'CONSUELO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN PEDRO DE MACORIS'), 'Guayacanes', 'GUAYACANES', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN PEDRO DE MACORIS'), 'Quisqueya', 'QUISQUEYA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN PEDRO DE MACORIS'), 'Ramón Santana', 'RAMON SANTANA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN PEDRO DE MACORIS'), 'San José de los Llanos', 'SAN JOSE DE LOS LLANOS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Duarte', 'DUARTE', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE'), 'San Francisco de Macorís', 'SAN FRANCISCO DE MACORIS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE') AND "normalizedName" = 'SAN FRANCISCO DE MACORIS'), 'Centro', 'CENTRO', 19.301, -70.252, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE'), 'Arenoso', 'ARENOSO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE'), 'Castillo', 'CASTILLO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE'), 'Eugenio María de Hostos', 'EUGENIO MARIA DE HOSTOS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE'), 'Las Guáranas', 'LAS GUARANAS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE'), 'Pimentel', 'PIMENTEL', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DUARTE'), 'Villa Riva', 'VILLA RIVA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Espaillat', 'ESPAILLAT', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'ESPAILLAT'), 'Moca', 'MOCA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'ESPAILLAT') AND "normalizedName" = 'MOCA'), 'Centro', 'CENTRO', 19.394, -70.523, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'ESPAILLAT'), 'Cayetano Germosén', 'CAYETANO GERMOSEN', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'ESPAILLAT'), 'Gaspar Hernández', 'GASPAR HERNANDEZ', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'ESPAILLAT'), 'Jamao al Norte', 'JAMAO AL NORTE', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'ESPAILLAT'), 'San Víctor', 'SAN VICTOR', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Samaná', 'SAMANA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAMANA'), 'Santa Bárbara de Samaná', 'SANTA BARBARA DE SAMANA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAMANA') AND "normalizedName" = 'SANTA BARBARA DE SAMANA'), 'Centro', 'CENTRO', 19.207, -69.336, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAMANA'), 'Las Terrenas', 'LAS TERRENAS', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAMANA') AND "normalizedName" = 'LAS TERRENAS'), 'Pueblo de los Pescadores', 'PUEBLO DE LOS PESCADORES', 19.317, -69.543, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAMANA'), 'Sánchez', 'SANCHEZ', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Azua', 'AZUA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'AZUA'), 'Azua de Compostela', 'AZUA DE COMPOSTELA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'AZUA') AND "normalizedName" = 'AZUA DE COMPOSTELA'), 'Centro', 'CENTRO', 18.4531, -70.7344, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Baoruco', 'BAORUCO', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'BAORUCO'), 'Neiba', 'NEIBA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Barahona', 'BARAHONA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'BARAHONA'), 'Santa Cruz de Barahona', 'SANTA CRUZ DE BARAHONA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'BARAHONA') AND "normalizedName" = 'SANTA CRUZ DE BARAHONA'), 'Centro', 'CENTRO', 18.2086, -71.0992, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Dajabón', 'DAJABON', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'DAJABON'), 'Dajabón', 'DAJABON', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'El Seibo', 'EL SEIBO', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'EL SEIBO'), 'Santa Cruz de El Seibo', 'SANTA CRUZ DE EL SEIBO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'EL SEIBO') AND "normalizedName" = 'SANTA CRUZ DE EL SEIBO'), 'Centro', 'CENTRO', 18.7657, -69.0358, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Elías Piña', 'ELIAS PINA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'ELIAS PINA'), 'Comendador', 'COMENDADOR', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Hato Mayor', 'HATO MAYOR', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'HATO MAYOR'), 'Hato Mayor del Rey', 'HATO MAYOR DEL REY', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'HATO MAYOR') AND "normalizedName" = 'HATO MAYOR DEL REY'), 'Centro', 'CENTRO', 18.7638, -69.2563, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Hermanas Mirabal', 'HERMANAS MIRABAL', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'HERMANAS MIRABAL'), 'Salcedo', 'SALCEDO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Independencia', 'INDEPENDENCIA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'INDEPENDENCIA'), 'Jimaní', 'JIMANI', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'María Trinidad Sánchez', 'MARIA TRINIDAD SANCHEZ', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'MARIA TRINIDAD SANCHEZ'), 'Nagua', 'NAGUA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'MARIA TRINIDAD SANCHEZ') AND "normalizedName" = 'NAGUA'), 'Centro', 'CENTRO', 19.3796, -69.8476, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Monseñor Nouel', 'MONSENOR NOUEL', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'MONSENOR NOUEL'), 'Bonao', 'BONAO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'MONSENOR NOUEL') AND "normalizedName" = 'BONAO'), 'Centro', 'CENTRO', 18.9368, -70.4093, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Monte Cristi', 'MONTE CRISTI', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'MONTE CRISTI'), 'San Fernando de Monte Cristi', 'SAN FERNANDO DE MONTE CRISTI', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'MONTE CRISTI') AND "normalizedName" = 'SAN FERNANDO DE MONTE CRISTI'), 'Centro', 'CENTRO', 19.8487, -71.6457, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Monte Plata', 'MONTE PLATA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'MONTE PLATA'), 'Monte Plata', 'MONTE PLATA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Pedernales', 'PEDERNALES', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PEDERNALES'), 'Pedernales', 'PEDERNALES', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Peravia', 'PERAVIA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PERAVIA'), 'Baní', 'BANI', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'PERAVIA') AND "normalizedName" = 'BANI'), 'Centro', 'CENTRO', 18.2796, -70.3316, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'San José de Ocoa', 'SAN JOSE DE OCOA', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN JOSE DE OCOA'), 'San José de Ocoa', 'SAN JOSE DE OCOA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'San Juan', 'SAN JUAN', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN JUAN'), 'San Juan de la Maguana', 'SAN JUAN DE LA MAGUANA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SAN JUAN') AND "normalizedName" = 'SAN JUAN DE LA MAGUANA'), 'Centro', 'CENTRO', 18.8063, -71.2308, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Sánchez Ramírez', 'SANCHEZ RAMIREZ', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANCHEZ RAMIREZ'), 'Cotuí', 'COTUI', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANCHEZ RAMIREZ') AND "normalizedName" = 'COTUI'), 'Centro', 'CENTRO', 19.0567, -70.1498, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Santiago Rodríguez', 'SANTIAGO RODRIGUEZ', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'SANTIAGO RODRIGUEZ'), 'San Ignacio de Sabaneta', 'SAN IGNACIO DE SABANETA', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_regions (id, "countryId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO'), 'Valverde', 'VALVERDE', true)
ON CONFLICT ("countryId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_cities (id, "regionId", name, "normalizedName", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'VALVERDE'), 'Santa Cruz de Mao', 'SANTA CRUZ DE MAO', true)
ON CONFLICT ("regionId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, "isOperative" = true;
INSERT INTO public.geo_sectors (id, "cityId", name, "normalizedName", latitud, longitud, "isVerified", "isOperative")
VALUES (gen_random_uuid()::text, (SELECT id FROM public.geo_cities WHERE "regionId" = (SELECT id FROM public.geo_regions WHERE "countryId" = (SELECT id FROM public.geo_countries WHERE "isoCode" = 'DO') AND "normalizedName" = 'VALVERDE') AND "normalizedName" = 'SANTA CRUZ DE MAO'), 'Centro', 'CENTRO', 19.5767, -71.0779, true, true)
ON CONFLICT ("cityId", "normalizedName") DO UPDATE SET name = EXCLUDED.name, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, "isVerified" = true, "isOperative" = true;



-- ── Comprobación final ──────────────────────────────────────────────────────
SELECT (SELECT count(*) FROM public.geo_countries WHERE "isOperative") AS paises,
       (SELECT count(*) FROM public.geo_regions   WHERE "isOperative") AS provincias,
       (SELECT count(*) FROM public.geo_cities    WHERE "isOperative") AS ciudades,
       (SELECT count(*) FROM public.geo_sectors   WHERE "isOperative") AS sectores,
       CASE WHEN to_regclass('public.customer_locations')     IS NOT NULL
             AND to_regclass('public.campanas_dirigidas')     IS NOT NULL
             AND to_regclass('public.location_search_events') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS tablas;
