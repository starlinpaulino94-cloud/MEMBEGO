-- App Car Wash · Fase 3 — proveedores y órdenes de compra, activos y
-- mantenimiento, turnos y asistencia.
--
-- ADITIVA: cuatro tablas nuevas, más dos columnas nuevas en tablas existentes
-- (`productos_inventario.proveedorId` y `movimientos_inventario.ordenCompraId`).
-- Nada se renombra ni se borra. Sin correr esta migración la app sigue igual:
-- los módulos nuevos nacen apagados y sus consultas devuelven vacío.
--
-- Ejecutar en el SQL Editor de Supabase. Idempotente (IF NOT EXISTS).

-- ── Columnas nuevas en tablas existentes ───────────────────────────────────
-- El proveedor habitual de un producto: solo SUGIERE al armar una orden.
ALTER TABLE "productos_inventario" ADD COLUMN IF NOT EXISTS "proveedorId" TEXT;
-- De qué orden de compra vino una entrada de stock. Responde "¿esta caja de
-- shampoo de dónde salió?" sin tener que buscar en papeles.
ALTER TABLE "movimientos_inventario" ADD COLUMN IF NOT EXISTS "ordenCompraId" TEXT;

-- ── Proveedores ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "proveedores" (
  "id"          TEXT PRIMARY KEY,
  "companyId"   TEXT NOT NULL,
  "nombre"      TEXT NOT NULL,
  "rnc"         TEXT,
  "contacto"    TEXT,
  "telefono"    TEXT,
  "email"       TEXT,
  "diasCredito" INTEGER NOT NULL DEFAULT 0,
  "notas"       TEXT,
  "activo"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "proveedores_companyId_nombre_key"
  ON "proveedores" ("companyId", "nombre");
CREATE INDEX IF NOT EXISTS "proveedores_companyId_activo_idx"
  ON "proveedores" ("companyId", "activo");

-- ── Órdenes de compra ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ordenes_compra" (
  "id"          TEXT PRIMARY KEY,
  "companyId"   TEXT NOT NULL,
  "proveedorId" TEXT NOT NULL,
  "numero"      TEXT NOT NULL,
  "estado"      TEXT NOT NULL DEFAULT 'BORRADOR',
  "total"       DECIMAL(12,2),
  "notas"       TEXT,
  "pedidaAt"    TIMESTAMP(3),
  "recibidaAt"  TIMESTAMP(3),
  "creadaPorId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- El número es único POR EMPRESA: dos negocios pueden tener su OC-000001.
CREATE UNIQUE INDEX IF NOT EXISTS "ordenes_compra_companyId_numero_key"
  ON "ordenes_compra" ("companyId", "numero");
CREATE INDEX IF NOT EXISTS "ordenes_compra_companyId_estado_createdAt_idx"
  ON "ordenes_compra" ("companyId", "estado", "createdAt");

CREATE TABLE IF NOT EXISTS "orden_compra_lineas" (
  "id"               TEXT PRIMARY KEY,
  "ordenId"          TEXT NOT NULL,
  "productoId"       TEXT NOT NULL,
  "nombre"           TEXT NOT NULL,
  "cantidad"         DECIMAL(12,2) NOT NULL,
  "cantidadRecibida" DECIMAL(12,2),
  "costoUnitario"    DECIMAL(12,2) NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "orden_compra_lineas_ordenId_idx"    ON "orden_compra_lineas" ("ordenId");
CREATE INDEX IF NOT EXISTS "orden_compra_lineas_productoId_idx" ON "orden_compra_lineas" ("productoId");

-- ── Activos y mantenimiento ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "activos" (
  "id"                   TEXT PRIMARY KEY,
  "companyId"            TEXT NOT NULL,
  "nombre"               TEXT NOT NULL,
  "categoria"            TEXT,
  "marca"                TEXT,
  "modelo"               TEXT,
  "serie"                TEXT,
  "ubicacion"            TEXT,
  "estado"               TEXT NOT NULL DEFAULT 'OPERATIVO',
  "fechaCompra"          TIMESTAMP(3),
  "costo"                DECIMAL(12,2),
  "frecuenciaDias"       INTEGER NOT NULL DEFAULT 0,
  "proximoMantenimiento" TIMESTAMP(3),
  "notas"                TEXT,
  "activo"               BOOLEAN NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "activos_companyId_activo_estado_idx"
  ON "activos" ("companyId", "activo", "estado");

CREATE TABLE IF NOT EXISTS "mantenimientos" (
  "id"          TEXT PRIMARY KEY,
  "activoId"    TEXT NOT NULL,
  "tipo"        TEXT NOT NULL,
  "descripcion" TEXT NOT NULL,
  "costo"       DECIMAL(12,2),
  "horasParado" DECIMAL(8,2),
  "realizadoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hechoPorId"  TEXT,
  "proveedor"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "mantenimientos_activoId_realizadoAt_idx"
  ON "mantenimientos" ("activoId", "realizadoAt");

-- ── Turnos ─────────────────────────────────────────────────────────────────
-- `salidaAt` NULL = turno abierto. Es el estado normal durante la jornada.
CREATE TABLE IF NOT EXISTS "turnos" (
  "id"           TEXT PRIMARY KEY,
  "companyId"    TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "entradaAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "salidaAt"     TIMESTAMP(3),
  "costoHora"    DECIMAL(10,2),
  "notas"        TEXT,
  "cerradoPorId" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "turnos_companyId_entradaAt_idx" ON "turnos" ("companyId", "entradaAt");
CREATE INDEX IF NOT EXISTS "turnos_userId_salidaAt_idx"     ON "turnos" ("userId", "salidaAt");

-- Un empleado no puede tener DOS turnos abiertos a la vez. El índice parcial es
-- lo que lo garantiza en la base de datos, no solo en el código: dos pestañas
-- marcando entrada al mismo tiempo no pueden abrir dos turnos.
CREATE UNIQUE INDEX IF NOT EXISTS "turnos_userId_abierto_key"
  ON "turnos" ("userId") WHERE "salidaAt" IS NULL;

-- ── Llaves foráneas ────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "proveedores"
    ADD CONSTRAINT "proveedores_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "productos_inventario"
    ADD CONSTRAINT "productos_inventario_proveedorId_fkey"
    FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_proveedorId_fkey"
    FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_creadaPorId_fkey"
    FOREIGN KEY ("creadaPorId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orden_compra_lineas"
    ADD CONSTRAINT "orden_compra_lineas_ordenId_fkey"
    FOREIGN KEY ("ordenId") REFERENCES "ordenes_compra"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "orden_compra_lineas"
    ADD CONSTRAINT "orden_compra_lineas_productoId_fkey"
    FOREIGN KEY ("productoId") REFERENCES "productos_inventario"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_ordenCompraId_fkey"
    FOREIGN KEY ("ordenCompraId") REFERENCES "ordenes_compra"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "activos"
    ADD CONSTRAINT "activos_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mantenimientos"
    ADD CONSTRAINT "mantenimientos_activoId_fkey"
    FOREIGN KEY ("activoId") REFERENCES "activos"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mantenimientos"
    ADD CONSTRAINT "mantenimientos_hechoPorId_fkey"
    FOREIGN KEY ("hechoPorId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "turnos"
    ADD CONSTRAINT "turnos_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "turnos"
    ADD CONSTRAINT "turnos_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "turnos"
    ADD CONSTRAINT "turnos_cerradoPorId_fkey"
    FOREIGN KEY ("cerradoPorId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Verificación: las seis filas deben decir true ──────────────────────────
SELECT 'proveedores' AS objeto, to_regclass('public.proveedores') IS NOT NULL AS ok
UNION ALL SELECT 'ordenes_compra',      to_regclass('public.ordenes_compra')      IS NOT NULL
UNION ALL SELECT 'orden_compra_lineas', to_regclass('public.orden_compra_lineas') IS NOT NULL
UNION ALL SELECT 'activos',             to_regclass('public.activos')             IS NOT NULL
UNION ALL SELECT 'mantenimientos',      to_regclass('public.mantenimientos')      IS NOT NULL
UNION ALL SELECT 'turnos',              to_regclass('public.turnos')              IS NOT NULL;
