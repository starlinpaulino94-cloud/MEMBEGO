-- E5 · App Car Wash: cola de vehículos, inventario y evidencia fotográfica.
-- Idempotente: se puede correr varias veces sin daño. Los "estados"/"tipos"
-- son TEXT validados en código (src/modules/carwash/*), sin enums de BD.

-- ── Cola de vehículos (pista) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cola_vehiculos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "clienteId" TEXT,
    "vehiculoId" TEXT,
    "placa" TEXT,
    "descripcion" TEXT,
    "servicio" TEXT,
    "notaInterna" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'EN_ESPERA',
    "inicioAt" TIMESTAMP(3),
    "listoAt" TIMESTAMP(3),
    "entregadoAt" TIMESTAMP(3),
    "registradaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cola_vehiculos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "cola_vehiculos_companyId_estado_createdAt_idx"
    ON "cola_vehiculos"("companyId", "estado", "createdAt");

-- ── Inventario: productos y movimientos ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "productos_inventario" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT,
    "unidad" TEXT NOT NULL DEFAULT 'unidad',
    "stock" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stockMinimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "costo" DECIMAL(12,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "productos_inventario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "productos_inventario_companyId_activo_idx"
    ON "productos_inventario"("companyId", "activo");

CREATE TABLE IF NOT EXISTS "movimientos_inventario" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "stockResultante" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "registradoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "movimientos_inventario_productoId_createdAt_idx"
    ON "movimientos_inventario"("productoId", "createdAt");
CREATE INDEX IF NOT EXISTS "movimientos_inventario_companyId_createdAt_idx"
    ON "movimientos_inventario"("companyId", "createdAt");

-- ── Evidencia fotográfica (antes/después) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "evidencias_foto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "colaId" TEXT,
    "clienteId" TEXT,
    "vehiculoId" TEXT,
    "placa" TEXT,
    "momento" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "nota" TEXT,
    "subidaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidencias_foto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "evidencias_foto_companyId_createdAt_idx"
    ON "evidencias_foto"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "evidencias_foto_colaId_idx"
    ON "evidencias_foto"("colaId");

-- ── Llaves foráneas (idempotentes vía duplicate_object) ─────────────────────
DO $$ BEGIN
    ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_sucursalId_fkey"
        FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_clienteId_fkey"
        FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_vehiculoId_fkey"
        FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "cola_vehiculos" ADD CONSTRAINT "cola_vehiculos_registradaPorId_fkey"
        FOREIGN KEY ("registradaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "productos_inventario" ADD CONSTRAINT "productos_inventario_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_productoId_fkey"
        FOREIGN KEY ("productoId") REFERENCES "productos_inventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_registradoPorId_fkey"
        FOREIGN KEY ("registradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_colaId_fkey"
        FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_clienteId_fkey"
        FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_vehiculoId_fkey"
        FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "evidencias_foto" ADD CONSTRAINT "evidencias_foto_subidaPorId_fkey"
        FOREIGN KEY ("subidaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
