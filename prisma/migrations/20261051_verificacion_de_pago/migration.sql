-- COMMERCE CORE · verificación de pago y ajuste de comisión (sprint de cierre, 2026-10-08).
--
-- QUÉ CORRIGE. Una constancia de pago con método tarjeta/transferencia y una referencia
-- tecleada por un empleado se tomaba como «pago verificado» y, en el modelo HYBRID,
-- decidía cobrar el 8 % en vez del CPA. Es la palabra del negocio, no evidencia
-- financiera. Desde esta migración:
--
--   1. `payment_evidences.source` dice quién respalda la constancia. Lo que registra la
--      empresa es `MERCHANT_REPORTED`; una fuente externa (pasarela firmada, conciliación
--      bancaria, proveedor) la escribe solo el sistema o el superadmin, con `verifiedAt`
--      y `verificationRef` (la base lo exige).
--   2. El nivel `EXTERNAL_PAYMENT_REPORTED` queda entre «confirmado por el cliente» y
--      «pago verificado». El dominio lo deriva; aquí solo existe.
--   3. `merchant_commissions` admite UN ajuste por verificación: si el pago se verifica
--      después de cobrar el CPA, se asienta la diferencia (porcentaje − CPA) con el tipo
--      `VERIFICATION_ADJUSTMENT`, sin tocar lo ya cobrado. El disparador vigila que el
--      ajuste vaya con su asiento exacto, que sea de una comisión CPA/HYBRID sin oferta,
--      que no se repita y que su reverso solo exista con el pedido reembolsado.
--
-- DATOS EXISTENTES (backfill demostrable, no silencioso: deja NOTICE con las cuentas).
-- Antes de esta migración NO existía ningún camino de verificación externa: una
-- constancia solo la escribía `registrarPagoEnTx` (empresa/empleado) o el envoltorio de
-- Supply (`cerrarPedidoExternoEnTx`, con el pago que Supply ya tenía CONFIRMADO). Por eso:
--   · las constancias de pedidos con `sourceType = 'SUPPLY_V2_CUSTOMER_ORDER'` pasan a
--     `PROVIDER_VERIFIED` (la referencia es la compra de Supply; esos pedidos no comisionan
--     en Merchant Billing, así que no cambia ningún cobro);
--   · todas las demás quedan `MERCHANT_REPORTED`, y los pedidos que estaban en
--     `PAYMENT_VERIFIED` por una de ellas bajan a `EXTERNAL_PAYMENT_REPORTED`. Ninguna
--     operación reportada a mano se eleva a verificada.
--   · Las comisiones ya cobradas NO se tocan: son la foto de lo que se decidió entonces.
--     La regla P04 de la conciliación muestra las que, con el nuevo criterio, quedaron
--     cobradas al porcentaje sobre un pago solo reportado.

-- ── 1 · La constancia dice quién la respalda ─────────────────────────────────

ALTER TABLE "payment_evidences"
    ADD COLUMN IF NOT EXISTS "source"           "MembegoPaymentEvidenceSource" NOT NULL DEFAULT 'MERCHANT_REPORTED',
    ADD COLUMN IF NOT EXISTS "verifiedAt"       TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "verificationRef"  TEXT,
    ADD COLUMN IF NOT EXISTS "verifiedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "payment_evidences_companyId_source_idx" ON "payment_evidences"("companyId", "source");

-- Una fuente externa trae su instante y su referencia; la reportada, ninguno de los dos.
DO $$ BEGIN
    ALTER TABLE "payment_evidences" ADD CONSTRAINT "payment_evidences_fuente"
      CHECK (("source" = 'MERCHANT_REPORTED') = ("verifiedAt" IS NULL)
             AND ("source" = 'MERCHANT_REPORTED') = ("verificationRef" IS NULL)
             AND ("verificationRef" IS NULL OR length(btrim("verificationRef")) > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2 · Backfill demostrable ─────────────────────────────────────────────────

DO $$
DECLARE
    n_supply  INT;
    n_bajados INT;
BEGIN
    UPDATE "payment_evidences" p
       SET "source" = 'PROVIDER_VERIFIED', "verifiedAt" = p."recordedAt", "verificationRef" = o."sourceId"
      FROM "membego_orders" o
     WHERE o."id" = p."orderId" AND o."companyId" = p."companyId"
       AND o."sourceType" = 'SUPPLY_V2_CUSTOMER_ORDER' AND o."sourceId" IS NOT NULL
       AND p."source" = 'MERCHANT_REPORTED';
    GET DIAGNOSTICS n_supply = ROW_COUNT;

    UPDATE "membego_orders" o
       SET "verificationLevel" = 'EXTERNAL_PAYMENT_REPORTED'
     WHERE o."verificationLevel" = 'PAYMENT_VERIFIED'
       AND EXISTS (SELECT 1 FROM "payment_evidences" p WHERE p."orderId" = o."id" AND p."source" = 'MERCHANT_REPORTED');
    GET DIAGNOSTICS n_bajados = ROW_COUNT;

    RAISE NOTICE 'Verificación de pago · constancias de Supply marcadas PROVIDER_VERIFIED: %; pedidos PAYMENT_VERIFIED → EXTERNAL_PAYMENT_REPORTED (solo reportados por el negocio): %', n_supply, n_bajados;
END $$;

-- ── 3 · El libro admite el ajuste por verificación ───────────────────────────

ALTER TABLE "merchant_ledger_entries" DROP CONSTRAINT IF EXISTS "merchant_ledger_entries_signo";
ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_signo"
  CHECK (("type" IN ('REDEMPTION_FEE', 'ORDER_FEE') AND "amount" > 0)
      OR ("type" IN ('REFUND', 'PAYMENT', 'CREDIT', 'PROMOTIONAL_CREDIT') AND "amount" < 0)
      OR ("type" IN ('ADJUSTMENT', 'VERIFICATION_ADJUSTMENT') AND "amount" <> 0));

ALTER TABLE "merchant_ledger_entries" DROP CONSTRAINT IF EXISTS "merchant_ledger_entries_motivo";
ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_motivo"
  CHECK ("type" NOT IN ('ADJUSTMENT', 'VERIFICATION_ADJUSTMENT', 'CREDIT', 'PROMOTIONAL_CREDIT')
         OR length(btrim(coalesce("reason", ''))) > 0);

ALTER TABLE "merchant_ledger_entries" DROP CONSTRAINT IF EXISTS "merchant_ledger_entries_referencia";
ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_referencia"
  CHECK ("referenceType" IN ('COMMISSION', 'PAYMENT', 'MANUAL', 'STATEMENT')
         AND length(btrim("referenceId")) > 0
         AND length(btrim("idempotencyKey")) > 0
         AND ("type" NOT IN ('REDEMPTION_FEE', 'ORDER_FEE', 'REFUND', 'VERIFICATION_ADJUSTMENT') OR "referenceType" = 'COMMISSION')
         AND ("type" <> 'PAYMENT' OR "referenceType" = 'PAYMENT'));

-- ── 4 · La comisión registra su ajuste (a lo sumo uno) ───────────────────────

ALTER TABLE "merchant_commissions"
    ADD COLUMN IF NOT EXISTS "verificationAdjustmentAmount"          DECIMAL(12,2),
    ADD COLUMN IF NOT EXISTS "verificationAdjustmentEntryId"         TEXT,
    ADD COLUMN IF NOT EXISTS "verificationAdjustedAt"                TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "verificationRef"                       TEXT,
    ADD COLUMN IF NOT EXISTS "verificationAdjustmentReversalEntryId" TEXT;

-- Los nombres largos van recortados a 63 caracteres EXACTAMENTE como los recorta Prisma (si los
-- recortara PostgreSQL por su cuenta, el diff del esquema vería deriva).
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_verificationAdjustmentEntryId_key" ON "merchant_commissions"("verificationAdjustmentEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_verificationAdjustmentEntryId_companyI_key" ON "merchant_commissions"("verificationAdjustmentEntryId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_verificationAdjustmentReversalEntryId_key" ON "merchant_commissions"("verificationAdjustmentReversalEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_verificationAdjustmentReversalEntryId__key" ON "merchant_commissions"("verificationAdjustmentReversalEntryId", "companyId");

DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_verificationAdjustmentEntryId_company_fkey"
      FOREIGN KEY ("verificationAdjustmentEntryId", "companyId") REFERENCES "merchant_ledger_entries"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_verificationAdjustmentReversalEntryId_fkey"
      FOREIGN KEY ("verificationAdjustmentReversalEntryId", "companyId") REFERENCES "merchant_ledger_entries"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- El ajuste va entero o no va; nunca en cero; solo en una comisión CPA del modelo HYBRID sin
-- cuota de oferta; y su reverso solo existe si existe el ajuste.
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_ajuste_verificacion"
      CHECK (("verificationAdjustmentEntryId" IS NULL) = ("verificationAdjustmentAmount" IS NULL)
             AND ("verificationAdjustmentEntryId" IS NULL) = ("verificationAdjustedAt" IS NULL)
             AND ("verificationAdjustmentEntryId" IS NULL) = ("verificationRef" IS NULL)
             AND ("verificationAdjustmentAmount" IS NULL OR "verificationAdjustmentAmount" <> 0)
             AND ("verificationAdjustmentReversalEntryId" IS NULL OR "verificationAdjustmentEntryId" IS NOT NULL)
             AND ("verificationAdjustmentEntryId" IS NULL
                  OR ("type" = 'CPA_FIXED' AND "feeModel" = 'HYBRID' AND "dealId" IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5 · El disparador de la comisión aprende el ajuste ───────────────────────
-- Igual que en 20261048 (que ya incluía la cuota de oferta sobre 20261044), más: el ajuste
-- se fija UNA vez (de NULL a su valor) con su asiento VERIFICATION_ADJUSTMENT exacto y el
-- pedido ya en PAYMENT_VERIFIED o superior; una vez fijado no cambia; su reverso exige el
-- pedido REFUNDED y el asiento REFUND contrario exacto.

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
        IF NEW."verificationAdjustmentEntryId" IS NOT NULL OR NEW."verificationAdjustmentReversalEntryId" IS NOT NULL THEN
            RAISE EXCEPTION 'merchant_comision: una comisión nace sin ajuste por verificación (comisión %).', NEW."id"
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

    -- El ajuste por verificación: se fija una vez y no cambia.
    IF OLD."verificationAdjustmentEntryId" IS NOT NULL THEN
        IF NEW."verificationAdjustmentEntryId" IS DISTINCT FROM OLD."verificationAdjustmentEntryId"
           OR NEW."verificationAdjustmentAmount" IS DISTINCT FROM OLD."verificationAdjustmentAmount"
           OR NEW."verificationAdjustedAt" IS DISTINCT FROM OLD."verificationAdjustedAt"
           OR NEW."verificationRef" IS DISTINCT FROM OLD."verificationRef" THEN
            RAISE EXCEPTION 'merchant_inmutable: el ajuste por verificación de la comisión % ya está asentado y no cambia.', OLD."id"
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF NEW."verificationAdjustmentEntryId" IS NOT NULL THEN
        IF OLD."status" <> 'CONFIRMED' OR NEW."status" <> 'CONFIRMED' THEN
            RAISE EXCEPTION 'merchant_comision: el ajuste por verificación solo se asienta sobre una comisión CONFIRMED (comisión %).', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "status", "verificationLevel" INTO o FROM "membego_orders" WHERE "id" = NEW."orderId" AND "companyId" = NEW."companyId";
        IF NOT FOUND OR o."status" <> 'COMPLETED' OR o."verificationLevel" NOT IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED') THEN
            RAISE EXCEPTION 'merchant_comision: el ajuste por verificación de la comisión % exige el pedido COMPLETED con el pago verificado por una fuente externa.', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "type", "amount", "referenceType", "referenceId", "currency"
          INTO e FROM "merchant_ledger_entries" WHERE "id" = NEW."verificationAdjustmentEntryId" AND "companyId" = NEW."companyId";
        IF NOT FOUND
           OR e."type" <> 'VERIFICATION_ADJUSTMENT' OR e."amount" <> NEW."verificationAdjustmentAmount"
           OR e."referenceType" <> 'COMMISSION' OR e."referenceId" <> NEW."id"
           OR e."currency" <> NEW."currency" THEN
            RAISE EXCEPTION 'merchant_comision: el asiento del ajuste por verificación de la comisión % no existe o no coincide en tipo, monto o referencia.', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- El reverso del ajuste: solo con el ajuste asentado, el pedido reembolsado y el asiento contrario exacto; una vez puesto no cambia.
    IF OLD."verificationAdjustmentReversalEntryId" IS NOT NULL THEN
        IF NEW."verificationAdjustmentReversalEntryId" IS DISTINCT FROM OLD."verificationAdjustmentReversalEntryId" THEN
            RAISE EXCEPTION 'merchant_inmutable: el reverso del ajuste de la comisión % ya está asentado.', OLD."id"
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF NEW."verificationAdjustmentReversalEntryId" IS NOT NULL THEN
        IF NEW."verificationAdjustmentEntryId" IS NULL THEN
            RAISE EXCEPTION 'merchant_comision: la comisión % no tiene ajuste que revertir.', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "status" INTO o FROM "membego_orders" WHERE "id" = NEW."orderId" AND "companyId" = NEW."companyId";
        IF NOT FOUND OR o."status" <> 'REFUNDED' THEN
            RAISE EXCEPTION 'merchant_comision: el ajuste de la comisión % solo se revierte con el pedido reembolsado.', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "type", "amount", "referenceType", "referenceId", "currency"
          INTO e FROM "merchant_ledger_entries" WHERE "id" = NEW."verificationAdjustmentReversalEntryId" AND "companyId" = NEW."companyId";
        IF NOT FOUND
           OR e."type" <> 'REFUND' OR e."amount" <> -NEW."verificationAdjustmentAmount"
           OR e."referenceType" <> 'COMMISSION' OR e."referenceId" <> NEW."id"
           OR e."currency" <> NEW."currency" THEN
            RAISE EXCEPTION 'merchant_comision: el asiento de reverso del ajuste de la comisión % no existe o no es el contrario exacto.', NEW."id"
                USING ERRCODE = 'check_violation';
        END IF;
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
        -- Con ajuste asentado, revertir la comisión exige revertir también el ajuste en la misma operación.
        IF NEW."verificationAdjustmentEntryId" IS NOT NULL AND NEW."verificationAdjustmentReversalEntryId" IS NULL THEN
            RAISE EXCEPTION 'merchant_comision: la comisión % tiene un ajuste por verificación; se revierte junto con ella.', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW."status" <> OLD."status" THEN
        RAISE EXCEPTION 'merchant_comision: la comisión % no puede pasar de % a %.', OLD."id", OLD."status", NEW."status"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
