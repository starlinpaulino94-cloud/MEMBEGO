-- SUPPLIER & FULFILLMENT COMMERCE · Slices 5–8 · visita atribuida a Membego, ventas
-- adicionales, comisión en el libro de Merchant Billing y disputas (§22–§38, §55–§56, §63).
--
-- QUÉ CAMBIA
--   · `membego_visits`: cuando un cliente llega POR Membego (canje de Supply, pedido del
--     marketplace, oferta) se abre una visita con su origen, su documento fuente, la política
--     contractual congelada (tasa de extras, ventana de atribución, confirmación) y sus totales.
--   · `ancillary_sales` + `ancillary_sale_lines`: lo que el cliente compró DE MÁS durante la
--     visita, con su evidencia (MERCHANT_REPORTED → CUSTOMER_CONFIRMED → PAYMENT_VERIFIED →
--     FISCALLY_RECONCILED), su base comisionable (= el subtotal de los extras; NUNCA la unidad
--     que Membego compró) y los enlaces a sus asientos del libro. Las líneas son inmutables.
--   · `visit_disputes`: «no compré eso». La venta no se borra; se resuelve con asientos.
--   · `supply_v2_agreements`: la política de ventas adicionales (§37), congelada en cada versión.
--   · El libro de Merchant Billing admite el asiento ANCILLARY_FEE con referencia
--     ANCILLARY_SALE y clave `ancillary:<venta>`: el MISMO libro y la MISMA cuenta por empresa.
--     Supply Economics (obligaciones, liquidaciones, ledger de lotes) no se toca.
--
-- INVARIANTES EN LA BASE (§63): las cubre el final del archivo.
-- Aditiva e idempotente.

ALTER TABLE "supply_v2_agreements" ADD COLUMN IF NOT EXISTS "ancillaryCommissionEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "supply_v2_agreements" ADD COLUMN IF NOT EXISTS "ancillaryCommissionRate" DECIMAL(5,2);
ALTER TABLE "supply_v2_agreements" ADD COLUMN IF NOT EXISTS "attributionWindowMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "supply_v2_agreements" ADD COLUMN IF NOT EXISTS "receiptRequiredAbove" DECIMAL(12,2);
ALTER TABLE "supply_v2_agreements" ADD COLUMN IF NOT EXISTS "requiresCustomerConfirmation" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "membego_visits" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT,
    "locationId" TEXT,
    "customerUserId" TEXT NOT NULL,
    "origin" "MembegoVisitOrigin" NOT NULL,
    "attributionChannel" "MembegoAttributionChannel",
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "redemptionId" TEXT,
    "orderId" TEXT,
    "status" "MembegoVisitStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "openedByUserId" TEXT,
    "closedByUserId" TEXT,
    "ancillaryCommissionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ancillaryCommissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "attributionWindowMinutes" INTEGER NOT NULL DEFAULT 120,
    "requiresCustomerConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "receiptRequiredAbove" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "agreementId" TEXT,
    "agreementVersionId" TEXT,
    "ancillaryTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "customerConfirmedAt" TIMESTAMP(3),
    "customerConfirmedTotal" DECIMAL(14,2),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membego_visits_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ancillary_sales" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "status" "AncillarySaleStatus" NOT NULL DEFAULT 'REPORTED',
    "evidenceLevel" "AncillaryEvidenceLevel" NOT NULL DEFAULT 'MERCHANT_REPORTED',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DOP',
    "commissionBase" DECIMAL(14,2) NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "commissionStatus" "AncillaryCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "ledgerEntryId" TEXT,
    "reversalEntryId" TEXT,
    "adjustmentEntryId" TEXT,
    "hasCustomLines" BOOLEAN NOT NULL DEFAULT false,
    "reportedByUserId" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerConfirmedAt" TIMESTAMP(3),
    "paymentVerifiedAt" TIMESTAMP(3),
    "paymentVerificationRef" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversalReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ancillary_sales_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ancillary_sale_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "kind" "AncillarySaleLineKind" NOT NULL,
    "supplyCatalogItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "priceSource" TEXT NOT NULL,
    CONSTRAINT "ancillary_sale_lines_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "visit_disputes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "saleId" TEXT,
    "customerUserId" TEXT NOT NULL,
    "status" "VisitDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "customerClaim" TEXT NOT NULL,
    "claimedTotal" DECIMAL(14,2),
    "reportedTotal" DECIMAL(14,2) NOT NULL,
    "resolution" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBase" DECIMAL(14,2),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "visit_disputes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "membego_visits_number_key" ON "membego_visits"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_visits_redemptionId_key" ON "membego_visits"("redemptionId");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_visits_orderId_key" ON "membego_visits"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_visits_idempotencyKey_key" ON "membego_visits"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "membego_visits_companyId_openedAt_idx" ON "membego_visits"("companyId", "openedAt");
CREATE INDEX IF NOT EXISTS "membego_visits_companyId_status_idx" ON "membego_visits"("companyId", "status");
CREATE INDEX IF NOT EXISTS "membego_visits_supplierId_openedAt_idx" ON "membego_visits"("supplierId", "openedAt");
CREATE INDEX IF NOT EXISTS "membego_visits_customerUserId_openedAt_idx" ON "membego_visits"("customerUserId", "openedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_visits_id_companyId_key" ON "membego_visits"("id", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_visits_orderId_companyId_key" ON "membego_visits"("orderId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_number_key" ON "ancillary_sales"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_ledgerEntryId_key" ON "ancillary_sales"("ledgerEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_reversalEntryId_key" ON "ancillary_sales"("reversalEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_adjustmentEntryId_key" ON "ancillary_sales"("adjustmentEntryId");
CREATE INDEX IF NOT EXISTS "ancillary_sales_visitId_idx" ON "ancillary_sales"("visitId");
CREATE INDEX IF NOT EXISTS "ancillary_sales_companyId_reportedAt_idx" ON "ancillary_sales"("companyId", "reportedAt");
CREATE INDEX IF NOT EXISTS "ancillary_sales_companyId_status_idx" ON "ancillary_sales"("companyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_companyId_idempotencyKey_key" ON "ancillary_sales"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_id_companyId_key" ON "ancillary_sales"("id", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_ledgerEntryId_companyId_key" ON "ancillary_sales"("ledgerEntryId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_reversalEntryId_companyId_key" ON "ancillary_sales"("reversalEntryId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "ancillary_sales_adjustmentEntryId_companyId_key" ON "ancillary_sales"("adjustmentEntryId", "companyId");
CREATE INDEX IF NOT EXISTS "ancillary_sale_lines_saleId_idx" ON "ancillary_sale_lines"("saleId");
CREATE INDEX IF NOT EXISTS "ancillary_sale_lines_companyId_idx" ON "ancillary_sale_lines"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "visit_disputes_saleId_key" ON "visit_disputes"("saleId");
CREATE INDEX IF NOT EXISTS "visit_disputes_companyId_status_idx" ON "visit_disputes"("companyId", "status");
CREATE INDEX IF NOT EXISTS "visit_disputes_visitId_idx" ON "visit_disputes"("visitId");
CREATE UNIQUE INDEX IF NOT EXISTS "visit_disputes_saleId_companyId_key" ON "visit_disputes"("saleId", "companyId");
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supply_v2_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_locationId_companyId_fkey" FOREIGN KEY ("locationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "supply_v2_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_orderId_companyId_fkey" FOREIGN KEY ("orderId", "companyId") REFERENCES "membego_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_visitId_companyId_fkey" FOREIGN KEY ("visitId", "companyId") REFERENCES "membego_visits"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_ledgerEntryId_companyId_fkey" FOREIGN KEY ("ledgerEntryId", "companyId") REFERENCES "merchant_ledger_entries"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_reversalEntryId_companyId_fkey" FOREIGN KEY ("reversalEntryId", "companyId") REFERENCES "merchant_ledger_entries"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_adjustmentEntryId_companyId_fkey" FOREIGN KEY ("adjustmentEntryId", "companyId") REFERENCES "merchant_ledger_entries"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sale_lines" ADD CONSTRAINT "ancillary_sale_lines_saleId_companyId_fkey" FOREIGN KEY ("saleId", "companyId") REFERENCES "ancillary_sales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "ancillary_sale_lines" ADD CONSTRAINT "ancillary_sale_lines_supplyCatalogItemId_fkey" FOREIGN KEY ("supplyCatalogItemId") REFERENCES "supply_v2_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "visit_disputes" ADD CONSTRAINT "visit_disputes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "visit_disputes" ADD CONSTRAINT "visit_disputes_visitId_companyId_fkey" FOREIGN KEY ("visitId", "companyId") REFERENCES "membego_visits"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "visit_disputes" ADD CONSTRAINT "visit_disputes_saleId_companyId_fkey" FOREIGN KEY ("saleId", "companyId") REFERENCES "ancillary_sales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "visit_disputes" ADD CONSTRAINT "visit_disputes_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "visit_disputes" ADD CONSTRAINT "visit_disputes_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── El libro de Merchant Billing admite ANCILLARY_FEE / ANCILLARY_SALE ───────────────────
-- Se reescriben los CHECK existentes AÑADIENDO el tipo y la referencia nuevos; nada de lo
-- que valía deja de valer. La clave de una comisión de pedido sigue siendo `commission:`;
-- la de una venta adicional es `ancillary:` y su referencia ANCILLARY_SALE.
ALTER TABLE "merchant_ledger_entries" DROP CONSTRAINT IF EXISTS "merchant_ledger_entries_signo";
ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_signo"
  CHECK (("type" IN ('REDEMPTION_FEE', 'ORDER_FEE', 'ANCILLARY_FEE') AND "amount" > 0)
      OR ("type" IN ('REFUND', 'PAYMENT', 'CREDIT', 'PROMOTIONAL_CREDIT') AND "amount" < 0)
      OR ("type" IN ('ADJUSTMENT', 'VERIFICATION_ADJUSTMENT') AND "amount" <> 0));

ALTER TABLE "merchant_ledger_entries" DROP CONSTRAINT IF EXISTS "merchant_ledger_entries_referencia";
ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_referencia"
  CHECK ("referenceType" IN ('COMMISSION', 'PAYMENT', 'MANUAL', 'STATEMENT', 'ANCILLARY_SALE')
         AND length(btrim("referenceId")) > 0
         AND length(btrim("idempotencyKey")) > 0
         AND ("type" NOT IN ('REDEMPTION_FEE', 'ORDER_FEE', 'VERIFICATION_ADJUSTMENT') OR "referenceType" = 'COMMISSION')
         AND ("type" <> 'REFUND' OR "referenceType" IN ('COMMISSION', 'ANCILLARY_SALE'))
         AND ("type" <> 'ANCILLARY_FEE' OR "referenceType" = 'ANCILLARY_SALE')
         AND ("referenceType" <> 'ANCILLARY_SALE' OR "idempotencyKey" LIKE 'ancillary:%')
         AND ("type" <> 'PAYMENT' OR "referenceType" = 'PAYMENT'));

-- ── Invariantes de la visita y de la venta adicional ───────────────────────────────────────
-- OJO con los NULL: un CHECK que evalúa a NULL se acepta; las reglas van como implicaciones.
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_estado_fechas"
        CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL)
           AND ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
           AND ("status" <> 'CANCELLED' OR length(btrim(coalesce("cancelReason", ''))) > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_politica"
        CHECK ("ancillaryCommissionRate" >= 0 AND "ancillaryCommissionRate" <= 100
           AND "attributionWindowMinutes" > 0
           AND "ancillaryTotal" >= 0 AND "commissionTotal" >= 0
           AND ("receiptRequiredAbove" IS NULL OR "receiptRequiredAbove" >= 0)
           AND ("customerConfirmedAt" IS NULL) = ("customerConfirmedTotal" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Una visita tiene UN documento fuente: redención (Supply) o pedido (marketplace), según su origen.
DO $$ BEGIN
    ALTER TABLE "membego_visits" ADD CONSTRAINT "membego_visits_fuente"
        CHECK (length(btrim("sourceType")) > 0 AND length(btrim("sourceId")) > 0
           AND ("origin" <> 'MEMBEGO_SUPPLY' OR ("redemptionId" IS NOT NULL AND "supplierId" IS NOT NULL))
           AND ("origin" = 'MEMBEGO_SUPPLY' OR "redemptionId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_montos"
        CHECK ("subtotal" >= 0
           AND "commissionBase" >= 0 AND "commissionBase" <= "subtotal"
           AND "commissionRate" >= 0 AND "commissionRate" <= 100
           AND "commissionAmount" >= 0 AND "commissionAmount" <= "commissionBase");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Comisión: POSTED ⇔ asiento; REVERSED ⇒ reverso; el estado de la venta y su reversa van juntos.
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_comision_libro"
        CHECK (("commissionStatus" IN ('POSTED', 'REVERSED')) = ("ledgerEntryId" IS NOT NULL)
           AND ("commissionStatus" <> 'REVERSED' OR "reversalEntryId" IS NOT NULL)
           AND ("reversalEntryId" IS NULL OR "commissionStatus" = 'REVERSED')
           AND ("status" = 'REVERSED') = ("reversedAt" IS NOT NULL)
           AND ("reversedAt" IS NULL OR length(btrim(coalesce("reversalReason", ''))) > 0)
           AND ("status" <> 'REVERSED' OR "commissionStatus" IN ('REVERSED', 'NOT_APPLICABLE')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Evidencia: la confirmación del cliente deja fecha; la verificación de pago deja fecha y referencia (nunca sola).
DO $$ BEGIN
    ALTER TABLE "ancillary_sales" ADD CONSTRAINT "ancillary_sales_evidencia"
        CHECK (("evidenceLevel" <> 'CUSTOMER_CONFIRMED' OR "customerConfirmedAt" IS NOT NULL)
           AND (("evidenceLevel" IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED')) = ("paymentVerifiedAt" IS NOT NULL))
           AND ("paymentVerifiedAt" IS NULL OR length(btrim(coalesce("paymentVerificationRef", ''))) > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ancillary_sale_lines" ADD CONSTRAINT "ancillary_sale_lines_montos"
        CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineTotal" = "unitPrice" * "quantity"
           AND length(btrim("description")) > 0
           AND "priceSource" IN ('CATALOG', 'OPERATOR')
           AND (("kind" = 'CATALOG_ITEM') = ("supplyCatalogItemId" IS NOT NULL))
           AND ("kind" <> 'CATALOG_ITEM' OR "priceSource" = 'CATALOG')
           AND ("kind" <> 'CUSTOM_REPORTED_LINE' OR "priceSource" = 'OPERATOR'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "visit_disputes" ADD CONSTRAINT "visit_disputes_estado"
        CHECK (("status" IN ('RESOLVED_MERCHANT', 'RESOLVED_CUSTOMER', 'DISMISSED')) = ("resolvedAt" IS NOT NULL)
           AND ("resolvedAt" IS NULL OR length(btrim(coalesce("resolution", ''))) > 0)
           AND ("claimedTotal" IS NULL OR "claimedTotal" >= 0)
           AND "reportedTotal" >= 0
           AND ("resolvedBase" IS NULL OR ("resolvedBase" >= 0 AND "resolvedBase" <= "reportedTotal"))
           AND length(btrim("customerClaim")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Las líneas de una venta adicional son INMUTABLES (como las de un pedido) ───────────────
CREATE OR REPLACE FUNCTION ancillary_sale_lines_sin_cambios() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ancillary_sale_lines: una línea de venta adicional no se edita ni se borra (%); corrige con una reversa y una venta nueva.', OLD."id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ancillary_sale_lines_sin_cambios" ON "ancillary_sale_lines";
CREATE TRIGGER "ancillary_sale_lines_sin_cambios"
    BEFORE UPDATE OR DELETE ON "ancillary_sale_lines"
    FOR EACH ROW EXECUTE FUNCTION ancillary_sale_lines_sin_cambios();

-- ── Los asientos de una venta adicional son de SU empresa, de SU tipo y de SU monto ─────────
-- (lo que `merchant_commissions_reglas` hace con los pedidos). La base ya está en la unidad
-- comprada por Membego: una venta adicional NUNCA referencia un pedido ni una redención en el libro.
CREATE OR REPLACE FUNCTION ancillary_sales_reglas() RETURNS trigger AS $$
DECLARE
    e RECORD;
BEGIN
    IF NEW."ledgerEntryId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."ledgerEntryId" IS DISTINCT FROM OLD."ledgerEntryId") THEN
        SELECT "type", "amount", "referenceType", "referenceId", "currency" INTO e
          FROM "merchant_ledger_entries" WHERE "id" = NEW."ledgerEntryId" AND "companyId" = NEW."companyId";
        IF NOT FOUND OR e."type" <> 'ANCILLARY_FEE' OR e."referenceType" <> 'ANCILLARY_SALE' OR e."referenceId" <> NEW."id"
           OR e."amount" <> NEW."commissionAmount" OR e."currency" <> NEW."currency" THEN
            RAISE EXCEPTION 'ancillary_sales: el asiento de la comisión de la venta % no existe o no coincide en tipo, monto, moneda o referencia.', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW."reversalEntryId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."reversalEntryId" IS DISTINCT FROM OLD."reversalEntryId") THEN
        SELECT "type", "amount", "referenceType", "referenceId" INTO e
          FROM "merchant_ledger_entries" WHERE "id" = NEW."reversalEntryId" AND "companyId" = NEW."companyId";
        IF NOT FOUND OR e."type" <> 'REFUND' OR e."referenceType" <> 'ANCILLARY_SALE' OR e."referenceId" <> NEW."id" THEN
            RAISE EXCEPTION 'ancillary_sales: el reverso de la venta % no existe o no coincide.', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW."adjustmentEntryId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."adjustmentEntryId" IS DISTINCT FROM OLD."adjustmentEntryId") THEN
        SELECT "type", "amount", "referenceType", "referenceId" INTO e
          FROM "merchant_ledger_entries" WHERE "id" = NEW."adjustmentEntryId" AND "companyId" = NEW."companyId";
        IF NOT FOUND OR e."type" <> 'ADJUSTMENT' OR e."referenceType" <> 'ANCILLARY_SALE' OR e."referenceId" <> NEW."id" THEN
            RAISE EXCEPTION 'ancillary_sales: el ajuste de la venta % no existe o no coincide.', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    -- Identidad inmutable: la venta no cambia de visita, de empresa, de subtotal ni de comisión calculada.
    IF TG_OP = 'UPDATE' AND (NEW."visitId" <> OLD."visitId" OR NEW."companyId" <> OLD."companyId" OR NEW."subtotal" <> OLD."subtotal"
        OR NEW."commissionBase" <> OLD."commissionBase" OR NEW."commissionRate" <> OLD."commissionRate" OR NEW."commissionAmount" <> OLD."commissionAmount"
        OR NEW."reportedByUserId" <> OLD."reportedByUserId" OR NEW."idempotencyKey" <> OLD."idempotencyKey") THEN
        RAISE EXCEPTION 'ancillary_sales: la venta % no cambia de visita, empresa, montos ni comisión: corrige con reversa o ajuste.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ancillary_sales_reglas" ON "ancillary_sales";
CREATE TRIGGER "ancillary_sales_reglas"
    BEFORE INSERT OR UPDATE ON "ancillary_sales"
    FOR EACH ROW EXECUTE FUNCTION ancillary_sales_reglas();

-- Nadie borra una visita, una venta ni una disputa: son historia económica.
CREATE OR REPLACE FUNCTION visitas_membego_sin_borrar() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '%: no se borra (%); se cancela, se reversa o se resuelve.', TG_TABLE_NAME, OLD."id"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "membego_visits_sin_borrar" ON "membego_visits";
CREATE TRIGGER "membego_visits_sin_borrar" BEFORE DELETE ON "membego_visits" FOR EACH ROW EXECUTE FUNCTION visitas_membego_sin_borrar();
DROP TRIGGER IF EXISTS "ancillary_sales_sin_borrar" ON "ancillary_sales";
CREATE TRIGGER "ancillary_sales_sin_borrar" BEFORE DELETE ON "ancillary_sales" FOR EACH ROW EXECUTE FUNCTION visitas_membego_sin_borrar();
DROP TRIGGER IF EXISTS "visit_disputes_sin_borrar" ON "visit_disputes";
CREATE TRIGGER "visit_disputes_sin_borrar" BEFORE DELETE ON "visit_disputes" FOR EACH ROW EXECUTE FUNCTION visitas_membego_sin_borrar();
