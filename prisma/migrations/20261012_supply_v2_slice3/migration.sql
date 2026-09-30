-- ============================================================================
-- MEMBEGO SUPPLY 2.0 · VERTICAL SLICE 3 — VOUCHER · QR TEMPORAL · REDENCIÓN · REVERSA
-- ============================================================================
--
-- Solo CREA: cuatro tablas `supply_v2_*` (vouchers, sesiones QR, redenciones,
-- incidencias), tres enums, un valor nuevo en el estado del derecho
-- (REDEEMED), un tipo de referencia del ledger (REDEMPTION) y doce acciones
-- de bitácora. Ni un ALTER sobre columnas vivas, ni un DROP. Las migraciones
-- de los Slices 1 y 2 no se tocan.
--
-- IDEMPOTENTE: IF NOT EXISTS o bloques que tragan `duplicate_object`.
--
-- Al final, lo que Prisma no modela y sí importa:
--   · dos índices únicos PARCIALES: un solo voucher ACTIVE por derecho y una
--     sola redención viva (no reversada) por derecho — la barrera real contra
--     la doble entrega, además de los candados de fila;
--   · CHECK: una redención es una unidad con snapshots no negativos y una
--     reversa lleva motivo; una sesión QR vence después de crearse; un voucher
--     no vence antes de empezar.
-- ============================================================================


-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2VoucherStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2RedemptionChannel" AS ENUM ('QR_SCAN', 'MANUAL_CODE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2IncidentType" AS ENUM ('INVALID_QR', 'PRODUCT_UNAVAILABLE', 'WRONG_CUSTOMER', 'WRONG_BRANCH', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_VOUCHER_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_VOUCHER_REISSUED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_VOUCHER_EXPIRED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_QR_SESSION_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_QR_SESSION_EXPIRED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_QR_SESSION_CONSUMED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_REDEMPTION_PREVIEWED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_REDEMPTION_CONFIRMED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_REDEMPTION_REJECTED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_REDEMPTION_REVERSED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_REDEMPTION_INCIDENT';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ENTITLEMENT_EXPIRED';

-- AlterEnum
ALTER TYPE "SupplyV2EntitlementStatus" ADD VALUE IF NOT EXISTS 'REDEEMED';

-- AlterEnum
ALTER TYPE "SupplyV2ReferenceType" ADD VALUE IF NOT EXISTS 'REDEMPTION';

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_vouchers" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "SupplyV2VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_qr_sessions" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT,
    "openedByCustomerId" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedByUserId" TEXT,
    "consumedDeviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_qr_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_redemptions" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "qrSessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCostSnapshot" DECIMAL(12,2) NOT NULL,
    "customerUnitPriceSnapshot" DECIMAL(12,2) NOT NULL,
    "customerPaysMerchant" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "channel" "SupplyV2RedemptionChannel" NOT NULL DEFAULT 'QR_SCAN',
    "deviceInfo" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_redemption_incidents" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT NOT NULL,
    "qrSessionId" TEXT,
    "codeSeen" TEXT,
    "type" "SupplyV2IncidentType" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_redemption_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_vouchers_code_key" ON "supply_v2_vouchers"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_vouchers_entitlementId_status_idx" ON "supply_v2_vouchers"("entitlementId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_vouchers_customerId_status_idx" ON "supply_v2_vouchers"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_qr_sessions_nonce_key" ON "supply_v2_qr_sessions"("nonce");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_qr_sessions_voucherId_createdAt_idx" ON "supply_v2_qr_sessions"("voucherId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_qr_sessions_expiresAt_idx" ON "supply_v2_qr_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_redemptions_number_key" ON "supply_v2_redemptions"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_redemptions_qrSessionId_key" ON "supply_v2_redemptions"("qrSessionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_redemptions_idempotencyKey_key" ON "supply_v2_redemptions"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_redemptions_supplierId_redeemedAt_idx" ON "supply_v2_redemptions"("supplierId", "redeemedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_redemptions_entitlementId_idx" ON "supply_v2_redemptions"("entitlementId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_redemptions_customerId_idx" ON "supply_v2_redemptions"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_redemptions_branchId_idx" ON "supply_v2_redemptions"("branchId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_redemption_incidents_supplierId_createdAt_idx" ON "supply_v2_redemption_incidents"("supplierId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_vouchers" ADD CONSTRAINT "supply_v2_vouchers_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "supply_v2_entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_vouchers" ADD CONSTRAINT "supply_v2_vouchers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_vouchers" ADD CONSTRAINT "supply_v2_vouchers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_vouchers" ADD CONSTRAINT "supply_v2_vouchers_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_qr_sessions" ADD CONSTRAINT "supply_v2_qr_sessions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "supply_v2_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_qr_sessions" ADD CONSTRAINT "supply_v2_qr_sessions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_qr_sessions" ADD CONSTRAINT "supply_v2_qr_sessions_openedByCustomerId_fkey" FOREIGN KEY ("openedByCustomerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_qr_sessions" ADD CONSTRAINT "supply_v2_qr_sessions_consumedByUserId_fkey" FOREIGN KEY ("consumedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "supply_v2_entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "supply_v2_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_qrSessionId_fkey" FOREIGN KEY ("qrSessionId") REFERENCES "supply_v2_qr_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "supply_v2_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemption_incidents" ADD CONSTRAINT "supply_v2_redemption_incidents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemption_incidents" ADD CONSTRAINT "supply_v2_redemption_incidents_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "sucursales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemption_incidents" ADD CONSTRAINT "supply_v2_redemption_incidents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemption_incidents" ADD CONSTRAINT "supply_v2_redemption_incidents_qrSessionId_fkey" FOREIGN KEY ("qrSessionId") REFERENCES "supply_v2_qr_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── Barreras que Prisma no modela ────────────────────────────────────────────

-- Un solo voucher ACTIVE por derecho (§6).
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_vouchers_entitlement_activo"
  ON "supply_v2_vouchers" ("entitlementId") WHERE "status" = 'ACTIVE';

-- Una sola redención viva por derecho (§24): la segunda confirmación choca aquí
-- aunque los candados fallaran.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_redemptions_entitlement_viva"
  ON "supply_v2_redemptions" ("entitlementId") WHERE "reversedAt" IS NULL;

DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_unit"
      CHECK ("quantity" = 1 AND "unitCostSnapshot" >= 0 AND "customerUnitPriceSnapshot" >= 0 AND "customerPaysMerchant" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_reversal"
      CHECK (("reversedAt" IS NULL AND "reversalReason" IS NULL AND "reversedById" IS NULL)
          OR ("reversedAt" IS NOT NULL AND "reversalReason" IS NOT NULL AND "reversedById" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_qr_sessions" ADD CONSTRAINT "supply_v2_qr_sessions_window"
      CHECK ("expiresAt" > "createdAt");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_vouchers" ADD CONSTRAINT "supply_v2_vouchers_window"
      CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
