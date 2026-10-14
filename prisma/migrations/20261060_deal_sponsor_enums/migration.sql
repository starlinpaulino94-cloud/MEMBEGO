-- SUPPLIER & FULFILLMENT COMMERCE · Slice 4 · quién financia una oferta de la empresa (§17).
-- En su propia migración: la siguiente usa el valor nuevo en un DEFAULT.
DO $$ BEGIN
    CREATE TYPE "DealSponsor" AS ENUM ('MERCHANT', 'MEMBEGO', 'SHARED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
