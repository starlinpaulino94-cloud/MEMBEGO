-- COMMERCE CORE · Merchant Billing — la CUOTA de una oferta con presupuesto (Fase 5).
--
-- Un canje de una oferta (Deal) cobra la cuota que la oferta fijó al crearse (CPA), no la
-- que saldría del modelo de cobro de la empresa ni de la base del pedido: una oferta gratis
-- (base 0) también paga su cuota. Para que la base lo distinga sin conocer las ofertas:
--
--  · `merchant_commissions.dealId` (texto opaco, sin FK: Merchant Billing no depende de las
--    ofertas ni al revés) marca la comisión como cuota de oferta;
--  · la regla «qué modelo decidió qué tipo» (`merchant_commissions_modelo`) acepta una
--    comisión con `dealId` solo si es CPA_FIXED; sin `dealId` sigue siendo la de siempre
--    (CPA_FIXED, PERCENTAGE, o HYBRID según el nivel de verificación);
--  · el disparador de la comisión exige que el pedido haya nacido de ESA oferta (su
--    atribución es PROMOTION_CLAIM con ese id) y que `dealId` no cambie después.
--
-- ADITIVA E IDEMPOTENTE: una columna anulable, un índice, un CHECK que se reemplaza por otro
-- más amplio y una función que se reemplaza. No toca datos (las comisiones existentes tienen
-- `dealId` nulo y cumplen la misma regla de antes).

ALTER TABLE "merchant_commissions" ADD COLUMN IF NOT EXISTS "dealId" TEXT;
CREATE INDEX IF NOT EXISTS "merchant_commissions_dealId_idx" ON "merchant_commissions" ("dealId");

ALTER TABLE "merchant_commissions" DROP CONSTRAINT IF EXISTS "merchant_commissions_modelo";
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_modelo"
      CHECK (("dealId" IS NOT NULL AND "type" = 'CPA_FIXED')
          OR ("dealId" IS NULL AND (
                 ("feeModel" = 'CPA_FIXED' AND "type" = 'CPA_FIXED')
              OR ("feeModel" = 'PERCENTAGE' AND "type" = 'PERCENTAGE')
              OR ("feeModel" = 'HYBRID'
                  AND (("type" = 'PERCENTAGE') = ("verificationLevel" IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED')))))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION merchant_commissions_reglas() RETURNS trigger AS $$
DECLARE
    o RECORD;
    e RECORD;
    a RECORD;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'merchant_inmutable: una comisión no se borra; se revierte con un asiento (comisión %).', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT "origin", "sourceType", "status", "commissionableBase", "verificationLevel", "currency"
          INTO o FROM "membego_orders" WHERE "id" = NEW."orderId" AND "companyId" = NEW."companyId";
        IF NOT FOUND THEN
            RAISE EXCEPTION 'merchant_comision: el pedido % no existe en esta empresa.', NEW."orderId"
                USING ERRCODE = 'check_violation';
        END IF;
        IF o."origin" = 'SUPPLY' OR o."sourceType" IS NOT DISTINCT FROM 'SUPPLY_V2_CUSTOMER_ORDER' THEN
            RAISE EXCEPTION 'merchant_comision: el pedido % envuelve una compra de Supply; esa ganancia se liquida por Supply Economics, no por Merchant Billing.', NEW."orderId"
                USING ERRCODE = 'check_violation';
        END IF;
        IF o."status" <> 'COMPLETED' THEN
            RAISE EXCEPTION 'merchant_comision: el pedido % está % y solo un pedido COMPLETED genera comisión.', NEW."orderId", o."status"
                USING ERRCODE = 'check_violation';
        END IF;
        IF o."commissionableBase" <> NEW."baseAmount" OR o."verificationLevel" <> NEW."verificationLevel" OR o."currency" <> NEW."currency" THEN
            RAISE EXCEPTION 'merchant_comision: la base, el nivel de verificación y la moneda de la comisión deben ser los del pedido %.', NEW."orderId"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" <> 'CONFIRMED' THEN
            RAISE EXCEPTION 'merchant_comision: una comisión nace CONFIRMED, no %.', NEW."status"
                USING ERRCODE = 'check_violation';
        END IF;
        -- La cuota de una oferta (dealId) solo cuelga de un pedido que nació de ESA oferta: la
        -- atribución del pedido lo dice. (Merchant Billing no conoce las ofertas: solo lee el pedido.)
        IF NEW."dealId" IS NOT NULL THEN
            SELECT "channel", "promotionId" INTO a FROM "order_attributions" WHERE "orderId" = NEW."orderId";
            IF NOT FOUND OR a."channel" <> 'PROMOTION_CLAIM' OR a."promotionId" IS DISTINCT FROM NEW."dealId" THEN
                RAISE EXCEPTION 'merchant_comision: la cuota de la oferta % exige un pedido con la atribución PROMOTION_CLAIM de esa oferta.', NEW."dealId"
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
        SELECT "type", "amount", "referenceType", "referenceId", "currency"
          INTO e FROM "merchant_ledger_entries" WHERE "id" = NEW."ledgerEntryId" AND "companyId" = NEW."companyId";
        IF NOT FOUND
           OR e."amount" <> NEW."amount"
           OR e."referenceType" <> 'COMMISSION' OR e."referenceId" <> NEW."id"
           OR e."currency" <> NEW."currency"
           OR e."type" <> (CASE WHEN NEW."type" = 'CPA_FIXED' THEN 'REDEMPTION_FEE' ELSE 'ORDER_FEE' END)::"MerchantLedgerEntryType" THEN
            RAISE EXCEPTION 'merchant_comision: el asiento de la comisión % no existe o no coincide en tipo, monto o referencia.', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."orderId" <> OLD."orderId"
       OR NEW."type" <> OLD."type" OR NEW."feeModel" <> OLD."feeModel" OR NEW."verificationLevel" <> OLD."verificationLevel"
       OR NEW."baseAmount" <> OLD."baseAmount" OR NEW."rate" IS DISTINCT FROM OLD."rate"
       OR NEW."amount" <> OLD."amount" OR NEW."currency" <> OLD."currency"
       OR NEW."dealId" IS DISTINCT FROM OLD."dealId"
       OR NEW."ledgerEntryId" <> OLD."ledgerEntryId" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'merchant_inmutable: la comisión % no cambia lo que cobró.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" = 'REVERSED' AND (NEW."status" <> OLD."status" OR NEW."reversalEntryId" IS DISTINCT FROM OLD."reversalEntryId"
                                      OR NEW."reversedAt" IS DISTINCT FROM OLD."reversedAt") THEN
        RAISE EXCEPTION 'merchant_inmutable: la comisión % ya está revertida.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" = 'CONFIRMED' AND NEW."status" = 'REVERSED' THEN
        SELECT "status" INTO o FROM "membego_orders" WHERE "id" = NEW."orderId" AND "companyId" = NEW."companyId";
        IF NOT FOUND OR o."status" <> 'REFUNDED' THEN
            RAISE EXCEPTION 'merchant_comision: la comisión % solo se revierte con el pedido reembolsado.', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "type", "amount", "referenceType", "referenceId", "currency"
          INTO e FROM "merchant_ledger_entries" WHERE "id" = NEW."reversalEntryId" AND "companyId" = NEW."companyId";
        IF NOT FOUND
           OR e."type" <> 'REFUND' OR e."amount" <> -NEW."amount"
           OR e."referenceType" <> 'COMMISSION' OR e."referenceId" <> NEW."id"
           OR e."currency" <> NEW."currency" THEN
            RAISE EXCEPTION 'merchant_comision: el asiento de reverso de la comisión % no existe o no es el contrario exacto.', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW."status" <> OLD."status" THEN
        RAISE EXCEPTION 'merchant_comision: la comisión % no puede pasar de % a %.', OLD."id", OLD."status", NEW."status"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "merchant_commissions_reglas" ON "merchant_commissions";
CREATE TRIGGER "merchant_commissions_reglas"
    BEFORE INSERT OR UPDATE OR DELETE ON "merchant_commissions"
    FOR EACH ROW EXECUTE FUNCTION merchant_commissions_reglas();
