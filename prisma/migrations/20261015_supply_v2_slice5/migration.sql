-- ============================================================================
-- MEMBEGO SUPPLY 2.0 · VERTICAL SLICE 5 (2/2) — VENTA SIN PRECOMPRA (COMISIÓN) + SETTLEMENT
-- ============================================================================
--
-- Crea cuatro tablas `supply_v2_*` (reservas de capacidad a comisión,
-- liquidaciones y sus líneas, incidencias financieras) y columnas NUEVAS
-- (los enums van en la migración 1/2, `20261014_supply_v2_slice5_enums`)
-- con default o nulas en ofertas, órdenes y líneas del cliente, derechos,
-- redenciones, obligaciones, pagos y conciliaciones.
--
-- Dos cambios sobre columnas existentes, los dos sin pérdida de datos y
-- exigidos por el modelo (§25, §28): `lotId` (y la asignación) de un derecho y
-- `lotId` de una redención pasan a admitir NULL — SOLO para COMMISSION, y lo
-- garantiza un CHECK. Y la unicidad de conciliación pasa de
-- (proveedor, periodo) a (proveedor, tipo, periodo): se sustituye el índice.
-- Ningún DROP TABLE, DELETE ni UPDATE. Las migraciones anteriores no se tocan.
--
-- IDEMPOTENTE: IF NOT EXISTS o bloques que tragan `duplicate_object`.
--
-- Al final, lo que Prisma no modela:
--   · CHECK: un derecho o una redención sin lote solo puede ser COMMISSION (y
--     entonces lleva su neto congelado); una precompra siempre lleva lote;
--   · CHECK: una oferta COMMISSION lleva versión del acuerdo, comisión y modo
--     de disponibilidad (con cantidad > 0 salvo UNLIMITED); una precompra no
--     lleva acuerdo;
--   · CHECK de dinero en órdenes, liquidaciones, líneas e incidencias
--     (neto = bruto − comisión; nada negativo; pagado ≤ neto); una reserva de
--     capacidad mueve una cantidad positiva.
-- ============================================================================

-- DropIndex
DROP INDEX IF EXISTS "supply_v2_reconciliations_supplierId_periodStart_periodEnd_key";

-- AlterTable
ALTER TABLE "supply_v2_customer_order_lines" ADD COLUMN IF NOT EXISTS "commissionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "commissionPercentage" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "commissionUnitAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierUnitNet" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "supply_v2_customer_orders" ADD COLUMN IF NOT EXISTS "agreementId" TEXT,
ADD COLUMN IF NOT EXISTS "agreementVersionId" TEXT,
ADD COLUMN IF NOT EXISTS "commissionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "commissionPercentage" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "sourceType" "SupplyV2OfferSource" NOT NULL DEFAULT 'PREPURCHASED_SUPPLY',
ADD COLUMN IF NOT EXISTS "supplierNet" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "supply_v2_entitlements" ADD COLUMN IF NOT EXISTS "agreementId" TEXT,
ADD COLUMN IF NOT EXISTS "agreementVersionId" TEXT,
ADD COLUMN IF NOT EXISTS "commissionAmount" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "commissionPercentage" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "sourceType" "SupplyV2OfferSource" NOT NULL DEFAULT 'PREPURCHASED_SUPPLY',
ADD COLUMN IF NOT EXISTS "supplierNet" DECIMAL(12,2),
ALTER COLUMN "allocationId" DROP NOT NULL,
ALTER COLUMN "allocationLineId" DROP NOT NULL,
ALTER COLUMN "lotId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "supply_v2_offers" ADD COLUMN IF NOT EXISTS "agreementId" TEXT,
ADD COLUMN IF NOT EXISTS "agreementVersionId" TEXT,
ADD COLUMN IF NOT EXISTS "availabilityMode" "SupplyV2AvailabilityMode",
ADD COLUMN IF NOT EXISTS "availabilityQuantity" INTEGER,
ADD COLUMN IF NOT EXISTS "commissionPercentage" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "commissionScope" "SupplyV2AgreementScope";

-- AlterTable
ALTER TABLE "supply_v2_reconciliations" ADD COLUMN IF NOT EXISTS "commissionClaimed" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "commissionInternal" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "grossClaimed" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "grossSalesInternal" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "kind" "SupplyV2ReconciliationKind" NOT NULL DEFAULT 'SUPPLY',
ADD COLUMN IF NOT EXISTS "netClaimed" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "netInternal" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "paymentsInternal" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "resolutionType" "SupplyV2ResolutionType";

-- AlterTable
ALTER TABLE "supply_v2_redemptions" ADD COLUMN IF NOT EXISTS "commissionAmountSnapshot" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "commissionPercentageSnapshot" DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS "sourceType" "SupplyV2OfferSource" NOT NULL DEFAULT 'PREPURCHASED_SUPPLY',
ADD COLUMN IF NOT EXISTS "supplierNetSnapshot" DECIMAL(12,2),
ALTER COLUMN "lotId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "supply_v2_supplier_obligations" ADD COLUMN IF NOT EXISTS "settlementId" TEXT;

-- AlterTable
ALTER TABLE "supply_v2_supplier_payments" ADD COLUMN IF NOT EXISTS "intendedSettlementId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_commission_reservations" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "SupplyV2CommissionReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "supply_v2_commission_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_settlements" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "frequency" "SupplyV2SettlementFrequency" NOT NULL DEFAULT 'MANUAL',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "grossSales" DECIMAL(14,2) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "supplierNet" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "SupplyV2SettlementStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_settlement_lines" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "redemptionId" TEXT,
    "descriptionSnapshot" TEXT NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "supplierNet" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_finance_incidents" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" "SupplyV2FinanceIncidentType" NOT NULL,
    "status" "SupplyV2FinanceIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "obligationId" TEXT,
    "redemptionId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_finance_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_commission_reservations_offerId_status_idx" ON "supply_v2_commission_reservations"("offerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_commission_reservations_orderId_idx" ON "supply_v2_commission_reservations"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_settlements_number_key" ON "supply_v2_settlements"("number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_settlements_idempotencyKey_key" ON "supply_v2_settlements"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_settlements_supplierId_status_idx" ON "supply_v2_settlements"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_settlements_status_periodEnd_idx" ON "supply_v2_settlements"("status", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_settlement_lines_obligationId_idx" ON "supply_v2_settlement_lines"("obligationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_settlement_lines_settlementId_obligationId_key" ON "supply_v2_settlement_lines"("settlementId", "obligationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_finance_incidents_supplierId_status_idx" ON "supply_v2_finance_incidents"("supplierId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_entitlements_sourceType_supplierId_idx" ON "supply_v2_entitlements"("sourceType", "supplierId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_offers_sourceType_status_idx" ON "supply_v2_offers"("sourceType", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reconciliations_supplierId_kind_periodStart_perio_key" ON "supply_v2_reconciliations"("supplierId", "kind", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_supplier_obligations_settlementId_idx" ON "supply_v2_supplier_obligations"("settlementId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "supply_v2_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "supply_v2_agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "supply_v2_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "supply_v2_agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "supply_v2_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "supply_v2_agreement_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_payments" ADD CONSTRAINT "supply_v2_supplier_payments_intendedSettlementId_fkey" FOREIGN KEY ("intendedSettlementId") REFERENCES "supply_v2_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_supplier_obligations" ADD CONSTRAINT "supply_v2_supplier_obligations_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "supply_v2_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_commission_reservations" ADD CONSTRAINT "supply_v2_commission_reservations_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_commission_reservations" ADD CONSTRAINT "supply_v2_commission_reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_commission_reservations" ADD CONSTRAINT "supply_v2_commission_reservations_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "supply_v2_customer_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlements" ADD CONSTRAINT "supply_v2_settlements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlements" ADD CONSTRAINT "supply_v2_settlements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlements" ADD CONSTRAINT "supply_v2_settlements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlement_lines" ADD CONSTRAINT "supply_v2_settlement_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "supply_v2_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlement_lines" ADD CONSTRAINT "supply_v2_settlement_lines_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "supply_v2_supplier_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_finance_incidents" ADD CONSTRAINT "supply_v2_finance_incidents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_finance_incidents" ADD CONSTRAINT "supply_v2_finance_incidents_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "supply_v2_supplier_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_finance_incidents" ADD CONSTRAINT "supply_v2_finance_incidents_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Lo que Prisma no modela
-- ============================================================================

-- §25 · Sin lote solo en COMMISSION (y con su neto congelado); precompra siempre con lote.
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_source_shape"
        CHECK (("sourceType" = 'COMMISSION' AND "lotId" IS NULL AND "allocationId" IS NULL AND "allocationLineId" IS NULL
                    AND "agreementVersionId" IS NOT NULL AND "commissionPercentage" IS NOT NULL AND "commissionAmount" IS NOT NULL AND "supplierNet" IS NOT NULL)
               OR ("sourceType" = 'PREPURCHASED_SUPPLY' AND "lotId" IS NOT NULL AND "allocationId" IS NOT NULL AND "allocationLineId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §28 · Una redención COMMISSION no mueve lote; la de precompra sí lo lleva.
DO $$ BEGIN
    ALTER TABLE "supply_v2_redemptions" ADD CONSTRAINT "supply_v2_redemptions_source_shape"
        CHECK (("sourceType" = 'COMMISSION' AND "lotId" IS NULL AND "supplierNetSnapshot" IS NOT NULL AND "commissionAmountSnapshot" IS NOT NULL)
               OR ("sourceType" = 'PREPURCHASED_SUPPLY' AND "lotId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §9–§12 · Una oferta COMMISSION lleva acuerdo, comisión y disponibilidad; una precompra no lleva acuerdo.
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_source_shape"
        CHECK (("sourceType" = 'COMMISSION' AND "agreementId" IS NOT NULL AND "agreementVersionId" IS NOT NULL AND "commissionPercentage" IS NOT NULL
                    AND "commissionPercentage" >= 0 AND "commissionPercentage" <= 100 AND "availabilityMode" IS NOT NULL
                    AND ("availabilityMode" = 'UNLIMITED' OR ("availabilityQuantity" IS NOT NULL AND "availabilityQuantity" > 0)))
               OR ("sourceType" = 'PREPURCHASED_SUPPLY' AND "agreementId" IS NULL AND "availabilityMode" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_commission"
        CHECK ("commissionAmount" >= 0 AND "supplierNet" >= 0 AND "commissionAmount" + "supplierNet" <= "total" + 0.01);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_commission_reservations" ADD CONSTRAINT "supply_v2_commission_reservations_quantity"
        CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_settlements" ADD CONSTRAINT "supply_v2_settlements_money"
        CHECK ("grossSales" >= 0 AND "commissionAmount" >= 0 AND "supplierNet" >= 0 AND "paidAmount" >= 0
               AND "supplierNet" = "grossSales" - "commissionAmount" AND "paidAmount" <= "supplierNet" AND "periodEnd" > "periodStart");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_settlement_lines" ADD CONSTRAINT "supply_v2_settlement_lines_money"
        CHECK ("grossAmount" >= 0 AND "commissionAmount" >= 0 AND "supplierNet" >= 0 AND "supplierNet" = "grossAmount" - "commissionAmount");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_finance_incidents" ADD CONSTRAINT "supply_v2_finance_incidents_amount"
        CHECK ("amount" >= 0 AND ("status" <> 'RESOLVED' OR ("resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §14 · Una oferta a comisión SIN TOPE no destina unidades: quantityLimit = 0 solo en ese caso.
-- (Se sustituye el CHECK del Slice 2 por uno que lo admite; el resto de la regla no cambia.)
ALTER TABLE "supply_v2_offers" DROP CONSTRAINT IF EXISTS "supply_v2_offers_prices";
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_prices"
      CHECK ("publicPrice" >= 0 AND "salePrice" >= 0 AND "salePrice" <= "publicPrice"
         AND ("quantityLimit" > 0 OR ("sourceType" = 'COMMISSION' AND "availabilityMode" = 'UNLIMITED' AND "quantityLimit" = 0))
         AND "perCustomerLimit" > 0
         AND ("endsAt" IS NULL OR "endsAt" > "startsAt"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
