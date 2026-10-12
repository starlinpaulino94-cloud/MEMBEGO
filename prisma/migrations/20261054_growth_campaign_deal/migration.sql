-- Marketing campaigns distribute a tenant-owned Deal; its Promotion is reached through Deal.
-- Composite uniqueness and FK keep campaign and deal in the same company.

ALTER TABLE "marketing_campaigns"
  ADD CONSTRAINT "marketing_campaigns_id_companyId_key" UNIQUE ("id", "companyId");

ALTER TABLE "marketing_campaigns"
  ADD COLUMN "dealId" TEXT;

CREATE INDEX "marketing_campaigns_dealId_idx" ON "marketing_campaigns"("dealId");

ALTER TABLE "marketing_campaigns"
  ADD CONSTRAINT "marketing_campaigns_dealId_companyId_fkey"
  FOREIGN KEY ("dealId", "companyId")
  REFERENCES "deals"("id", "companyId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
