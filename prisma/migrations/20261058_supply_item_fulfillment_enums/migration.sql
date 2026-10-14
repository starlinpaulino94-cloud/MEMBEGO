-- SUPPLIER & FULFILLMENT COMMERCE · Slice 3 · enum del respaldo de la unidad (§9).
-- En su propia migración: la siguiente usa el valor nuevo en un DEFAULT.
DO $$ BEGIN
    CREATE TYPE "SupplyV2FulfillmentBacking" AS ENUM ('ON_DEMAND', 'PHYSICAL_RESERVED_STOCK', 'SERVICE_CAPACITY', 'SCHEDULED_CAPACITY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
