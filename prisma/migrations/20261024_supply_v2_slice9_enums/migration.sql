-- MEMBEGO SUPPLY 2.0 · SLICE 9 · enums del núcleo operativo.
--
-- Van en su propia migración porque PostgreSQL no permite usar un valor de
-- enum nuevo en la MISMA transacción que lo crea. Misma razón y mismo patrón
-- que en los Slices 7 y 8.

DO $$ BEGIN
    CREATE TYPE "SupplyV2ExternalEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER', 'IGNORED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "SupplyV2OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Acciones de bitácora del bloque 1. Un evento externo que mueve dinero deja
-- rastro con nombre propio: «se procesó», «se rechazó», «alguien lo reintentó».
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_EXTERNAL_EVENT_RECEIVED';
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_EXTERNAL_EVENT_PROCESSED';
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_EXTERNAL_EVENT_IGNORED';
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_EXTERNAL_EVENT_FAILED';
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_EXTERNAL_EVENT_DEAD_LETTER';
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_EXTERNAL_EVENT_RETRIED';
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OUTBOX_DEAD_LETTER';
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_OUTBOX_RETRIED';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
