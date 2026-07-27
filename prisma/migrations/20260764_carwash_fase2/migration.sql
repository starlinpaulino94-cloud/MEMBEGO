-- App Car Wash · Fase 2 — cuentas corporativas, comisiones e incidencias.
--
-- TODO ES ADITIVO: tablas nuevas y dos columnas nuevas en `servicios`. Nada se
-- renombra, nada se borra, ningún valor por defecto cambia. Si esta migración
-- no se corre, la app sigue funcionando igual que hoy: los módulos nuevos nacen
-- apagados y sus consultas devuelven vacío en vez de reventar.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente (IF NOT EXISTS).

-- ── Comisión por servicio ───────────────────────────────────────────────────
-- Nulo = ese servicio no paga comisión. Es lo que permite encender el módulo
-- sin que empiece a devengar dinero por sorpresa: hay que llenar las tarifas.
ALTER TABLE "servicios" ADD COLUMN IF NOT EXISTS "comisionPorcentaje" DECIMAL(5,2);
ALTER TABLE "servicios" ADD COLUMN IF NOT EXISTS "comisionMonto"      DECIMAL(10,2);

-- ── Cuentas corporativas (flotillas) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cuentas_corporativas" (
  "id"            TEXT PRIMARY KEY,
  "companyId"     TEXT NOT NULL,
  "nombre"        TEXT NOT NULL,
  "rnc"           TEXT,
  "contacto"      TEXT,
  "telefono"      TEXT,
  "email"         TEXT,
  "limiteCredito" DECIMAL(12,2),
  "diasCredito"   INTEGER NOT NULL DEFAULT 30,
  "notas"         TEXT,
  "activa"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "cuentas_corporativas_companyId_nombre_key"
  ON "cuentas_corporativas" ("companyId", "nombre");
CREATE INDEX IF NOT EXISTS "cuentas_corporativas_companyId_activa_idx"
  ON "cuentas_corporativas" ("companyId", "activa");

-- ── Vehículos autorizados de cada flota ────────────────────────────────────
-- La llave es la PLACA porque es lo único que el encargado tiene delante
-- cuando llega el chofer. `vehiculoId` enlaza la ficha si existe, pero no es
-- obligatorio: exigirlo convertiría cada visita de flota en un alta.
CREATE TABLE IF NOT EXISTS "cuenta_vehiculos" (
  "id"         TEXT PRIMARY KEY,
  "cuentaId"   TEXT NOT NULL,
  "placa"      TEXT NOT NULL,
  "alias"      TEXT,
  "vehiculoId" TEXT,
  "activo"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "cuenta_vehiculos_cuentaId_placa_key"
  ON "cuenta_vehiculos" ("cuentaId", "placa");
CREATE INDEX IF NOT EXISTS "cuenta_vehiculos_placa_idx"
  ON "cuenta_vehiculos" ("placa");

-- ── Cargos a la cuenta ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cargos_cuenta" (
  "id"          TEXT PRIMARY KEY,
  "cuentaId"    TEXT NOT NULL,
  "colaId"      TEXT,
  "placa"       TEXT,
  "concepto"    TEXT NOT NULL,
  "monto"       DECIMAL(12,2) NOT NULL,
  "estado"      TEXT NOT NULL DEFAULT 'PENDIENTE',
  "corteRef"    TEXT,
  "facturadoAt" TIMESTAMP(3),
  "pagadoAt"    TIMESTAMP(3),
  "notas"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "cargos_cuenta_cuentaId_estado_createdAt_idx"
  ON "cargos_cuenta" ("cuentaId", "estado", "createdAt");
CREATE INDEX IF NOT EXISTS "cargos_cuenta_corteRef_idx" ON "cargos_cuenta" ("corteRef");
CREATE INDEX IF NOT EXISTS "cargos_cuenta_colaId_idx"   ON "cargos_cuenta" ("colaId");

-- ── Comisiones devengadas ──────────────────────────────────────────────────
-- El UNIQUE (colaId, userId) es el seguro contra el doble pago: entregar dos
-- veces el mismo vehículo no puede devengar dos comisiones.
CREATE TABLE IF NOT EXISTS "comisiones" (
  "id"        TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "colaId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "base"      DECIMAL(12,2) NOT NULL,
  "monto"     DECIMAL(12,2) NOT NULL,
  "detalle"   TEXT,
  "estado"    TEXT NOT NULL DEFAULT 'PENDIENTE',
  "loteRef"   TEXT,
  "pagadaAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "comisiones_colaId_userId_key"
  ON "comisiones" ("colaId", "userId");
CREATE INDEX IF NOT EXISTS "comisiones_companyId_estado_createdAt_idx"
  ON "comisiones" ("companyId", "estado", "createdAt");
CREATE INDEX IF NOT EXISTS "comisiones_userId_estado_idx"
  ON "comisiones" ("userId", "estado");

-- ── Incidencias y rewash ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "incidencias" (
  "id"             TEXT PRIMARY KEY,
  "companyId"      TEXT NOT NULL,
  "colaId"         TEXT,
  "rewashColaId"   TEXT,
  "clienteId"      TEXT,
  "vehiculoId"     TEXT,
  "placa"          TEXT,
  "tipo"           TEXT NOT NULL,
  "gravedad"       TEXT NOT NULL DEFAULT 'MEDIA',
  "descripcion"    TEXT NOT NULL,
  "costo"          DECIMAL(12,2),
  "estado"         TEXT NOT NULL DEFAULT 'ABIERTA',
  "resolucion"     TEXT,
  "resueltaAt"     TIMESTAMP(3),
  "reportadaPorId" TEXT,
  "responsableId"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "incidencias_companyId_estado_createdAt_idx"
  ON "incidencias" ("companyId", "estado", "createdAt");
CREATE INDEX IF NOT EXISTS "incidencias_companyId_tipo_createdAt_idx"
  ON "incidencias" ("companyId", "tipo", "createdAt");
CREATE INDEX IF NOT EXISTS "incidencias_colaId_idx" ON "incidencias" ("colaId");

-- ── Llaves foráneas ────────────────────────────────────────────────────────
-- En bloques DO porque ADD CONSTRAINT no acepta IF NOT EXISTS: así la
-- migración se puede volver a correr sin error.
DO $$ BEGIN
  ALTER TABLE "cuentas_corporativas"
    ADD CONSTRAINT "cuentas_corporativas_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cuenta_vehiculos"
    ADD CONSTRAINT "cuenta_vehiculos_cuentaId_fkey"
    FOREIGN KEY ("cuentaId") REFERENCES "cuentas_corporativas"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cuenta_vehiculos"
    ADD CONSTRAINT "cuenta_vehiculos_vehiculoId_fkey"
    FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cargos_cuenta"
    ADD CONSTRAINT "cargos_cuenta_cuentaId_fkey"
    FOREIGN KEY ("cuentaId") REFERENCES "cuentas_corporativas"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "cargos_cuenta"
    ADD CONSTRAINT "cargos_cuenta_colaId_fkey"
    FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "comisiones"
    ADD CONSTRAINT "comisiones_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "comisiones"
    ADD CONSTRAINT "comisiones_colaId_fkey"
    FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "comisiones"
    ADD CONSTRAINT "comisiones_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "incidencias"
    ADD CONSTRAINT "incidencias_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "incidencias"
    ADD CONSTRAINT "incidencias_colaId_fkey"
    FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "incidencias"
    ADD CONSTRAINT "incidencias_rewashColaId_fkey"
    FOREIGN KEY ("rewashColaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "incidencias"
    ADD CONSTRAINT "incidencias_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "incidencias"
    ADD CONSTRAINT "incidencias_vehiculoId_fkey"
    FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "incidencias"
    ADD CONSTRAINT "incidencias_reportadaPorId_fkey"
    FOREIGN KEY ("reportadaPorId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "incidencias"
    ADD CONSTRAINT "incidencias_responsableId_fkey"
    FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Verificación: las cinco filas deben decir true ─────────────────────────
SELECT 'servicios.comisionPorcentaje' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'servicios' AND column_name = 'comisionPorcentaje') AS ok
UNION ALL SELECT 'cuentas_corporativas', to_regclass('public.cuentas_corporativas') IS NOT NULL
UNION ALL SELECT 'cuenta_vehiculos',     to_regclass('public.cuenta_vehiculos')     IS NOT NULL
UNION ALL SELECT 'cargos_cuenta',        to_regclass('public.cargos_cuenta')        IS NOT NULL
UNION ALL SELECT 'comisiones',           to_regclass('public.comisiones')           IS NOT NULL
UNION ALL SELECT 'incidencias',          to_regclass('public.incidencias')          IS NOT NULL;
