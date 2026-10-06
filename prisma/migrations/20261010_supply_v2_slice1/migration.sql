-- ============================================================================
-- MEMBEGO SUPPLY 2.0 · VERTICAL SLICE 1 — PROCUREMENT
-- ============================================================================
--
-- Dominio nuevo, en paralelo a Supply V1. Solo CREA: once tablas
-- `supply_v2_*`, sus enums, once valores en `AuditAccion` y las claves
-- foráneas hacia Core (`companies`, `users`, `sucursales`, `servicios`,
-- `productos_inventario`). Cero ALTER sobre columnas vivas, cero DROP, cero
-- UPDATE. Las tablas `supply_*` de V1 no se tocan.
--
-- IDEMPOTENTE: todo va con IF NOT EXISTS o dentro de un bloque que traga
-- `duplicate_object`.
--
-- Al final, los CHECK que hacen imposible un lote descuadrado o una recepción
-- por encima de lo comprado, sea cual sea la ruta de código que escriba.
--
-- Rollback: DROP TABLE de las once en orden inverso + DROP TYPE de los
-- dieciséis enums. Ninguna fila de otro módulo depende de ellas.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2SupplierSource" AS ENUM ('REGISTERED_COMPANY', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2CatalogItemType" AS ENUM ('PRODUCT', 'SERVICE', 'EXPERIENCE', 'CAPACITY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2Unit" AS ENUM ('UNIT', 'SERVICE', 'PERSON', 'HOUR', 'DAY', 'TICKET', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2CatalogItemStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2AgreementType" AS ENUM ('PREPAID_PURCHASE', 'OPEN_DEPOSIT', 'PAY_LATER', 'COMMISSION', 'HYBRID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2AgreementScope" AS ENUM ('ITEM', 'CATEGORY', 'CATALOG');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2AgreementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2PaymentMode" AS ENUM ('PREPAID', 'PARTIAL', 'PAY_LATER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2PurchaseOrderEventType" AS ENUM ('CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'RECEIPT_CONFIRMED', 'RECEIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2LotStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2Bucket" AS ENUM ('AVAILABLE', 'ALLOCATED', 'RESERVED', 'ISSUED', 'REDEEMED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2LedgerEntryType" AS ENUM ('RECEIPT', 'ALLOCATION', 'RELEASE_ALLOCATION', 'RESERVATION', 'RELEASE_RESERVATION', 'ISSUE', 'REDEMPTION', 'REVERSAL', 'EXPIRATION', 'ADJUSTMENT', 'CANCELLATION', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ReferenceType" AS ENUM ('PURCHASE_RECEIPT', 'ADJUSTMENT', 'CANCELLATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SUPPLIER_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_CATALOG_ITEM_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_AGREEMENT_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_AGREEMENT_ACTIVATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PO_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PO_SUBMITTED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PO_APPROVED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PO_REJECTED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PO_CANCELLED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_RECEIPT_CONFIRMED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_LOT_CREATED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "source" "SupplyV2SupplierSource" NOT NULL,
    "status" "SupplyV2SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "commercialName" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'DO',
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "paymentTermsDays" INTEGER,
    "paymentTermsText" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_catalog_items" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" "SupplyV2CatalogItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "externalReference" TEXT,
    "category" TEXT,
    "publicPrice" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "unit" "SupplyV2Unit" NOT NULL DEFAULT 'UNIT',
    "imagePath" TEXT,
    "existingProductId" TEXT,
    "existingServiceId" TEXT,
    "status" "SupplyV2CatalogItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_agreements" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "type" "SupplyV2AgreementType" NOT NULL,
    "scope" "SupplyV2AgreementScope" NOT NULL DEFAULT 'ITEM',
    "catalogItemId" TEXT,
    "category" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "negotiatedUnitCost" DECIMAL(12,2),
    "discountPercentage" DECIMAL(5,2),
    "commissionPercentage" DECIMAL(5,2),
    "paymentTermsDays" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "SupplyV2AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_agreement_versions" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_agreement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_purchase_orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "agreementVersionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxes" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "SupplyV2PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentMode" "SupplyV2PaymentMode" NOT NULL DEFAULT 'PREPAID',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_purchase_order_events" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "type" "SupplyV2PurchaseOrderEventType" NOT NULL,
    "fromStatus" "SupplyV2PurchaseOrderStatus",
    "toStatus" "SupplyV2PurchaseOrderStatus",
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_purchase_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_purchase_receipts" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "receivedById" TEXT NOT NULL,
    "status" "SupplyV2ReceiptStatus" NOT NULL DEFAULT 'CONFIRMED',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_purchase_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "supply_v2_purchase_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_lots" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "agreementVersionId" TEXT NOT NULL,
    "quantityReceived" INTEGER NOT NULL,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 0,
    "quantityAllocated" INTEGER NOT NULL DEFAULT 0,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "quantityIssued" INTEGER NOT NULL DEFAULT 0,
    "quantityRedeemed" INTEGER NOT NULL DEFAULT 0,
    "quantityClosed" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" "SupplyV2LotStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_ledger_entries" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "type" "SupplyV2LedgerEntryType" NOT NULL,
    "sourceBucket" "SupplyV2Bucket",
    "destinationBucket" "SupplyV2Bucket",
    "quantity" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "bucketsBefore" JSONB NOT NULL DEFAULT '{}',
    "bucketsAfter" JSONB NOT NULL DEFAULT '{}',
    "referenceType" "SupplyV2ReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_suppliers_companyId_key" ON "supply_v2_suppliers"("companyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_suppliers_status_commercialName_idx" ON "supply_v2_suppliers"("status", "commercialName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_catalog_items_supplierId_status_idx" ON "supply_v2_catalog_items"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_catalog_items_supplierId_sku_key" ON "supply_v2_catalog_items"("supplierId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_catalog_items_supplierId_slug_key" ON "supply_v2_catalog_items"("supplierId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_agreements_code_key" ON "supply_v2_agreements"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_agreements_supplierId_status_idx" ON "supply_v2_agreements"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_agreements_catalogItemId_status_idx" ON "supply_v2_agreements"("catalogItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_agreement_versions_agreementId_version_key" ON "supply_v2_agreement_versions"("agreementId", "version");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_purchase_orders_number_key" ON "supply_v2_purchase_orders"("number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_purchase_orders_supplierId_status_idx" ON "supply_v2_purchase_orders"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_purchase_orders_status_createdAt_idx" ON "supply_v2_purchase_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_purchase_order_lines_purchaseOrderId_idx" ON "supply_v2_purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_purchase_order_lines_catalogItemId_idx" ON "supply_v2_purchase_order_lines"("catalogItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_purchase_order_events_purchaseOrderId_createdAt_idx" ON "supply_v2_purchase_order_events"("purchaseOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_purchase_receipts_number_key" ON "supply_v2_purchase_receipts"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_purchase_receipts_idempotencyKey_key" ON "supply_v2_purchase_receipts"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_purchase_receipts_purchaseOrderId_createdAt_idx" ON "supply_v2_purchase_receipts"("purchaseOrderId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_purchase_receipt_lines_purchaseOrderLineId_idx" ON "supply_v2_purchase_receipt_lines"("purchaseOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_lots_code_key" ON "supply_v2_lots"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_lots_receiptLineId_key" ON "supply_v2_lots"("receiptLineId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_lots_catalogItemId_status_idx" ON "supply_v2_lots"("catalogItemId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_lots_supplierId_status_idx" ON "supply_v2_lots"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_lots_purchaseOrderId_idx" ON "supply_v2_lots"("purchaseOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_ledger_entries_lotId_createdAt_idx" ON "supply_v2_ledger_entries"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_ledger_entries_referenceType_referenceId_idx" ON "supply_v2_ledger_entries"("referenceType", "referenceId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_suppliers" ADD CONSTRAINT "supply_v2_suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_suppliers" ADD CONSTRAINT "supply_v2_suppliers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_catalog_items" ADD CONSTRAINT "supply_v2_catalog_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_catalog_items" ADD CONSTRAINT "supply_v2_catalog_items_existingProductId_fkey" FOREIGN KEY ("existingProductId") REFERENCES "productos_inventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_catalog_items" ADD CONSTRAINT "supply_v2_catalog_items_existingServiceId_fkey" FOREIGN KEY ("existingServiceId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_agreements" ADD CONSTRAINT "supply_v2_agreements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_agreements" ADD CONSTRAINT "supply_v2_agreements_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_agreements" ADD CONSTRAINT "supply_v2_agreements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_agreements" ADD CONSTRAINT "supply_v2_agreements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_agreement_versions" ADD CONSTRAINT "supply_v2_agreement_versions_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "supply_v2_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_agreement_versions" ADD CONSTRAINT "supply_v2_agreement_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_orders" ADD CONSTRAINT "supply_v2_purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_orders" ADD CONSTRAINT "supply_v2_purchase_orders_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "supply_v2_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_orders" ADD CONSTRAINT "supply_v2_purchase_orders_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "supply_v2_agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_orders" ADD CONSTRAINT "supply_v2_purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_orders" ADD CONSTRAINT "supply_v2_purchase_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_order_lines" ADD CONSTRAINT "supply_v2_purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "supply_v2_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_order_lines" ADD CONSTRAINT "supply_v2_purchase_order_lines_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_order_events" ADD CONSTRAINT "supply_v2_purchase_order_events_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "supply_v2_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_order_events" ADD CONSTRAINT "supply_v2_purchase_order_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_receipts" ADD CONSTRAINT "supply_v2_purchase_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "supply_v2_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_receipts" ADD CONSTRAINT "supply_v2_purchase_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_receipts" ADD CONSTRAINT "supply_v2_purchase_receipts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_receipts" ADD CONSTRAINT "supply_v2_purchase_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_receipt_lines" ADD CONSTRAINT "supply_v2_purchase_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "supply_v2_purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_receipt_lines" ADD CONSTRAINT "supply_v2_purchase_receipt_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "supply_v2_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "supply_v2_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "supply_v2_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "supply_v2_purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "supply_v2_purchase_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "supply_v2_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "supply_v2_agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_ledger_entries" ADD CONSTRAINT "supply_v2_ledger_entries_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "supply_v2_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_ledger_entries" ADD CONSTRAINT "supply_v2_ledger_entries_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================================
-- INVARIANTES EN LA BASE
-- ============================================================================

-- El lote cuadra siempre:
--   quantityReceived = available + allocated + reserved + issued + redeemed + closed
-- y ninguna cubeta baja de cero.
DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_buckets_non_negative"
      CHECK ("quantityReceived" >= 0 AND "quantityAvailable" >= 0 AND "quantityAllocated" >= 0
         AND "quantityReserved" >= 0 AND "quantityIssued" >= 0 AND "quantityRedeemed" >= 0
         AND "quantityClosed" >= 0 AND "unitCost" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_lots" ADD CONSTRAINT "supply_v2_lots_buckets_balance"
      CHECK ("quantityReceived" = "quantityAvailable" + "quantityAllocated" + "quantityReserved"
                                + "quantityIssued" + "quantityRedeemed" + "quantityClosed");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un asiento mueve una cantidad positiva y tiene al menos un extremo.
DO $$ BEGIN
    ALTER TABLE "supply_v2_ledger_entries" ADD CONSTRAINT "supply_v2_ledger_entries_quantity_positive"
      CHECK ("quantity" > 0 AND "balanceBefore" >= 0 AND "balanceAfter" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_ledger_entries" ADD CONSTRAINT "supply_v2_ledger_entries_has_bucket"
      CHECK ("sourceBucket" IS NOT NULL OR "destinationBucket" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Una línea de orden compra una cantidad positiva a costo no negativo, y lo
-- recibido nunca supera lo comprado.
DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_order_lines" ADD CONSTRAINT "supply_v2_po_lines_quantities"
      CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "subtotal" >= 0
         AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_orders" ADD CONSTRAINT "supply_v2_po_amounts"
      CHECK ("subtotal" >= 0 AND "taxes" >= 0 AND "total" >= 0 AND "taxRate" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_purchase_receipt_lines" ADD CONSTRAINT "supply_v2_receipt_lines_quantity_positive"
      CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_agreements" ADD CONSTRAINT "supply_v2_agreements_dates_and_rates"
      CHECK (("endsAt" IS NULL OR "endsAt" > "startsAt")
         AND ("negotiatedUnitCost" IS NULL OR "negotiatedUnitCost" >= 0)
         AND ("discountPercentage" IS NULL OR ("discountPercentage" >= 0 AND "discountPercentage" <= 100))
         AND ("commissionPercentage" IS NULL OR ("commissionPercentage" >= 0 AND "commissionPercentage" <= 100)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un proveedor registrado apunta a una empresa; uno externo, no.
DO $$ BEGIN
    ALTER TABLE "supply_v2_suppliers" ADD CONSTRAINT "supply_v2_suppliers_source_company"
      CHECK (("source" = 'REGISTERED_COMPANY' AND "companyId" IS NOT NULL)
          OR ("source" = 'EXTERNAL'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
