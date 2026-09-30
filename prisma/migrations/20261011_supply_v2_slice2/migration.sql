-- ============================================================================
-- MEMBEGO SUPPLY 2.0 · VERTICAL SLICE 2 — ASIGNACIÓN · OFERTA · CHECKOUT · PAGO · DERECHO
-- ============================================================================
--
-- Solo CREA: siete tablas `supply_v2_*` (asignaciones y sus líneas por lote,
-- ofertas, órdenes de cliente y sus líneas, reservas por lote, derechos), sus
-- enums, cuatro tipos de referencia del ledger, dieciséis acciones de bitácora
-- y un índice por vencimiento en los lotes (FEFO). Ni un ALTER sobre columnas
-- vivas, ni un DROP. La migración del Slice 1 no se toca.
--
-- IDEMPOTENTE: IF NOT EXISTS o bloques que tragan `duplicate_object`.
--
-- Al final, los CHECK: contadores de asignación y de línea nunca negativos y
-- nunca por encima de lo asignado; precios y totales no negativos; precio
-- Membego ≤ precio público; un derecho es una unidad.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2AllocationPurpose" AS ENUM ('OFFER', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2AllocationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXHAUSTED', 'CANCELLED', 'ENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2OfferSource" AS ENUM ('PREPURCHASED_SUPPLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2OfferStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'SOLD_OUT', 'ENDED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2CustomerOrderStatus" AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2PaymentStatus" AS ENUM ('UNPAID', 'SUBMITTED', 'CONFIRMED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2PaymentMethod" AS ENUM ('TRANSFER', 'DEPOSIT', 'CASH', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'ISSUED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2EntitlementOrigin" AS ENUM ('PURCHASE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2EntitlementStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ALLOCATION_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ALLOCATION_RELEASED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OFFER_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OFFER_PUBLISHED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OFFER_PAUSED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OFFER_RESUMED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OFFER_ENDED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OFFER_CANCELLED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ORDER_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ORDER_RESERVED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ORDER_PAYMENT_SUBMITTED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ORDER_CANCELLED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ORDER_EXPIRED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ORDER_PAID';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ORDER_PAYMENT_REJECTED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ENTITLEMENT_ISSUED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupplyV2ReferenceType" ADD VALUE IF NOT EXISTS 'ALLOCATION';
ALTER TYPE "SupplyV2ReferenceType" ADD VALUE IF NOT EXISTS 'CUSTOMER_ORDER';
ALTER TYPE "SupplyV2ReferenceType" ADD VALUE IF NOT EXISTS 'ENTITLEMENT';
ALTER TYPE "SupplyV2ReferenceType" ADD VALUE IF NOT EXISTS 'OFFER';

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_allocations" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "purpose" "SupplyV2AllocationPurpose" NOT NULL DEFAULT 'OFFER',
    "quantity" INTEGER NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "issuedQuantity" INTEGER NOT NULL DEFAULT 0,
    "releasedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplyV2AllocationStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_allocation_lines" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "issuedQuantity" INTEGER NOT NULL DEFAULT 0,
    "releasedQuantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "supply_v2_allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_offers" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "allocationId" TEXT,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "SupplyV2OfferSource" NOT NULL DEFAULT 'PREPURCHASED_SUPPLY',
    "publicPrice" DECIMAL(12,2) NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "quantityLimit" INTEGER NOT NULL,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "SupplyV2OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "imagePath" TEXT,
    "createdById" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_customer_orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "SupplyV2CustomerOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentStatus" "SupplyV2PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" "SupplyV2PaymentMethod",
    "paymentReference" TEXT,
    "paymentAccountId" TEXT,
    "paymentAccountSnapshot" JSONB,
    "paymentSubmittedAt" TIMESTAMP(3),
    "paymentConfirmedById" TEXT,
    "paymentAmountSeen" DECIMAL(14,2),
    "paymentRejectedReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "supply_v2_customer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_customer_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "publicUnitPrice" DECIMAL(12,2) NOT NULL,
    "saleUnitPrice" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "supply_v2_customer_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_order_reservations" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "allocationLineId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "SupplyV2ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),

    CONSTRAINT "supply_v2_order_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_entitlements" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "allocationLineId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "origin" "SupplyV2EntitlementOrigin" NOT NULL DEFAULT 'PURCHASE',
    "actualUnitCost" DECIMAL(12,2) NOT NULL,
    "customerUnitPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "status" "SupplyV2EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_allocations_catalogItemId_status_idx" ON "supply_v2_allocations"("catalogItemId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_allocation_lines_lotId_idx" ON "supply_v2_allocation_lines"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_allocation_lines_allocationId_lotId_key" ON "supply_v2_allocation_lines"("allocationId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_offers_allocationId_key" ON "supply_v2_offers"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_offers_code_key" ON "supply_v2_offers"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_offers_slug_key" ON "supply_v2_offers"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_offers_status_startsAt_endsAt_idx" ON "supply_v2_offers"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_offers_catalogItemId_idx" ON "supply_v2_offers"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_customer_orders_number_key" ON "supply_v2_customer_orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_customer_orders_idempotencyKey_key" ON "supply_v2_customer_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_orders_customerId_status_idx" ON "supply_v2_customer_orders"("customerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_orders_status_expiresAt_idx" ON "supply_v2_customer_orders"("status", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_orders_paymentStatus_status_idx" ON "supply_v2_customer_orders"("paymentStatus", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_order_lines_orderId_idx" ON "supply_v2_customer_order_lines"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_order_lines_offerId_idx" ON "supply_v2_customer_order_lines"("offerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_order_reservations_orderLineId_idx" ON "supply_v2_order_reservations"("orderLineId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_order_reservations_allocationLineId_status_idx" ON "supply_v2_order_reservations"("allocationLineId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_entitlements_customerId_status_idx" ON "supply_v2_entitlements"("customerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_entitlements_offerId_idx" ON "supply_v2_entitlements"("offerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_entitlements_lotId_idx" ON "supply_v2_entitlements"("lotId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_lots_expiresAt_idx" ON "supply_v2_lots"("expiresAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_allocations" ADD CONSTRAINT "supply_v2_allocations_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_allocations" ADD CONSTRAINT "supply_v2_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_allocation_lines" ADD CONSTRAINT "supply_v2_allocation_lines_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "supply_v2_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_allocation_lines" ADD CONSTRAINT "supply_v2_allocation_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "supply_v2_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "supply_v2_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_paymentConfirmedById_fkey" FOREIGN KEY ("paymentConfirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_order_lines" ADD CONSTRAINT "supply_v2_customer_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_order_lines" ADD CONSTRAINT "supply_v2_customer_order_lines_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_order_reservations" ADD CONSTRAINT "supply_v2_order_reservations_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "supply_v2_customer_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_order_reservations" ADD CONSTRAINT "supply_v2_order_reservations_allocationLineId_fkey" FOREIGN KEY ("allocationLineId") REFERENCES "supply_v2_allocation_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_order_reservations" ADD CONSTRAINT "supply_v2_order_reservations_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "supply_v2_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "supply_v2_customer_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "supply_v2_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_allocationLineId_fkey" FOREIGN KEY ("allocationLineId") REFERENCES "supply_v2_allocation_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "supply_v2_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- INVARIANTES EN LA BASE (Slice 2)
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE "supply_v2_allocations" ADD CONSTRAINT "supply_v2_allocations_counters"
      CHECK ("quantity" > 0 AND "allocatedQuantity" >= 0 AND "reservedQuantity" >= 0
         AND "issuedQuantity" >= 0 AND "releasedQuantity" >= 0
         AND "reservedQuantity" + "issuedQuantity" + "releasedQuantity" <= "allocatedQuantity");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_allocation_lines" ADD CONSTRAINT "supply_v2_allocation_lines_counters"
      CHECK ("quantity" > 0 AND "reservedQuantity" >= 0 AND "issuedQuantity" >= 0 AND "releasedQuantity" >= 0
         AND "reservedQuantity" + "issuedQuantity" + "releasedQuantity" <= "quantity");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_prices"
      CHECK ("publicPrice" >= 0 AND "salePrice" >= 0 AND "salePrice" <= "publicPrice"
         AND "quantityLimit" > 0 AND "perCustomerLimit" > 0
         AND ("endsAt" IS NULL OR "endsAt" > "startsAt"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_amounts"
      CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0 AND "total" = "subtotal" - "discount");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_order_lines" ADD CONSTRAINT "supply_v2_customer_order_lines_amounts"
      CHECK ("quantity" > 0 AND "publicUnitPrice" >= 0 AND "saleUnitPrice" >= 0
         AND "subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_order_reservations" ADD CONSTRAINT "supply_v2_order_reservations_quantity"
      CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_unit"
      CHECK ("quantity" = 1 AND "actualUnitCost" >= 0 AND "customerUnitPrice" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
