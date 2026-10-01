-- MEMBEGO SUPPLY 2.0 · SLICE 7 · CAMPAÑAS, PROMOCIONES Y CUPONES
-- Parte 2/2: tablas, columnas, índices, claves foráneas, CHECKs y relleno.
--
-- ADITIVA e idempotente: ninguna migración anterior se edita, ninguna columna
-- existente cambia de tipo ni de significado, y todo lo que se crea lleva su
-- guarda para que una segunda pasada no falle. Los datos de producción
-- sobreviven sin tocarse: las campañas nacen vacías y las compras anteriores
-- se quedan con `campaignId` nulo, que es exactamente lo que son — compras sin
-- campaña.
-- AlterTable
ALTER TABLE "supply_v2_benefits" ADD COLUMN IF NOT EXISTS "campaignId" TEXT,
ADD COLUMN IF NOT EXISTS "requiresCoupon" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "supply_v2_customer_orders" ADD COLUMN IF NOT EXISTS "campaignId" TEXT,
ADD COLUMN IF NOT EXISTS "couponCodeSnapshot" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_campaigns" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "organizer" "SupplyV2CampaignOrganizer" NOT NULL DEFAULT 'MEMBEGO',
    "supplierId" TEXT,
    "funding" "SupplyV2BenefitFunding" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "budgetTotal" DECIMAL(14,2),
    "budgetWaiverReason" TEXT,
    "budgetWaiverById" TEXT,
    "budgetWaiverAt" TIMESTAMP(3),
    "audience" "SupplyV2CampaignAudience" NOT NULL DEFAULT 'ALL',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "activeFromMinute" INTEGER,
    "activeToMinute" INTEGER,
    "maxRedemptions" INTEGER,
    "maxPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "status" "SupplyV2CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_campaign_offers" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "benefitId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_campaign_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "kind" "SupplyV2CouponKind" NOT NULL,
    "customerId" TEXT,
    "distributionId" TEXT,
    "maxRedemptions" INTEGER,
    "maxPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "minPurchase" DECIMAL(12,2),
    "timesRedeemed" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "status" "SupplyV2CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "membegoAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplierAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "SupplyV2CouponRedemptionStatus" NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_campaign_distributions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SupplyV2CouponKind" NOT NULL,
    "requested" INTEGER NOT NULL,
    "generated" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_campaign_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_campaign_events" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "SupplyV2CampaignEventType" NOT NULL,
    "detail" TEXT,
    "payload" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_campaign_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_campaigns_code_key" ON "supply_v2_campaigns"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_campaigns_status_startsAt_endsAt_idx" ON "supply_v2_campaigns"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_campaigns_supplierId_idx" ON "supply_v2_campaigns"("supplierId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_campaign_offers_offerId_idx" ON "supply_v2_campaign_offers"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_campaign_offers_campaignId_offerId_key" ON "supply_v2_campaign_offers"("campaignId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_coupons_code_key" ON "supply_v2_coupons"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_coupons_campaignId_status_idx" ON "supply_v2_coupons"("campaignId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_coupons_customerId_status_idx" ON "supply_v2_coupons"("customerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_coupons_benefitId_idx" ON "supply_v2_coupons"("benefitId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_coupon_redemptions_reservationId_key" ON "supply_v2_coupon_redemptions"("reservationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_coupon_redemptions_couponId_status_idx" ON "supply_v2_coupon_redemptions"("couponId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_coupon_redemptions_customerId_couponId_idx" ON "supply_v2_coupon_redemptions"("customerId", "couponId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_coupon_redemptions_orderId_idx" ON "supply_v2_coupon_redemptions"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_campaign_distributions_campaignId_idx" ON "supply_v2_campaign_distributions"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_campaign_events_campaignId_createdAt_idx" ON "supply_v2_campaign_events"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_benefits_campaignId_idx" ON "supply_v2_benefits"("campaignId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "supply_v2_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_benefits" ADD CONSTRAINT "supply_v2_benefits_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "supply_v2_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaigns" ADD CONSTRAINT "supply_v2_campaigns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaigns" ADD CONSTRAINT "supply_v2_campaigns_budgetWaiverById_fkey" FOREIGN KEY ("budgetWaiverById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaigns" ADD CONSTRAINT "supply_v2_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaigns" ADD CONSTRAINT "supply_v2_campaigns_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaigns" ADD CONSTRAINT "supply_v2_campaigns_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_offers" ADD CONSTRAINT "supply_v2_campaign_offers_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "supply_v2_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_offers" ADD CONSTRAINT "supply_v2_campaign_offers_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_offers" ADD CONSTRAINT "supply_v2_campaign_offers_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupons" ADD CONSTRAINT "supply_v2_coupons_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "supply_v2_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupons" ADD CONSTRAINT "supply_v2_coupons_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupons" ADD CONSTRAINT "supply_v2_coupons_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupons" ADD CONSTRAINT "supply_v2_coupons_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "supply_v2_campaign_distributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupons" ADD CONSTRAINT "supply_v2_coupons_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupon_redemptions" ADD CONSTRAINT "supply_v2_coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "supply_v2_coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupon_redemptions" ADD CONSTRAINT "supply_v2_coupon_redemptions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "supply_v2_benefit_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupon_redemptions" ADD CONSTRAINT "supply_v2_coupon_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupon_redemptions" ADD CONSTRAINT "supply_v2_coupon_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_distributions" ADD CONSTRAINT "supply_v2_campaign_distributions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "supply_v2_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_distributions" ADD CONSTRAINT "supply_v2_campaign_distributions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_events" ADD CONSTRAINT "supply_v2_campaign_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "supply_v2_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_events" ADD CONSTRAINT "supply_v2_campaign_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── CHECKs del Slice 7 ──────────────────────────────────────────────────────
-- Las reglas que no se pueden dejar solo en la aplicación: si un camino nuevo
-- se olvida de comprobarlas, la base dice no.

-- §4, §17 · Forma coherente de una campaña: una propuesta de proveedor tiene
-- proveedor; una financiada por el proveedor también; la vigencia crece; una
-- campaña sin techo de presupuesto lleva su autorización excepcional escrita.
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaigns" ADD CONSTRAINT "supply_v2_campaigns_shape"
        CHECK (
            ("endsAt" IS NULL OR "endsAt" > "startsAt")
            AND ("organizer" <> 'SUPPLIER' OR "supplierId" IS NOT NULL)
            AND ("funding" = 'MEMBEGO' OR "supplierId" IS NOT NULL)
            AND ("budgetTotal" IS NULL OR "budgetTotal" > 0)
            AND ("maxRedemptions" IS NULL OR "maxRedemptions" > 0)
            AND "maxPerCustomer" > 0
            AND ("activeFromMinute" IS NULL OR ("activeFromMinute" >= 0 AND "activeFromMinute" < 1440))
            AND ("activeToMinute" IS NULL OR ("activeToMinute" >= 0 AND "activeToMinute" <= 1440))
            AND (("activeFromMinute" IS NULL) = ("activeToMinute" IS NULL))
            AND ("activeFromMinute" IS NULL OR "activeToMinute" > "activeFromMinute")
            -- Sin techo solo con autorización: quién y por qué, o no pasa.
            AND ("budgetTotal" IS NOT NULL OR "funding" = 'SUPPLIER' OR ("budgetWaiverById" IS NOT NULL AND "budgetWaiverReason" IS NOT NULL))
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §11 · Topes de un cupón: nada negativo, y los usos consolidados no pasan del tope.
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupons" ADD CONSTRAINT "supply_v2_coupons_limits"
        CHECK (
            ("maxRedemptions" IS NULL OR "maxRedemptions" > 0)
            AND "maxPerCustomer" > 0
            AND "timesRedeemed" >= 0
            AND ("maxRedemptions" IS NULL OR "timesRedeemed" <= "maxRedemptions")
            AND ("minPurchase" IS NULL OR "minPurchase" >= 0)
            -- Un cupón PRIVADO tiene dueño; uno PÚBLICO no lo tiene.
            AND (("kind" = 'PRIVATE' AND "customerId" IS NOT NULL) OR ("kind" = 'PUBLIC' AND "customerId" IS NULL))
            AND "code" = upper("code")
            AND length("code") >= 4
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §12 · La aplicación de un cupón no inventa importes negativos.
DO $$ BEGIN
    ALTER TABLE "supply_v2_coupon_redemptions" ADD CONSTRAINT "supply_v2_coupon_redemptions_amounts"
        CHECK ("membegoAmount" >= 0 AND "supplierAmount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- §11, §28 · Un cliente no puede tener dos aplicaciones VIVAS del mismo cupón:
-- la barrera contra el doble gasto en dos checkouts simultáneos no depende de
-- que la aplicación se acuerde de contar.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_coupon_redemptions_viva_por_cliente"
    ON "supply_v2_coupon_redemptions" ("couponId", "customerId", "orderId") WHERE "status" IN ('RESERVED', 'APPLIED');

-- §10 · El código es único sin distinguir mayúsculas: "SAONA300" y "saona300"
-- son el mismo cupón, y teclearlo en minúsculas no crea otro.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_coupons_code_upper" ON "supply_v2_coupons" (upper("code"));

-- §16 · Un lote de cupones no genera más de lo que se pidió.
DO $$ BEGIN
    ALTER TABLE "supply_v2_campaign_distributions" ADD CONSTRAINT "supply_v2_campaign_distributions_counts"
        CHECK ("requested" > 0 AND "generated" >= 0 AND "generated" <= "requested");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
