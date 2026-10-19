-- SUPPLIER & FULFILLMENT COMMERCE · Slice 9 · la solicitud «Convertirme en empresa Membego»
-- (§39–§41). La aprobación enciende capacidades de comercio en la MISMA empresa del
-- proveedor; esta tabla solo guarda la solicitud, su revisión y su decisión.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "supply_v2_merchant_applications" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "SupplyV2MerchantApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "datos" JSONB NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moreInfoRequest" TEXT,
    "moreInfoResponse" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "internalNotes" TEXT,
    "capabilitiesGranted" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_merchant_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supply_v2_merchant_applications_supplierId_status_idx" ON "supply_v2_merchant_applications"("supplierId", "status");
CREATE INDEX IF NOT EXISTS "supply_v2_merchant_applications_companyId_idx" ON "supply_v2_merchant_applications"("companyId");
CREATE INDEX IF NOT EXISTS "supply_v2_merchant_applications_status_submittedAt_idx" ON "supply_v2_merchant_applications"("status", "submittedAt");

DO $$ BEGIN
    ALTER TABLE "supply_v2_merchant_applications" ADD CONSTRAINT "supply_v2_merchant_applications_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_v2_merchant_applications" ADD CONSTRAINT "supply_v2_merchant_applications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_v2_merchant_applications" ADD CONSTRAINT "supply_v2_merchant_applications_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_v2_merchant_applications" ADD CONSTRAINT "supply_v2_merchant_applications_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Invariantes (§63): una decisión lleva revisor y fecha; una petición de más información lleva su texto;
-- una solicitud viva por proveedor a la vez.
DO $$ BEGIN
    ALTER TABLE "supply_v2_merchant_applications" ADD CONSTRAINT "supply_v2_merchant_applications_decision"
        CHECK ("status" NOT IN ('APPROVED', 'REJECTED') OR ("reviewerId" IS NOT NULL AND "reviewedAt" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_v2_merchant_applications" ADD CONSTRAINT "supply_v2_merchant_applications_mas_info"
        CHECK ("status" <> 'MORE_INFO_REQUIRED' OR "moreInfoRequest" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_merchant_applications_una_viva"
    ON "supply_v2_merchant_applications"("supplierId")
    WHERE "status" IN ('SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED');
