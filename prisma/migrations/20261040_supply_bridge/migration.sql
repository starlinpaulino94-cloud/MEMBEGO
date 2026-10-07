-- COMMERCE CORE · el puente Supply → Catálogo (Fase 2.5 del Plan Maestro).
--
-- Las ofertas de Supply V2 son de Membego, no de una empresa, y un ítem del
-- catálogo necesita dueño. Se designa UNA empresa «de la casa»
-- (`companies.esCasaMembego`) y los ítems puente (`source = 'SUPPLY'`) cuelgan
-- de ella, cada uno ligado a su oferta (`catalog_items.supplyV2OfferId`).
--
-- ADITIVA E IDEMPOTENTE. Dos columnas nuevas con valor por defecto (todas las
-- filas existentes quedan «no es la casa» y «sin oferta»), una FK y dos reglas.
-- Por sí sola no cambia nada visible: no hay empresa de la casa designada, así
-- que el puente no sincroniza nada.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "esCasaMembego" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "supplyV2OfferId" TEXT;

-- Una oferta tiene a lo sumo un ítem.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_supplyV2OfferId_key"
  ON "catalog_items" ("supplyV2OfferId");

-- A lo sumo UNA empresa de la casa (índice único parcial: Prisma no sabe expresarlo).
CREATE UNIQUE INDEX IF NOT EXISTS "companies_una_casa_membego"
  ON "companies" ("esCasaMembego") WHERE "esCasaMembego";

-- RESTRICT: una oferta con ítem puente no se borra (las ofertas no se borran).
DO $$ BEGIN
    ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_supplyV2OfferId_fkey"
      FOREIGN KEY ("supplyV2OfferId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- `source = 'SUPPLY'` ⇔ el ítem refleja una oferta. Un ítem puente sin oferta no
-- tendría de dónde sincronizarse; una oferta colgada de un ítem de la empresa
-- lo volvería editable por quien no es su dueño.
DO $$ BEGIN
    ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_origen_oferta"
      CHECK (("source" = 'SUPPLY') = ("supplyV2OfferId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
