-- ============================================================================
-- MEMBEGO SUPPLY 2.0 · VERTICAL SLICE 4 — SUPPLIER FINANCE + SUPPLY ECONOMICS
-- ============================================================================
--
-- Solo CREA: diez tablas `supply_v2_*` (facturas y sus líneas, depósitos y sus
-- movimientos, pagos, aplicaciones, obligaciones, eventos económicos,
-- conciliaciones y sus líneas), trece enums, tres columnas nuevas con valor
-- por defecto en `supply_v2_agreements` (política financiera del acuerdo), un
-- tipo de referencia del ledger (LOT) y diecinueve acciones de bitácora. Ni un
-- DROP, ni un UPDATE, ni un ALTER sobre columnas vivas. Las migraciones de los
-- Slices 1, 2 y 3 no se tocan.
--
-- IDEMPOTENTE: IF NOT EXISTS o bloques que tragan `duplicate_object`.
--
-- Al final, lo que Prisma no modela y sí importa:
--   · índice único PARCIAL: `supplierId + supplierInvoiceNumber` cuando hay
--     número y la factura no está cancelada — la misma factura no se registra
--     dos veces (§10);
--   · CHECK de dinero: nada queda en negativo aunque el código fallara
--     (pendiente de factura, disponible del depósito, pendiente de la
--     obligación, aplicado ≤ monto del pago), y una aplicación apunta a UNA
--     deuda y a UN origen de dinero; una reversa lleva motivo y original;
--   · CHECK de periodos: una conciliación termina después de empezar.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2PayableRecognition" AS ENUM ('ON_RECEIPT', 'ON_INVOICE', 'ON_REDEMPTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2InvoiceStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'CREDITED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2DepositStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'CANCELLED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2DepositMovementType" AS ENUM ('DEPOSIT_CREATED', 'DEPOSIT_APPLIED', 'DEPOSIT_RELEASED', 'DEPOSIT_REFUNDED', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2SupplierPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'DEPOSIT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2SupplierPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ApplicationType" AS ENUM ('PAYMENT_TO_INVOICE', 'DEPOSIT_TO_INVOICE', 'PAYMENT_TO_OBLIGATION', 'DEPOSIT_TO_OBLIGATION', 'PAYMENT_TO_DEPOSIT', 'REVERSAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ObligationSource" AS ENUM ('INVOICE', 'PURCHASE_RECEIPT', 'REDEMPTION', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2RecognitionBasis" AS ENUM ('PO_APPROVAL', 'RECEIPT', 'REDEMPTION', 'INVOICE', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ObligationStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2EconomicEventType" AS ENUM ('SALE_REVENUE', 'REDEMPTION_COST', 'EXPIRATION_COST', 'BREAKAGE', 'REVERSAL', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2EconomicReferenceType" AS ENUM ('ENTITLEMENT', 'REDEMPTION', 'LOT', 'CUSTOMER_ORDER', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ReconciliationStatus" AS ENUM ('OPEN', 'MATCHED', 'DISCREPANCY', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ReconciliationLineType" AS ENUM ('INVOICE', 'PAYMENT', 'DEPOSIT', 'DEPOSIT_APPLICATION', 'OBLIGATION', 'REDEMPTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_INVOICE_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_INVOICE_APPROVED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_INVOICE_CANCELLED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_DEPOSIT_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_DEPOSIT_APPLIED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_DEPOSIT_REVERSED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PAYMENT_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PAYMENT_CONFIRMED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PAYMENT_APPLIED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PAYMENT_REVERSED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PAYMENT_CANCELLED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OBLIGATION_RECOGNIZED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OBLIGATION_PAID';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OBLIGATION_CANCELLED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_ECONOMIC_EVENT_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_RECONCILIATION_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_RECONCILIATION_RESOLVED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_LOT_EXPIRED';

-- AlterEnum
ALTER TYPE "SupplyV2ReferenceType" ADD VALUE IF NOT EXISTS 'LOT';

-- AlterTable
ALTER TABLE "supply_v2_agreements" ADD COLUMN IF NOT EXISTS "allowDepositApplication" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "payableRecognition" "SupplyV2PayableRecognition" NOT NULL DEFAULT 'ON_INVOICE',
ADD COLUMN IF NOT EXISTS "settlementFrequency" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_supplier_invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "supplierInvoiceNumber" TEXT,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxes" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "SupplyV2InvoiceStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "amountApplied" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(14,2) NOT NULL,
    "attachmentPath" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "catalogItemId" TEXT,
    "descriptionSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxes" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_supplier_deposits" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "availableAmount" DECIMAL(14,2) NOT NULL,
    "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "SupplyV2DepositStatus" NOT NULL DEFAULT 'ACTIVE',
    "paymentId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_supplier_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_supplier_deposit_movements" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "type" "SupplyV2DepositMovementType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "applicationId" TEXT,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_supplier_deposit_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_supplier_payments" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "method" "SupplyV2SupplierPaymentMethod" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "amount" DECIMAL(14,2) NOT NULL,
    "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "proofPath" TEXT,
    "notes" TEXT,
    "status" "SupplyV2SupplierPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "intendedInvoiceId" TEXT,
    "intendedObligationId" TEXT,
    "intendedDeposit" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_payment_applications" (
    "id" TEXT NOT NULL,
    "type" "SupplyV2ApplicationType" NOT NULL,
    "paymentId" TEXT,
    "depositId" TEXT,
    "invoiceId" TEXT,
    "obligationId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "reversalOfId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_payment_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_supplier_obligations" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sourceType" "SupplyV2ObligationSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "receiptId" TEXT,
    "redemptionId" TEXT,
    "invoiceId" TEXT,
    "agreementId" TEXT,
    "agreementVersionId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(14,2) NOT NULL,
    "recognitionBasis" "SupplyV2RecognitionBasis" NOT NULL,
    "status" "SupplyV2ObligationStatus" NOT NULL DEFAULT 'OPEN',
    "recognizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_supplier_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_economic_events" (
    "id" TEXT NOT NULL,
    "type" "SupplyV2EconomicEventType" NOT NULL,
    "referenceType" "SupplyV2EconomicReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "lotId" TEXT,
    "entitlementId" TEXT,
    "redemptionId" TEXT,
    "customerOrderId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "units" INTEGER NOT NULL DEFAULT 0,
    "gmvAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenueAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossMarginAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_economic_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_reconciliations" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "SupplyV2ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "internalAmount" DECIMAL(14,2) NOT NULL,
    "supplierAmount" DECIMAL(14,2),
    "differenceAmount" DECIMAL(14,2),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_reconciliation_lines" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "type" "SupplyV2ReconciliationLineType" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "internalAmount" DECIMAL(14,2) NOT NULL,
    "supplierAmount" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "status" "SupplyV2ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_reconciliation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_invoices_number_key" ON "supply_v2_supplier_invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_invoices_idempotencyKey_key" ON "supply_v2_supplier_invoices"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_invoices_supplierId_status_idx" ON "supply_v2_supplier_invoices"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_invoices_status_dueDate_idx" ON "supply_v2_supplier_invoices"("status", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_invoices_purchaseOrderId_idx" ON "supply_v2_supplier_invoices"("purchaseOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_invoices_createdAt_idx" ON "supply_v2_supplier_invoices"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_invoice_lines_invoiceId_idx" ON "supply_v2_supplier_invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_invoice_lines_purchaseOrderLineId_idx" ON "supply_v2_supplier_invoice_lines"("purchaseOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_deposits_number_key" ON "supply_v2_supplier_deposits"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_deposits_paymentId_key" ON "supply_v2_supplier_deposits"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_deposits_idempotencyKey_key" ON "supply_v2_supplier_deposits"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_deposits_supplierId_status_idx" ON "supply_v2_supplier_deposits"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_deposit_movements_depositId_createdAt_idx" ON "supply_v2_supplier_deposit_movements"("depositId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_payments_number_key" ON "supply_v2_supplier_payments"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_payments_idempotencyKey_key" ON "supply_v2_supplier_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_payments_supplierId_status_idx" ON "supply_v2_supplier_payments"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_payments_status_paidAt_idx" ON "supply_v2_supplier_payments"("status", "paidAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_payments_paidAt_idx" ON "supply_v2_supplier_payments"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_payment_applications_reversalOfId_key" ON "supply_v2_payment_applications"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_payment_applications_idempotencyKey_key" ON "supply_v2_payment_applications"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_payment_applications_invoiceId_idx" ON "supply_v2_payment_applications"("invoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_payment_applications_paymentId_idx" ON "supply_v2_payment_applications"("paymentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_payment_applications_depositId_idx" ON "supply_v2_payment_applications"("depositId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_payment_applications_obligationId_idx" ON "supply_v2_payment_applications"("obligationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_payment_applications_createdAt_idx" ON "supply_v2_payment_applications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_number_key" ON "supply_v2_supplier_obligations"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_redemptionId_key" ON "supply_v2_supplier_obligations"("redemptionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_supplierId_status_idx" ON "supply_v2_supplier_obligations"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_status_dueAt_idx" ON "supply_v2_supplier_obligations"("status", "dueAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_purchaseOrderId_idx" ON "supply_v2_supplier_obligations"("purchaseOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_invoiceId_idx" ON "supply_v2_supplier_obligations"("invoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_recognizedAt_idx" ON "supply_v2_supplier_obligations"("recognizedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_sourceType_sourceId_key" ON "supply_v2_supplier_obligations"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_economic_events_occurredAt_idx" ON "supply_v2_economic_events"("occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_economic_events_supplierId_occurredAt_idx" ON "supply_v2_economic_events"("supplierId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_economic_events_catalogItemId_occurredAt_idx" ON "supply_v2_economic_events"("catalogItemId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_economic_events_entitlementId_idx" ON "supply_v2_economic_events"("entitlementId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_economic_events_type_occurredAt_idx" ON "supply_v2_economic_events"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_economic_events_type_referenceType_referenceId_key" ON "supply_v2_economic_events"("type", "referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reconciliations_number_key" ON "supply_v2_reconciliations"("number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_reconciliations_supplierId_status_idx" ON "supply_v2_reconciliations"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reconciliations_supplierId_periodStart_periodEnd_key" ON "supply_v2_reconciliations"("supplierId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_reconciliation_lines_reconciliationId_idx" ON "supply_v2_reconciliation_lines"("reconciliationId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoices" ADD CONSTRAINT "supply_v2_supplier_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoices" ADD CONSTRAINT "supply_v2_supplier_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "supply_v2_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoices" ADD CONSTRAINT "supply_v2_supplier_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoices" ADD CONSTRAINT "supply_v2_supplier_invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoice_lines" ADD CONSTRAINT "supply_v2_supplier_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supply_v2_supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoice_lines" ADD CONSTRAINT "supply_v2_supplier_invoice_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "supply_v2_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoice_lines" ADD CONSTRAINT "supply_v2_supplier_invoice_lines_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposits" ADD CONSTRAINT "supply_v2_supplier_deposits_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposits" ADD CONSTRAINT "supply_v2_supplier_deposits_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "supply_v2_supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposits" ADD CONSTRAINT "supply_v2_supplier_deposits_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposit_movements" ADD CONSTRAINT "supply_v2_supplier_deposit_movements_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "supply_v2_supplier_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposit_movements" ADD CONSTRAINT "supply_v2_supplier_deposit_movements_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "supply_v2_payment_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposit_movements" ADD CONSTRAINT "supply_v2_supplier_deposit_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_intendedInvoiceId_fkey" FOREIGN KEY ("intendedInvoiceId") REFERENCES "supply_v2_supplier_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_intendedObligationId_fkey" FOREIGN KEY ("intendedObligationId") REFERENCES "supply_v2_supplier_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "supply_v2_supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "supply_v2_supplier_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supply_v2_supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "supply_v2_supplier_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "supply_v2_payment_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "supply_v2_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "supply_v2_purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "supply_v2_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supply_v2_supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "supply_v2_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "supply_v2_agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_economic_events" ADD CONSTRAINT "supply_v2_economic_events_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_economic_events" ADD CONSTRAINT "supply_v2_economic_events_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_economic_events" ADD CONSTRAINT "supply_v2_economic_events_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "supply_v2_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_economic_events" ADD CONSTRAINT "supply_v2_economic_events_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "supply_v2_entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_economic_events" ADD CONSTRAINT "supply_v2_economic_events_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "supply_v2_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_economic_events" ADD CONSTRAINT "supply_v2_economic_events_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reconciliations" ADD CONSTRAINT "supply_v2_reconciliations_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reconciliations" ADD CONSTRAINT "supply_v2_reconciliations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reconciliations" ADD CONSTRAINT "supply_v2_reconciliations_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reconciliation_lines" ADD CONSTRAINT "supply_v2_reconciliation_lines_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "supply_v2_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Lo que Prisma no modela
-- ============================================================================

-- §10 · No duplicar factura: `supplierId + supplierInvoiceNumber` único cuando
-- hay número del proveedor y la factura sigue viva (una cancelada por error
-- puede volver a registrarse).
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_supplier_invoices_numero_proveedor"
    ON "supply_v2_supplier_invoices" ("supplierId", "supplierInvoiceNumber")
    WHERE "supplierInvoiceNumber" IS NOT NULL AND "status" <> 'CANCELLED';

-- Dinero: nunca en negativo, ni sobrepagado (§39, §54–§56).
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoices" ADD CONSTRAINT "supply_v2_supplier_invoices_money"
        CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "amountApplied" >= 0 AND "amountDue" >= 0
               AND ("status" = 'CANCELLED' OR "amountDue" = "total" - "amountPaid" - "amountApplied"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_invoice_lines" ADD CONSTRAINT "supply_v2_supplier_invoice_lines_money"
        CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "subtotal" >= 0 AND "taxes" >= 0 AND "total" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposits" ADD CONSTRAINT "supply_v2_supplier_deposits_money"
        CHECK ("originalAmount" > 0 AND "availableAmount" >= 0 AND "appliedAmount" >= 0 AND "refundedAmount" >= 0
               AND "availableAmount" = "originalAmount" - "appliedAmount" - "refundedAmount");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_deposit_movements" ADD CONSTRAINT "supply_v2_supplier_deposit_movements_balance"
        CHECK ("balanceAfter" >= 0 AND "amount" <> 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_money"
        CHECK ("amount" > 0 AND "appliedAmount" >= 0 AND "appliedAmount" <= "amount");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un pago confirmado lleva quién lo confirmó; uno cancelado, motivo.
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_status"
        CHECK (("status" <> 'CONFIRMED' OR ("confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL))
               AND ("status" <> 'CANCELLED' OR "cancelledReason" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Una aplicación: monto positivo, UN origen de dinero (pago o depósito) y UN
-- destino (factura, obligación o depósito nuevo; PAYMENT_TO_DEPOSIT lleva el
-- pago que financia y el depósito que nace); una REVERSAL apunta a su
-- original; una aplicación reversada lleva quién y por qué. Una factura u
-- obligación CANCELADA queda con saldos en cero.
DO $$ BEGIN
    ALTER TABLE "supply_v2_payment_applications" ADD CONSTRAINT "supply_v2_payment_applications_shape"
        CHECK ("amount" > 0
               AND ("type" IN ('REVERSAL', 'PAYMENT_TO_DEPOSIT') OR (("paymentId" IS NOT NULL)::int + ("depositId" IS NOT NULL)::int) = 1)
               AND ("type" <> 'PAYMENT_TO_INVOICE' OR ("paymentId" IS NOT NULL AND "invoiceId" IS NOT NULL))
               AND ("type" <> 'DEPOSIT_TO_INVOICE' OR ("depositId" IS NOT NULL AND "invoiceId" IS NOT NULL))
               AND ("type" <> 'PAYMENT_TO_OBLIGATION' OR ("paymentId" IS NOT NULL AND "obligationId" IS NOT NULL))
               AND ("type" <> 'DEPOSIT_TO_OBLIGATION' OR ("depositId" IS NOT NULL AND "obligationId" IS NOT NULL))
               AND ("type" <> 'PAYMENT_TO_DEPOSIT' OR ("paymentId" IS NOT NULL AND "depositId" IS NOT NULL))
               AND ("type" <> 'REVERSAL' OR "reversalOfId" IS NOT NULL)
               AND ("reversedAt" IS NULL OR ("reversedById" IS NOT NULL AND "reversalReason" IS NOT NULL)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_money"
        CHECK ("grossAmount" >= 0 AND "paidAmount" >= 0 AND "outstandingAmount" >= 0
               AND ("status" = 'CANCELLED' OR "outstandingAmount" = "grossAmount" - "paidAmount"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_economic_events" ADD CONSTRAINT "supply_v2_economic_events_margin"
        CHECK ("grossMarginAmount" = "revenueAmount" - "costAmount");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_reconciliations" ADD CONSTRAINT "supply_v2_reconciliations_period"
        CHECK ("periodEnd" > "periodStart");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
