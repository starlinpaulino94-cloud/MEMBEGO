-- MEMBEGO SUPPLY 2.0 · SLICE 8 · FIDELIZACIÓN
-- Parte 2/2: tablas, columnas, índices, claves foráneas, CHECKs e índices
-- únicos parciales.
--
-- ADITIVA e idempotente. Ninguna migración anterior se edita, ninguna columna
-- existente cambia de tipo ni de significado, y todo lo que se crea lleva su
-- guarda para que una segunda pasada no falle.
--
-- LO ÚNICO QUE TOCA TABLAS YA EXISTENTES:
--   · `supply_v2_customer_orders`: `kind` (NOT NULL DEFAULT 'OFFER', así que
--     todos los pedidos anteriores siguen siendo exactamente lo que eran) y
--     `membershipPlanId` (nulo).
--   · `supply_v2_customer_benefits`: `membershipId` (nulo), para saber de qué
--     membresía vino una asignación.
-- No se migra ni un dato histórico y no se toca ningún importe ya escrito.

-- AlterTable
ALTER TABLE "supply_v2_customer_benefits" ADD COLUMN IF NOT EXISTS "membershipId" TEXT;

-- AlterTable
ALTER TABLE "supply_v2_customer_orders" ADD COLUMN IF NOT EXISTS "kind" "SupplyV2OrderKind" NOT NULL DEFAULT 'OFFER',
ADD COLUMN IF NOT EXISTS "membershipPlanId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_loyalty_programs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "owner" "SupplyV2LoyaltyOwner" NOT NULL DEFAULT 'MEMBEGO',
    "supplierId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "modalities" "SupplyV2LoyaltyModality"[],
    "funding" "SupplyV2BenefitFunding" NOT NULL DEFAULT 'MEMBEGO',
    "budgetTotal" DECIMAL(14,2),
    "budgetWaiverReason" TEXT,
    "budgetWaiverById" TEXT,
    "budgetWaiverAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "pointsPerUnit" INTEGER,
    "amountPerPoint" DECIMAL(12,2),
    "accrualBasis" "SupplyV2PointsAccrualBasis" NOT NULL DEFAULT 'CONTRACTUAL_VALUE',
    "pointsExpireDays" INTEGER,
    "pointsHoldDays" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplyV2LoyaltyProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_loyalty_program_branches" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_loyalty_program_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_membership_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "SupplyV2MembershipPlanKind" NOT NULL DEFAULT 'PAID',
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "durationDays" INTEGER NOT NULL,
    "maxMembers" INTEGER,
    "maxAdvanceRenewals" INTEGER NOT NULL DEFAULT 1,
    "status" "SupplyV2MembershipPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_membership_plan_versions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_membership_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_membership_benefits" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "SupplyV2MembershipBenefitKind" NOT NULL DEFAULT 'BENEFIT',
    "benefitId" TEXT,
    "grantsCoupon" BOOLEAN NOT NULL DEFAULT false,
    "usesPerPeriod" INTEGER,
    "pointsMultiplier" DECIMAL(5,2),
    "earlyAccessHours" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_membership_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_customer_memberships" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" "SupplyV2CustomerMembershipStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "pricePaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "previousMembershipId" TEXT,
    "grantedById" TEXT,
    "grantReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_customer_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_referral_programs" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "rewardKind" "SupplyV2ReferralRewardKind" NOT NULL DEFAULT 'POINTS',
    "rewardBenefitId" TEXT,
    "rewardPoints" INTEGER,
    "rewardAmount" DECIMAL(12,2),
    "requiresFirstPurchase" BOOLEAN NOT NULL DEFAULT true,
    "minPurchaseAmount" DECIMAL(12,2),
    "requiresPaymentConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "waitingPeriodDays" INTEGER NOT NULL DEFAULT 0,
    "maxPerReferrer" INTEGER,
    "maxTotal" INTEGER,
    "budgetTotal" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_referral_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_referral_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "timesOpened" INTEGER NOT NULL DEFAULT 0,
    "timesSignedUp" INTEGER NOT NULL DEFAULT 0,
    "timesRewarded" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_referrals" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT,
    "codeSnapshot" TEXT NOT NULL,
    "status" "SupplyV2ReferralStatus" NOT NULL DEFAULT 'LINK_OPENED',
    "signedUpAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "eligibleOrderId" TEXT,
    "eligibleAt" TIMESTAMP(3),
    "rewardApprovedAt" TIMESTAMP(3),
    "rewardGrantedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "rewardKind" "SupplyV2ReferralRewardKind",
    "rewardPoints" INTEGER,
    "rewardAmount" DECIMAL(12,2),
    "rewardBenefitId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_points_accounts" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "expired" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_points_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_points_movements" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "SupplyV2PointsMovementType" NOT NULL,
    "source" "SupplyV2PointsSource" NOT NULL,
    "points" INTEGER NOT NULL,
    "availableDelta" INTEGER NOT NULL DEFAULT 0,
    "pendingDelta" INTEGER NOT NULL DEFAULT 0,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "redeemedDelta" INTEGER NOT NULL DEFAULT 0,
    "expiredDelta" INTEGER NOT NULL DEFAULT 0,
    "availableAfter" INTEGER NOT NULL,
    "pendingAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "consumedFromLot" INTEGER NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "referralId" TEXT,
    "rewardClaimId" TEXT,
    "membershipId" TEXT,
    "sourceMovementId" TEXT,
    "ruleSnapshot" JSONB,
    "reason" TEXT,
    "actorId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_points_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_rewards" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "SupplyV2RewardKind" NOT NULL,
    "pointsCost" INTEGER NOT NULL DEFAULT 0,
    "benefitId" TEXT,
    "offerId" TEXT,
    "funding" "SupplyV2BenefitFunding" NOT NULL DEFAULT 'MEMBEGO',
    "unitCost" DECIMAL(12,2),
    "budgetTotal" DECIMAL(14,2),
    "maxClaims" INTEGER,
    "maxPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "timesClaimed" INTEGER NOT NULL DEFAULT 0,
    "requiresMembership" BOOLEAN NOT NULL DEFAULT false,
    "requiredPlanId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "SupplyV2RewardStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_reward_claims" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "accountId" TEXT,
    "pointsReserved" INTEGER NOT NULL DEFAULT 0,
    "pointsConsumed" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplyV2RewardClaimStatus" NOT NULL DEFAULT 'RESERVED',
    "customerBenefitId" TEXT,
    "entitlementId" TEXT,
    "referralId" TEXT,
    "cost" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reverseReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_v2_reward_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "supply_v2_loyalty_events" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "type" "SupplyV2LoyaltyEventType" NOT NULL,
    "membershipId" TEXT,
    "referralId" TEXT,
    "rewardClaimId" TEXT,
    "payload" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_v2_loyalty_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_loyalty_programs_code_key" ON "supply_v2_loyalty_programs"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_loyalty_programs_status_startsAt_endsAt_idx" ON "supply_v2_loyalty_programs"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_loyalty_programs_supplierId_idx" ON "supply_v2_loyalty_programs"("supplierId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_loyalty_programs_owner_status_idx" ON "supply_v2_loyalty_programs"("owner", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_loyalty_program_branches_sucursalId_idx" ON "supply_v2_loyalty_program_branches"("sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_loyalty_program_branches_programId_sucursalId_key" ON "supply_v2_loyalty_program_branches"("programId", "sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_membership_plans_code_key" ON "supply_v2_membership_plans"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_membership_plans_programId_status_idx" ON "supply_v2_membership_plans"("programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_membership_plans_programId_name_key" ON "supply_v2_membership_plans"("programId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_membership_plan_versions_planId_version_key" ON "supply_v2_membership_plan_versions"("planId", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_membership_benefits_planId_idx" ON "supply_v2_membership_benefits"("planId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_membership_benefits_planId_benefitId_key" ON "supply_v2_membership_benefits"("planId", "benefitId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_customer_memberships_code_key" ON "supply_v2_customer_memberships"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_customer_memberships_orderId_key" ON "supply_v2_customer_memberships"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_customer_memberships_previousMembershipId_key" ON "supply_v2_customer_memberships"("previousMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_customer_memberships_idempotencyKey_key" ON "supply_v2_customer_memberships"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_memberships_customerId_status_idx" ON "supply_v2_customer_memberships"("customerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_memberships_planId_status_idx" ON "supply_v2_customer_memberships"("planId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_customer_memberships_status_expiresAt_idx" ON "supply_v2_customer_memberships"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_referral_programs_programId_key" ON "supply_v2_referral_programs"("programId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_referral_codes_code_key" ON "supply_v2_referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_referral_codes_programId_ownerId_key" ON "supply_v2_referral_codes"("programId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_referrals_eligibleOrderId_key" ON "supply_v2_referrals"("eligibleOrderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_referrals_idempotencyKey_key" ON "supply_v2_referrals"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_referrals_referrerId_status_idx" ON "supply_v2_referrals"("referrerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_referrals_status_eligibleAt_idx" ON "supply_v2_referrals"("status", "eligibleAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_referrals_programId_referredId_key" ON "supply_v2_referrals"("programId", "referredId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_points_accounts_customerId_idx" ON "supply_v2_points_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_points_accounts_programId_customerId_key" ON "supply_v2_points_accounts"("programId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_points_movements_idempotencyKey_key" ON "supply_v2_points_movements"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_points_movements_accountId_createdAt_idx" ON "supply_v2_points_movements"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_points_movements_accountId_type_expiresAt_idx" ON "supply_v2_points_movements"("accountId", "type", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_points_movements_expiresAt_idx" ON "supply_v2_points_movements"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_rewards_code_key" ON "supply_v2_rewards"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_rewards_programId_status_idx" ON "supply_v2_rewards"("programId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_rewards_status_startsAt_endsAt_idx" ON "supply_v2_rewards"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reward_claims_code_key" ON "supply_v2_reward_claims"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reward_claims_customerBenefitId_key" ON "supply_v2_reward_claims"("customerBenefitId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reward_claims_entitlementId_key" ON "supply_v2_reward_claims"("entitlementId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reward_claims_referralId_key" ON "supply_v2_reward_claims"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reward_claims_idempotencyKey_key" ON "supply_v2_reward_claims"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_reward_claims_customerId_status_idx" ON "supply_v2_reward_claims"("customerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_reward_claims_rewardId_status_idx" ON "supply_v2_reward_claims"("rewardId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_loyalty_events_programId_createdAt_idx" ON "supply_v2_loyalty_events"("programId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "supply_v2_loyalty_events_type_createdAt_idx" ON "supply_v2_loyalty_events"("type", "createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_programs" ADD CONSTRAINT "supply_v2_loyalty_programs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_programs" ADD CONSTRAINT "supply_v2_loyalty_programs_budgetWaiverById_fkey" FOREIGN KEY ("budgetWaiverById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_programs" ADD CONSTRAINT "supply_v2_loyalty_programs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_programs" ADD CONSTRAINT "supply_v2_loyalty_programs_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_program_branches" ADD CONSTRAINT "supply_v2_loyalty_program_branches_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_program_branches" ADD CONSTRAINT "supply_v2_loyalty_program_branches_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_membership_plans" ADD CONSTRAINT "supply_v2_membership_plans_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_membership_plans" ADD CONSTRAINT "supply_v2_membership_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_membership_plan_versions" ADD CONSTRAINT "supply_v2_membership_plan_versions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "supply_v2_membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_membership_plan_versions" ADD CONSTRAINT "supply_v2_membership_plan_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_membership_benefits" ADD CONSTRAINT "supply_v2_membership_benefits_planId_fkey" FOREIGN KEY ("planId") REFERENCES "supply_v2_membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_membership_benefits" ADD CONSTRAINT "supply_v2_membership_benefits_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_memberships" ADD CONSTRAINT "supply_v2_customer_memberships_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_memberships" ADD CONSTRAINT "supply_v2_customer_memberships_planId_fkey" FOREIGN KEY ("planId") REFERENCES "supply_v2_membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_memberships" ADD CONSTRAINT "supply_v2_customer_memberships_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_memberships" ADD CONSTRAINT "supply_v2_customer_memberships_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_memberships" ADD CONSTRAINT "supply_v2_customer_memberships_previousMembershipId_fkey" FOREIGN KEY ("previousMembershipId") REFERENCES "supply_v2_customer_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_memberships" ADD CONSTRAINT "supply_v2_customer_memberships_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referral_programs" ADD CONSTRAINT "supply_v2_referral_programs_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referral_programs" ADD CONSTRAINT "supply_v2_referral_programs_rewardBenefitId_fkey" FOREIGN KEY ("rewardBenefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referral_codes" ADD CONSTRAINT "supply_v2_referral_codes_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referral_codes" ADD CONSTRAINT "supply_v2_referral_codes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referrals" ADD CONSTRAINT "supply_v2_referrals_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referrals" ADD CONSTRAINT "supply_v2_referrals_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "supply_v2_referral_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referrals" ADD CONSTRAINT "supply_v2_referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referrals" ADD CONSTRAINT "supply_v2_referrals_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referrals" ADD CONSTRAINT "supply_v2_referrals_eligibleOrderId_fkey" FOREIGN KEY ("eligibleOrderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_referrals" ADD CONSTRAINT "supply_v2_referrals_rewardBenefitId_fkey" FOREIGN KEY ("rewardBenefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_accounts" ADD CONSTRAINT "supply_v2_points_accounts_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_accounts" ADD CONSTRAINT "supply_v2_points_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "supply_v2_points_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "supply_v2_referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_rewardClaimId_fkey" FOREIGN KEY ("rewardClaimId") REFERENCES "supply_v2_reward_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "supply_v2_customer_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_sourceMovementId_fkey" FOREIGN KEY ("sourceMovementId") REFERENCES "supply_v2_points_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "supply_v2_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_requiredPlanId_fkey" FOREIGN KEY ("requiredPlanId") REFERENCES "supply_v2_membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "supply_v2_rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "supply_v2_points_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_customerBenefitId_fkey" FOREIGN KEY ("customerBenefitId") REFERENCES "supply_v2_customer_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "supply_v2_entitlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "supply_v2_referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_events" ADD CONSTRAINT "supply_v2_loyalty_events_programId_fkey" FOREIGN KEY ("programId") REFERENCES "supply_v2_loyalty_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_events" ADD CONSTRAINT "supply_v2_loyalty_events_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "supply_v2_customer_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_events" ADD CONSTRAINT "supply_v2_loyalty_events_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "supply_v2_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_events" ADD CONSTRAINT "supply_v2_loyalty_events_rewardClaimId_fkey" FOREIGN KEY ("rewardClaimId") REFERENCES "supply_v2_reward_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_events" ADD CONSTRAINT "supply_v2_loyalty_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "supply_v2_membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_benefits" ADD CONSTRAINT "supply_v2_customer_benefits_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "supply_v2_customer_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ──────────────────────────────────────────────────────────────────────────
-- LOS INVARIANTES, SOSTENIDOS POR LA BASE
--
-- No son decorativos: el Slice 7 dejó una prueba que intenta escrituras
-- ilegales directas y comprueba que PostgreSQL las rechaza POR NOMBRE de
-- constraint. El Slice 8 hace lo mismo.
-- ──────────────────────────────────────────────────────────────────────────

-- Un programa que compromete dinero de Membego EXIGE techo; ir sin él
-- requiere motivo escrito y quién lo autoriza (§17 del Slice 7, que aquí se
-- mantiene). Y la regla de acumulación va completa o vacía: media regla
-- («1 punto por cada…» sin el «cada cuánto») no acumula nada.
DO $$ BEGIN
    ALTER TABLE "supply_v2_loyalty_programs" ADD CONSTRAINT "supply_v2_loyalty_programs_shape"
        CHECK (
            ("endsAt" IS NULL OR "endsAt" > "startsAt")
            AND ("owner" <> 'SUPPLIER' OR "supplierId" IS NOT NULL)
            AND ("funding" = 'MEMBEGO' OR "supplierId" IS NOT NULL)
            AND ("budgetTotal" IS NULL OR "budgetTotal" > 0)
            AND ("budgetTotal" IS NOT NULL OR "funding" = 'SUPPLIER'
                 OR ("budgetWaiverById" IS NOT NULL AND "budgetWaiverReason" IS NOT NULL))
            AND ("pointsPerUnit" IS NULL OR "pointsPerUnit" > 0)
            AND ("amountPerPoint" IS NULL OR "amountPerPoint" > 0)
            AND (("pointsPerUnit" IS NULL) = ("amountPerPoint" IS NULL))
            AND ("pointsExpireDays" IS NULL OR "pointsExpireDays" > 0)
            AND "pointsHoldDays" >= 0
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un plan de pago cuesta algo; uno gratuito o concedido, nada. Que el tipo y
-- el precio no puedan contradecirse evita cobrar por una membresía gratuita.
DO $$ BEGIN
    ALTER TABLE "supply_v2_membership_plans" ADD CONSTRAINT "supply_v2_membership_plans_shape"
        CHECK (
            "durationDays" > 0
            AND "price" >= 0
            AND (("kind" = 'PAID' AND "price" > 0) OR ("kind" <> 'PAID' AND "price" = 0))
            AND ("maxMembers" IS NULL OR "maxMembers" > 0)
            AND "maxAdvanceRenewals" > 0
            AND "currentVersion" > 0
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Una membresía ACTIVA tiene fecha de activación y de vencimiento: sin ellas
-- no se puede decir hasta cuándo valen sus beneficios. Y una membresía
-- otorgada dice quién la concedió y por qué.
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_memberships" ADD CONSTRAINT "supply_v2_customer_memberships_shape"
        CHECK (
            "pricePaid" >= 0
            AND "renewalCount" >= 0
            AND "planVersion" > 0
            AND ("expiresAt" IS NULL OR "activatedAt" IS NULL OR "expiresAt" > "activatedAt")
            AND ("status" NOT IN ('ACTIVE', 'SCHEDULED') OR ("activatedAt" IS NOT NULL AND "expiresAt" IS NOT NULL))
            AND ("grantedById" IS NULL OR "grantReason" IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- La recompensa del referido tiene que existir de verdad: puntos si paga en
-- puntos, beneficio si paga en beneficio.
DO $$ BEGIN
    ALTER TABLE "supply_v2_referral_programs" ADD CONSTRAINT "supply_v2_referral_programs_shape"
        CHECK (
            ("rewardPoints" IS NULL OR "rewardPoints" > 0)
            AND ("rewardAmount" IS NULL OR "rewardAmount" > 0)
            AND ("minPurchaseAmount" IS NULL OR "minPurchaseAmount" >= 0)
            AND "waitingPeriodDays" >= 0
            AND ("maxPerReferrer" IS NULL OR "maxPerReferrer" > 0)
            AND ("maxTotal" IS NULL OR "maxTotal" > 0)
            AND ("budgetTotal" IS NULL OR "budgetTotal" > 0)
            AND ("rewardKind" <> 'POINTS' OR "rewardPoints" IS NOT NULL)
            AND ("rewardKind" = 'POINTS' OR "rewardBenefitId" IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- EL AUTORREFERIDO LO IMPIDE LA BASE, no solo el servicio (§22): nadie se
-- recomienda a sí mismo, pase por donde pase la escritura.
DO $$ BEGIN
    ALTER TABLE "supply_v2_referrals" ADD CONSTRAINT "supply_v2_referrals_shape"
        CHECK (
            ("referredId" IS NULL OR "referredId" <> "referrerId")
            AND ("rewardPoints" IS NULL OR "rewardPoints" > 0)
            AND ("rewardAmount" IS NULL OR "rewardAmount" > 0)
            AND ("status" <> 'REWARD_GRANTED' OR "rewardGrantedAt" IS NOT NULL)
            AND ("status" = 'LINK_OPENED' OR "referredId" IS NOT NULL)
            AND ("voidedAt" IS NULL OR "voidReason" IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- El código es una referencia comercial, no una credencial, pero tampoco un
-- id interno: mayúsculas y largo mínimo, igual que los cupones del Slice 7.
DO $$ BEGIN
    ALTER TABLE "supply_v2_referral_codes" ADD CONSTRAINT "supply_v2_referral_codes_shape"
        CHECK (
            "code" = upper("code")
            AND length("code") >= 4
            AND "timesOpened" >= 0 AND "timesSignedUp" >= 0 AND "timesRewarded" >= 0
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ninguna cubeta de la cuenta puede quedar negativa: ni gastando puntos que
-- no hay, ni liberando dos veces los mismos.
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_accounts" ADD CONSTRAINT "supply_v2_points_accounts_balances"
        CHECK ("available" >= 0 AND "pending" >= 0 AND "reserved" >= 0 AND "redeemed" >= 0 AND "expired" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- UN AJUSTE MANUAL EXIGE MOTIVO Y ACTOR (§43). Y los saldos resultantes que
-- deja cada movimiento tampoco pueden ser negativos: si lo fueran, la caché
-- de la cuenta estaría mintiendo.
DO $$ BEGIN
    ALTER TABLE "supply_v2_points_movements" ADD CONSTRAINT "supply_v2_points_movements_shape"
        CHECK (
            "points" > 0
            AND "availableAfter" >= 0 AND "pendingAfter" >= 0 AND "reservedAfter" >= 0
            AND "consumedFromLot" >= 0
            AND ("type" <> 'ADMIN_ADJUSTMENT' OR ("reason" IS NOT NULL AND "actorId" IS NOT NULL))
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Una recompensa que entrega un producto necesita la oferta que lo entrega;
-- una que aplica un beneficio, el beneficio. Sin eso, reclamarla no daría
-- nada y el cliente habría gastado sus puntos.
DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_shape"
        CHECK (
            "pointsCost" >= 0
            AND ("maxClaims" IS NULL OR "maxClaims" > 0)
            AND "maxPerCustomer" > 0
            AND "timesClaimed" >= 0
            AND ("maxClaims" IS NULL OR "timesClaimed" <= "maxClaims")
            AND ("endsAt" IS NULL OR "endsAt" > "startsAt")
            AND ("unitCost" IS NULL OR "unitCost" >= 0)
            AND ("budgetTotal" IS NULL OR "budgetTotal" > 0)
            AND ("kind" NOT IN ('FREE_PRODUCT', 'SERVICE') OR "offerId" IS NOT NULL)
            AND ("kind" NOT IN ('BENEFIT', 'COUPON', 'PARTIAL_BONUS') OR "benefitId" IS NOT NULL)
            AND ("requiredPlanId" IS NULL OR "requiresMembership")
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- No se puede consumir más de lo reservado, y una reversa deja su motivo.
DO $$ BEGIN
    ALTER TABLE "supply_v2_reward_claims" ADD CONSTRAINT "supply_v2_reward_claims_shape"
        CHECK (
            "pointsReserved" >= 0
            AND "pointsConsumed" >= 0
            AND "pointsConsumed" <= "pointsReserved"
            AND ("cost" IS NULL OR "cost" >= 0)
            AND ("status" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL)
            AND ("reversedAt" IS NULL OR "reverseReason" IS NOT NULL)
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un pedido de membresía lleva su plan, y uno de oferta no. Los pedidos
-- anteriores al Slice 8 son 'OFFER' con plan nulo: cumplen sin tocarlos.
DO $$ BEGIN
    ALTER TABLE "supply_v2_customer_orders" ADD CONSTRAINT "supply_v2_customer_orders_kind"
        CHECK (("kind" = 'MEMBERSHIP') = ("membershipPlanId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- ÍNDICES ÚNICOS PARCIALES: lo que hace que las carreras pierdan de verdad
--
-- El candado `FOR UPDATE` serializa; el índice es la red por debajo, para el
-- caso en que alguien escriba por otro camino. El Slice 6 y el 7 usan el
-- mismo par y sus pruebas comprueban en `pg_indexes` que existen.
-- ──────────────────────────────────────────────────────────────────────────

-- El código de referido es único también ignorando mayúsculas: dos códigos
-- que solo se distinguen por el caso serían el mismo código al dictarlo.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_referral_codes_code_upper"
    ON "supply_v2_referral_codes" (upper("code"));

-- Una sola membresía VIVA por plan y persona, y una sola compra sin pagar:
-- el doble clic no compra dos veces, y dos períodos no se solapan. Un período
-- comprado por adelantado queda 'SCHEDULED' y no choca con el que corre.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_membresia_activa_por_plan"
    ON "supply_v2_customer_memberships" ("planId", "customerId")
    WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_membresia_sin_pagar_por_plan"
    ON "supply_v2_customer_memberships" ("planId", "customerId")
    WHERE "status" = 'PENDING_PAYMENT';

-- Una sola reclamación EN CURSO de la misma recompensa por persona: dos
-- pestañas no reservan dos veces los mismos puntos.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_reclamacion_viva_por_cliente"
    ON "supply_v2_reward_claims" ("rewardId", "customerId")
    WHERE "status" = 'RESERVED';
