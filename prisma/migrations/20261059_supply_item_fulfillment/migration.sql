-- SUPPLIER & FULFILLMENT COMMERCE · Slice 3 · el ítem del proveedor sabe cómo
-- se respalda (§9), su capacidad diaria (§10), si se vende como EXTRA en una
-- visita (§26) y a qué ítem del catálogo unificado corresponde cuando el
-- proveedor ya es Merchant (§20). Aditiva e idempotente; el ledger de lotes no
-- cambia: 1.000 unidades compradas siguen siendo 1.000 derechos en el ledger.

ALTER TABLE "supply_v2_catalog_items" ADD COLUMN IF NOT EXISTS "catalogItemId" TEXT;
ALTER TABLE "supply_v2_catalog_items" ADD COLUMN IF NOT EXISTS "dailyCapacity" INTEGER;
ALTER TABLE "supply_v2_catalog_items" ADD COLUMN IF NOT EXISTS "fulfillmentBacking" "SupplyV2FulfillmentBacking" NOT NULL DEFAULT 'ON_DEMAND';
ALTER TABLE "supply_v2_catalog_items" ADD COLUMN IF NOT EXISTS "sellableAsExtra" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "supply_v2_catalog_items_supplierId_sellableAsExtra_idx" ON "supply_v2_catalog_items"("supplierId", "sellableAsExtra");

DO $$ BEGIN
    ALTER TABLE "supply_v2_catalog_items" ADD CONSTRAINT "supply_v2_catalog_items_catalogItemId_fkey"
        FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- La capacidad diaria, si se escribe, es positiva.
DO $$ BEGIN
    ALTER TABLE "supply_v2_catalog_items" ADD CONSTRAINT "supply_v2_catalog_items_capacidad_positiva"
        CHECK ("dailyCapacity" IS NULL OR "dailyCapacity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
