-- ============================================================================
-- MEMBEGO SUPPLY 2.0 · VERTICAL SLICE 5 (1/2) — ENUMS
-- ============================================================================
--
-- Solo tipos y valores nuevos. Va en una migración APARTE porque PostgreSQL no
-- permite usar un valor recién añadido a un enum (COMMISSION en
-- SupplyV2OfferSource) dentro de la misma transacción que lo añade, y la
-- migración 2/2 lo usa en sus CHECK. Idempotente.
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2AvailabilityMode" AS ENUM ('UNLIMITED', 'FIXED_QUANTITY', 'CAPACITY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2CommissionReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2SettlementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2SettlementFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ReconciliationKind" AS ENUM ('SUPPLY', 'COMMISSION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2ResolutionType" AS ENUM ('ACCEPT_INTERNAL', 'ACCEPT_SUPPLIER', 'ADJUSTED', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2FinanceIncidentType" AS ENUM ('REDEMPTION_REVERSED_AFTER_PAYMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SupplyV2FinanceIncidentStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_COMMISSION_OFFER_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_COMMISSION_ORDER_PAID';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_COMMISSION_OBLIGATION_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SETTLEMENT_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SETTLEMENT_APPROVED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SETTLEMENT_PAYMENT_APPLIED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SETTLEMENT_PAID';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SETTLEMENT_CANCELLED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_COMMISSION_RECONCILIATION_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_COMMISSION_RECONCILIATION_RESOLVED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_FINANCE_INCIDENT_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_FINANCE_INCIDENT_RESOLVED';

-- AlterEnum
ALTER TYPE "SupplyV2EconomicEventType" ADD VALUE IF NOT EXISTS 'COMMISSION_REVENUE';

-- AlterEnum
ALTER TYPE "SupplyV2OfferSource" ADD VALUE IF NOT EXISTS 'COMMISSION';

-- AlterEnum
ALTER TYPE "SupplyV2ReconciliationLineType" ADD VALUE IF NOT EXISTS 'SETTLEMENT';
