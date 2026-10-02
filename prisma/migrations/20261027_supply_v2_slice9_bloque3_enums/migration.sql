-- MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 3 · ENUMS
--
-- Aparte de la migración que los usa, por lo mismo que en el bloque 1:
-- PostgreSQL no permite usar un valor de enum nuevo en la misma transacción
-- que lo crea.

-- UN solo tipo para los seis desacuerdos del bloque: el motivo concreto va en
-- `reasonCode`, que es texto. Seis tipos serían seis migraciones futuras.
ALTER TYPE "SupplyV2FinanceIncidentType" ADD VALUE IF NOT EXISTS 'EXTERNAL_PAYMENT_MISMATCH';

-- Un incidente que alguien está mirando no es uno que nadie ha abierto.
-- NO se añade IGNORED: un falso positivo se RESUELVE (alguien miró y decidió),
-- y tener dos formas de decir «ya está» obligaría a que cada consulta de
-- incidentes abiertos conociera las dos.
ALTER TYPE "SupplyV2FinanceIncidentStatus" ADD VALUE IF NOT EXISTS 'INVESTIGATING';

DO $$ BEGIN
  CREATE TYPE "SupplyV2FinanceIncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplyV2PaymentIncidentResolution" AS ENUM (
    'ACCEPT_INTERNAL', 'ACCEPT_EXTERNAL', 'MARK_FALSE_POSITIVE', 'MANUAL_CORRECTION_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bitácora. `SUPPLY_V2_FINANCE_INCIDENT_CREATED` y `_RESOLVED` ya existen del
-- Slice 5 y se reutilizan: no se duplican acciones.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_PAYMENT_RECONCILIATION_CREATED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_FINANCE_INCIDENT_INVESTIGATING';
