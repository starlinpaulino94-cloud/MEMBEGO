-- MEMBEGO SUPPLY 2.0 · SLICE 6 · BENEFICIOS ECONÓMICOS
-- Parte 2/2: tablas, columnas, índices, claves foráneas, CHECKs y relleno.
-- Aditiva e idempotente: ninguna migración previa se edita.

ALTER TABLE "supply_v2_agreements" ADD COLUMN IF NOT EXISTS "commissionBase" "SupplyV2CommissionBase" NOT NULL DEFAULT 'CONTRACTUAL_SALE_VALUE';

ALTER TABLE "supply_v2_customer_order_lines" ADD COLUMN IF NOT EXISTS "benefitId" TEXT,
ADD COLUMN IF NOT EXISTS "contractualValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "membegoSubsidyAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "supply_v2_customer_orders" ADD COLUMN IF NOT EXISTS "benefitFundingSnapshot" JSONB,
ADD COLUMN IF NOT EXISTS "commissionBase" "SupplyV2CommissionBase",
ADD COLUMN IF NOT EXISTS "contractualValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "membegoSubsidyTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierDiscountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "supply_v2_economic_events" ADD COLUMN IF NOT EXISTS "contractualAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "customerPaidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "subsidyAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "supply_v2_entitlements" ADD COLUMN IF NOT EXISTS "contractualUnitValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "membegoSubsidyAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "supply_v2_redemptions" ADD COLUMN IF NOT EXISTS "contractualValueSnapshot" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "membegoSubsidySnapshot" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "supplierDiscountSnapshot" DECIMAL(12,2);

ALTER TABLE "supply_v2_settlement_lines" ADD COLUMN IF NOT EXISTS "contractualAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "customerPaidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "membegoSubsidyAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierDiscountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "supply_v2_settlements" ADD COLUMN IF NOT EXISTS "contractualValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "customerPaidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "membegoSubsidyTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "supplierDiscountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "supply_v2_benefits" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "funding" "SupplyV2BenefitFunding" NOT NULL,
    "valueType" "SupplyV2BenefitValueType" NOT NULL,
    "membegoValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "supplierValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxMembegoAmount" DECIMAL(12,2),
    "maxSupplierAmount" DECIMAL(12,2),
    "scope" "SupplyV2BenefitScope" NOT NULL,
    "offerId" TEXT,
    "catalogItemId" TEXT,
    "supplierId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "budgetTotal" DECIMAL(14,2),
    "budgetReserved" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "budgetConsumed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "requiresAssignment" BOOLEAN NOT NULL DEFAULT true,
    "combinable" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "SupplyV2BenefitStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_benefits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_v2_customer_benefits" (
    "id" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "usesAllowed" INTEGER NOT NULL DEFAULT 1,
    "usesConsumed" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "status" "SupplyV2CustomerBenefitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "note" TEXT,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "supply_v2_customer_benefits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_v2_benefit_reservations" (
    "id" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "customerBenefitId" TEXT,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "supplierAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "membegoAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "SupplyV2BenefitReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_benefit_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_v2_benefit_movements" (
    "id" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "customerBenefitId" TEXT,
    "reservationId" TEXT,
    "type" "SupplyV2BenefitMovementType" NOT NULL,
    "reservedDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "consumedDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplierAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reservedAfter" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "consumedAfter" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_benefit_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_benefits_code_key" ON "supply_v2_benefits"("code");

CREATE INDEX IF NOT EXISTS "supply_v2_benefits_status_startsAt_endsAt_idx" ON "supply_v2_benefits"("status", "startsAt", "endsAt");

CREATE INDEX IF NOT EXISTS "supply_v2_benefits_supplierId_idx" ON "supply_v2_benefits"("supplierId");

CREATE INDEX IF NOT EXISTS "supply_v2_benefits_offerId_idx" ON "supply_v2_benefits"("offerId");

CREATE INDEX IF NOT EXISTS "supply_v2_benefits_catalogItemId_idx" ON "supply_v2_benefits"("catalogItemId");

CREATE INDEX IF NOT EXISTS "supply_v2_customer_benefits_customerId_status_idx" ON "supply_v2_customer_benefits"("customerId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_customer_benefits_benefitId_customerId_key" ON "supply_v2_customer_benefits"("benefitId", "customerId");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_benefit_reservations_orderLineId_key" ON "supply_v2_benefit_reservations"("orderLineId");

CREATE INDEX IF NOT EXISTS "supply_v2_benefit_reservations_benefitId_status_idx" ON "supply_v2_benefit_reservations"("benefitId", "status");

CREATE INDEX IF NOT EXISTS "supply_v2_benefit_reservations_customerId_benefitId_status_idx" ON "supply_v2_benefit_reservations"("customerId", "benefitId", "status");

CREATE INDEX IF NOT EXISTS "supply_v2_benefit_reservations_orderId_idx" ON "supply_v2_benefit_reservations"("orderId");

CREATE INDEX IF NOT EXISTS "supply_v2_benefit_movements_benefitId_createdAt_idx" ON "supply_v2_benefit_movements"("benefitId", "createdAt");

CREATE INDEX IF NOT EXISTS "supply_v2_benefit_movements_reservationId_idx" ON "supply_v2_benefit_movements"("reservationId");

DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_order_lines" ADD CONSTRAINT "supply_v2_customer_order_lines_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_benefits" ADD CONSTRAINT "supply_v2_customer_benefits_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_benefits" ADD CONSTRAINT "supply_v2_customer_benefits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_benefits" ADD CONSTRAINT "supply_v2_customer_benefits_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_reservations" ADD CONSTRAINT "supply_v2_benefit_reservations_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_reservations" ADD CONSTRAINT "supply_v2_benefit_reservations_customerBenefitId_fkey" FOREIGN KEY ("customerBenefitId") REFERENCES "supply_v2_customer_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_reservations" ADD CONSTRAINT "supply_v2_benefit_reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_reservations" ADD CONSTRAINT "supply_v2_benefit_reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_reservations" ADD CONSTRAINT "supply_v2_benefit_reservations_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "supply_v2_customer_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_movements" ADD CONSTRAINT "supply_v2_benefit_movements_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_movements" ADD CONSTRAINT "supply_v2_benefit_movements_customerBenefitId_fkey" FOREIGN KEY ("customerBenefitId") REFERENCES "supply_v2_customer_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_movements" ADD CONSTRAINT "supply_v2_benefit_movements_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "supply_v2_benefit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_movements" ADD CONSTRAINT "supply_v2_benefit_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── CHECKs del Slice 6 ──────────────────────────────────────────────────────
-- §7–§8 · Un beneficio tiene una forma coherente con quién lo financia y a qué aplica.
DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_shape"
        CHECK ("membegoValue" >= 0 AND "supplierValue" >= 0
           AND ("maxMembegoAmount" IS NULL OR "maxMembegoAmount" > 0)
           AND ("maxSupplierAmount" IS NULL OR "maxSupplierAmount" > 0)
           AND ("valueType" <> 'PERCENTAGE' OR ("membegoValue" <= 100 AND "supplierValue" <= 100))
           AND (("funding" = 'MEMBEGO' AND "membegoValue" > 0 AND "supplierValue" = 0)
             OR ("funding" = 'SUPPLIER' AND "supplierValue" > 0 AND "membegoValue" = 0 AND "supplierId" IS NOT NULL)
             OR ("funding" = 'SHARED' AND "supplierValue" > 0 AND "membegoValue" > 0 AND "supplierId" IS NOT NULL))
           AND (("scope" = 'SPECIFIC_OFFER' AND "offerId" IS NOT NULL)
             OR ("scope" = 'CATALOG_ITEM' AND "catalogItemId" IS NOT NULL)
             OR ("scope" = 'SUPPLIER' AND "supplierId" IS NOT NULL))
           AND "perCustomerLimit" > 0
           AND ("endsAt" IS NULL OR "endsAt" > "startsAt"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §11 · El presupuesto nunca queda negativo ni sobregirado.
DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_budget"
        CHECK ("budgetReserved" >= 0 AND "budgetConsumed" >= 0
           AND ("budgetTotal" IS NULL OR ("budgetTotal" >= 0 AND "budgetReserved" + "budgetConsumed" <= "budgetTotal")));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §10 · Usos de una asignación.
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_benefits" ADD CONSTRAINT "supply_v2_customer_benefits_uses"
        CHECK ("usesAllowed" > 0 AND "usesConsumed" >= 0 AND "usesConsumed" <= "usesAllowed");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §16, §18 · Una reserva tiene importes no negativos y un solo beneficio vivo por orden.
DO $$ BEGIN
    ALTER TABLE "supply_v2_benefit_reservations" ADD CONSTRAINT "supply_v2_benefit_reservations_amounts"
        CHECK ("quantity" > 0 AND "supplierAmount" >= 0 AND "membegoAmount" >= 0 AND ("supplierAmount" + "membegoAmount") > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_benefit_reservations_viva_por_orden"
    ON "supply_v2_benefit_reservations" ("orderId", "benefitId") WHERE "status" IN ('ACTIVE', 'APPLIED');

-- §15 · Financiación de orden y línea: nada negativo; el cliente nunca paga menos que cero.
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_funding"
        CHECK ("contractualValue" >= 0 AND "supplierDiscountTotal" >= 0 AND "membegoSubsidyTotal" >= 0 AND "total" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_order_lines" ADD CONSTRAINT "supply_v2_customer_order_lines_funding"
        CHECK ("contractualValue" >= 0 AND "supplierDiscountAmount" >= 0 AND "membegoSubsidyAmount" >= 0 AND "total" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_v2_entitlements" ADD CONSTRAINT "supply_v2_entitlements_funding"
        CHECK ("contractualUnitValue" >= 0 AND "supplierDiscountAmount" >= 0 AND "membegoSubsidyAmount" >= 0 AND "customerUnitPrice" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Relleno de las ventas anteriores al Slice 6 (sin beneficio: contractual = lo que pagó el cliente) ──
UPDATE "supply_v2_customer_order_lines" SET "contractualValue" = "total" WHERE "contractualValue" = 0 AND "total" > 0;
UPDATE "supply_v2_customer_orders" SET "contractualValue" = "total" WHERE "contractualValue" = 0 AND "total" > 0;
UPDATE "supply_v2_entitlements" SET "contractualUnitValue" = "customerUnitPrice" WHERE "contractualUnitValue" = 0 AND "customerUnitPrice" > 0;
UPDATE "supply_v2_economic_events" SET "contractualAmount" = "gmvAmount", "customerPaidAmount" = "gmvAmount"
    WHERE "type" IN ('SALE_REVENUE', 'COMMISSION_REVENUE') AND "contractualAmount" = 0 AND "gmvAmount" > 0;
UPDATE "supply_v2_settlement_lines" SET "contractualAmount" = "grossAmount", "customerPaidAmount" = "grossAmount" WHERE "contractualAmount" = 0 AND "grossAmount" > 0;
UPDATE "supply_v2_settlements" SET "contractualValue" = "grossSales", "customerPaidTotal" = "grossSales" WHERE "contractualValue" = 0 AND "grossSales" > 0;

-- ── Invariantes anteriores que daban por hecho que NO había beneficios ──────
-- Hasta el Slice 5 «lo que paga el cliente» y «el valor de la venta» eran la
-- misma cifra, y tres CHECK lo escribían así. Con beneficios dejan de serlo:
-- se REEMPLAZAN por la versión que separa las dos (§3, §13, §26). El relleno
-- de arriba ya dejó las filas anteriores cuadradas, así que el cambio no
-- rechaza nada de lo que ya existe. Reemplazar es idempotente: se tira el
-- viejo (si está) y se crea el nuevo (si no está).

-- §13 · total = lo que paga el cliente = GMV − descuento del proveedor − bono de Membego.
ALTER TABLE "supply_v2_customer_orders" DROP CONSTRAINT IF EXISTS "supply_v2_customer_orders_amounts";
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_amounts"
        CHECK (
            "subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0
            AND "contractualValue" = "subtotal" - "discount" - "supplierDiscountTotal"
            AND "total" = "contractualValue" - "membegoSubsidyTotal"
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §13 · lo mismo en la línea: el reparto por línea tiene que cuadrar solo.
ALTER TABLE "supply_v2_customer_order_lines" DROP CONSTRAINT IF EXISTS "supply_v2_customer_order_lines_amounts";
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_order_lines" ADD CONSTRAINT "supply_v2_customer_order_lines_amounts"
        CHECK (
            "quantity" > 0 AND "publicUnitPrice" >= 0 AND "saleUnitPrice" >= 0
            AND "subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0
            AND "contractualValue" = "subtotal" - "discount" - "supplierDiscountAmount"
            AND "total" = "contractualValue" - "membegoSubsidyAmount"
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §14, §25 · la comisión y el neto del proveedor salen del VALOR CONTRACTUAL,
-- no de lo que pagó el cliente: con un bono, el cliente paga menos y el
-- proveedor cobra lo mismo.
ALTER TABLE "supply_v2_customer_orders" DROP CONSTRAINT IF EXISTS "supply_v2_customer_orders_commission";
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_commission"
        CHECK ("commissionAmount" >= 0 AND "supplierNet" >= 0 AND ("commissionAmount" + "supplierNet") <= "contractualValue" + 0.01);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §26 · en la liquidación, el bruto es el GMV (contractual + descuento del
-- proveedor) y el neto se calcula sobre el contractual.
ALTER TABLE "supply_v2_settlement_lines" DROP CONSTRAINT IF EXISTS "supply_v2_settlement_lines_money";
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlement_lines" ADD CONSTRAINT "supply_v2_settlement_lines_money"
        CHECK (
            "grossAmount" >= 0 AND "commissionAmount" >= 0 AND "supplierNet" >= 0
            AND "contractualAmount" >= 0 AND "supplierDiscountAmount" >= 0 AND "membegoSubsidyAmount" >= 0 AND "customerPaidAmount" >= 0
            AND "supplierNet" = "grossAmount" - "supplierDiscountAmount" - "commissionAmount"
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "supply_v2_settlements" DROP CONSTRAINT IF EXISTS "supply_v2_settlements_money";
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlements" ADD CONSTRAINT "supply_v2_settlements_money"
        CHECK (
            "grossSales" >= 0 AND "commissionAmount" >= 0 AND "supplierNet" >= 0 AND "paidAmount" >= 0
            AND "contractualValue" >= 0 AND "supplierDiscountTotal" >= 0 AND "membegoSubsidyTotal" >= 0 AND "customerPaidTotal" >= 0
            AND "supplierNet" = "grossSales" - "supplierDiscountTotal" - "commissionAmount"
            AND "paidAmount" <= "supplierNet"
            AND "periodEnd" > "periodStart"
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
