-- App Car Wash · Fase 1: catálogo del oficio.
--   · tipos_vehiculo   → la dimensión que faltaba (por eso los planes se
--                        llamaban "PLAN SILVER (SUV PEQ)")
--   · servicios        → lo que el negocio vende suelto, no solo membresías
--   · servicio_precios → precio por servicio × tipo de vehículo
--   · bahias           → puestos de trabajo dentro de la sucursal
--   · cola_servicios   → qué se le está haciendo a cada vehículo en pista
-- Idempotente. Solo AGREGA (tablas nuevas + columnas nullable).

CREATE TABLE IF NOT EXISTS "tipos_vehiculo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tipos_vehiculo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tipos_vehiculo_companyId_nombre_key" ON "tipos_vehiculo"("companyId","nombre");
CREATE INDEX IF NOT EXISTS "tipos_vehiculo_companyId_activo_orden_idx" ON "tipos_vehiculo"("companyId","activo","orden");

CREATE TABLE IF NOT EXISTS "servicios" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "categoria" TEXT,
    "duracionMin" INTEGER NOT NULL DEFAULT 30,
    "esAdicional" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "servicios_companyId_nombre_key" ON "servicios"("companyId","nombre");
CREATE INDEX IF NOT EXISTS "servicios_companyId_activo_orden_idx" ON "servicios"("companyId","activo","orden");

CREATE TABLE IF NOT EXISTS "servicio_precios" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "tipoVehiculoId" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicio_precios_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "servicio_precios_servicioId_tipoVehiculoId_key" ON "servicio_precios"("servicioId","tipoVehiculoId");
CREATE INDEX IF NOT EXISTS "servicio_precios_tipoVehiculoId_idx" ON "servicio_precios"("tipoVehiculoId");

CREATE TABLE IF NOT EXISTS "bahias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bahias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bahias_companyId_nombre_key" ON "bahias"("companyId","nombre");
CREATE INDEX IF NOT EXISTS "bahias_companyId_activa_orden_idx" ON "bahias"("companyId","activa","orden");

CREATE TABLE IF NOT EXISTS "cola_servicios" (
    "id" TEXT NOT NULL,
    "colaId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cola_servicios_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cola_servicios_colaId_idx" ON "cola_servicios"("colaId");
CREATE INDEX IF NOT EXISTS "cola_servicios_servicioId_idx" ON "cola_servicios"("servicioId");

-- Columnas nuevas en tablas existentes (todas nullable).
ALTER TABLE "cola_vehiculos" ADD COLUMN IF NOT EXISTS "atendidoPorId" TEXT;
ALTER TABLE "cola_vehiculos" ADD COLUMN IF NOT EXISTS "bahiaId" TEXT;
ALTER TABLE "cola_vehiculos" ADD COLUMN IF NOT EXISTS "tipoVehiculoId" TEXT;
ALTER TABLE "vehiculos"      ADD COLUMN IF NOT EXISTS "tipoVehiculoId" TEXT;

DO $$ BEGIN ALTER TABLE "tipos_vehiculo" ADD CONSTRAINT "tipos_vehiculo_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "servicios" ADD CONSTRAINT "servicios_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "servicio_precios" ADD CONSTRAINT "servicio_precios_servicioId_fkey"
  FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "servicio_precios" ADD CONSTRAINT "servicio_precios_tipoVehiculoId_fkey"
  FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "bahias" ADD CONSTRAINT "bahias_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "bahias" ADD CONSTRAINT "bahias_sucursalId_fkey"
  FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "cola_servicios" ADD CONSTRAINT "cola_servicios_colaId_fkey"
  FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "cola_servicios" ADD CONSTRAINT "cola_servicios_servicioId_fkey"
  FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_atendidoPorId_fkey"
  FOREIGN KEY ("atendidoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_bahiaId_fkey"
  FOREIGN KEY ("bahiaId") REFERENCES "bahias"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_tipoVehiculoId_fkey"
  FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_tipoVehiculoId_fkey"
  FOREIGN KEY ("tipoVehiculoId") REFERENCES "tipos_vehiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "cola_vehiculos_bahiaId_idx" ON "cola_vehiculos"("bahiaId");

-- Verificación: las 5 filas deben decir OK.
SELECT 'tipos_vehiculo' AS objeto, CASE WHEN to_regclass('public.tipos_vehiculo') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL SELECT 'servicios', CASE WHEN to_regclass('public.servicios') IS NOT NULL THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'servicio_precios', CASE WHEN to_regclass('public.servicio_precios') IS NOT NULL THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'bahias', CASE WHEN to_regclass('public.bahias') IS NOT NULL THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'cola_servicios', CASE WHEN to_regclass('public.cola_servicios') IS NOT NULL THEN 'OK' ELSE 'FALTA' END;
