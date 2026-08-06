-- Onboarding v2 · Fase 2: vehículos con identidad, niveles tarifarios y
-- precio de plan por categoría.
--
-- 100% ADITIVA (regla de compatibilidad): cada columna nueva es nullable o
-- lleva un default que reproduce el comportamiento actual, así que los
-- clientes, vehículos, planes y membresías EXISTENTES no cambian en nada:
--
--   · tipos_vehiculo.nivelTarifario = 1        → toda categoría existente cabe
--     en cualquier plan (la comparación es nivel <= tope).
--   · plans.nivelTarifarioMax = NULL           → los planes actuales aceptan
--     cualquier vehículo, como hoy.
--   · plans.maxVehiculos = 1                   → un vehículo, como hoy.
--   · vehiculos.placaNormalizada = NULL        → los vehículos históricos sin
--     placa siguen siendo válidos; el backfill corre aparte. SIN unique aún:
--     primero la auditoría de producción (npm run auditar:placas).
--   · plan_precios_categoria vacía             → cada plan cobra su `precio`
--     base, exactamente como hoy (fail-open).
--   · membresia_vehiculos vacía                → las membresías existentes
--     siguen valiendo sin vehículo; la asociación aplica a compras nuevas.
--
-- RLS: las dos tablas nuevas no llevan companyId (espejo de servicio_precios);
-- el script de aislamiento les deduce la política por la FK a plans/memberships
-- (Nivel 1). Idempotente: se puede correr varias veces sin efecto.

-- ── Categorías de vehículo: nivel tarifario y presentación ──────────────────
ALTER TABLE "tipos_vehiculo" ADD COLUMN IF NOT EXISTS "nivelTarifario" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tipos_vehiculo" ADD COLUMN IF NOT EXISTS "descripcion" TEXT;
ALTER TABLE "tipos_vehiculo" ADD COLUMN IF NOT EXISTS "iconoUrl" TEXT;

-- ── Vehículos: identidad técnica (pais + placa normalizada) y principal ─────
ALTER TABLE "vehiculos" ADD COLUMN IF NOT EXISTS "placaNormalizada" TEXT;
ALTER TABLE "vehiculos" ADD COLUMN IF NOT EXISTS "pais" TEXT NOT NULL DEFAULT 'DO';
ALTER TABLE "vehiculos" ADD COLUMN IF NOT EXISTS "esPrincipal" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "vehiculos_clienteId_esPrincipal_idx" ON "vehiculos"("clienteId", "esPrincipal");
CREATE INDEX IF NOT EXISTS "vehiculos_pais_placaNormalizada_idx" ON "vehiculos"("pais", "placaNormalizada");

-- ── Planes: reglas de vehículo (defaults = comportamiento actual) ───────────
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "nivelTarifarioMax" INTEGER;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "maxVehiculos" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "precioVehiculoExtra" DECIMAL(10,2);

-- ── Precio del plan por categoría de vehículo (§11 · espejo de servicio_precios)
CREATE TABLE IF NOT EXISTS "plan_precios_categoria" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tipoVehiculoId" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plan_precios_categoria_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "plan_precios_categoria_tipoVehiculoId_idx" ON "plan_precios_categoria"("tipoVehiculoId");
CREATE UNIQUE INDEX IF NOT EXISTS "plan_precios_categoria_planId_tipoVehiculoId_key" ON "plan_precios_categoria"("planId", "tipoVehiculoId");

DO $$ BEGIN ALTER TABLE "plan_precios_categoria" ADD CONSTRAINT "plan_precios_categoria_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "plan_precios_categoria" ADD CONSTRAINT "plan_precios_categoria_tipoVehiculoId_fkey"
  FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Vehículos de una membresía (§13) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "membresia_vehiculos" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "nivelTarifarioComprado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membresia_vehiculos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "membresia_vehiculos_vehiculoId_idx" ON "membresia_vehiculos"("vehiculoId");
CREATE UNIQUE INDEX IF NOT EXISTS "membresia_vehiculos_membershipId_vehiculoId_key" ON "membresia_vehiculos"("membershipId", "vehiculoId");

DO $$ BEGIN ALTER TABLE "membresia_vehiculos" ADD CONSTRAINT "membresia_vehiculos_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "membresia_vehiculos" ADD CONSTRAINT "membresia_vehiculos_vehiculoId_fkey"
  FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Centinela: confirma que los objetos quedaron creados.
SELECT 'onboarding_v2_vehiculos' AS objeto,
       CASE WHEN to_regclass('public.plan_precios_categoria') IS NOT NULL
             AND to_regclass('public.membresia_vehiculos') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
