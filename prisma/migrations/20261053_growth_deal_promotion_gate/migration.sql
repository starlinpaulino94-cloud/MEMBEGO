-- Growth Commerce Unification, first persisted link: Promotion gates new Deal claims.
-- Deal remains the source of discount, budget, fees, voucher, and redemption economics.

ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_id_companyId_key" UNIQUE ("id", "companyId");

ALTER TABLE "deals"
  ADD COLUMN "promotionId" TEXT;

CREATE INDEX "deals_promotionId_idx" ON "deals"("promotionId");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_promotionId_companyId_fkey"
  FOREIGN KEY ("promotionId", "companyId")
  REFERENCES "promotions"("id", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
