-- SUPPLIER & FULFILLMENT COMMERCE · Slice 1 · enums del acceso operativo del proveedor.
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- nuevo en la MISMA transacción que lo crea (la siguiente, `20261057`, usa
-- `SupplyV2SupplierAccessStatus` en una columna con DEFAULT).
--
-- Todo aditivo e idempotente.

DO $$ BEGIN
    CREATE TYPE "SupplyV2SupplierAccessStatus" AS ENUM ('DRAFT', 'INVITED', 'ACTIVATION_PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Bitácora: lo que el superadmin y el proveedor hacen con el acceso.
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SUPPLIER_INVITED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SUPPLIER_ACCESS_CHANGED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SUPPLIER_TERMS_ACCEPTED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SUPPLIER_QR_TESTED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SUPPLIER_READINESS_WAIVED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_SUPPLIER_STAFF_INVITED';
END $$;
