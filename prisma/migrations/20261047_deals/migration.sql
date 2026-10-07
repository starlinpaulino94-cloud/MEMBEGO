-- COMMERCE CORE · Deals con presupuesto (Fase 5 del Plan Maestro — Growth Engine).
--
-- Una oferta (`deals`) es un descuento sobre UNA variante del catálogo con un presupuesto
-- para lo que Membego cobra por cada canje y un tope de clientes; un reclamo
-- (`deal_claims`) es una persona que la obtuvo: su pedido Membego con QR es el voucher.
--
-- ADITIVA E IDEMPOTENTE. Dos tablas nuevas; solo se añade un disparador a
-- `membego_orders` (que no cambia lo que ya hace). Nada escribe aquí hasta que una empresa
-- con la capacidad DEALS_MARKETPLACE (apagada para todas) cree una oferta.
--
-- LO QUE LA BASE HACE CUMPLIR (lo que el servicio ya valida, pero que un error de código o
-- una escritura directa no puede saltarse):
--   · presupuesto y cupos nunca se pasan: gastado + reservado ≤ total, vivos ≤ máximo;
--   · una persona reclama una oferta UNA sola vez (índice único, aunque dos clics lleguen a la vez);
--   · el reclamo y su pedido se mueven juntos: un canje exige el pedido COMPLETED, un
--     vencimiento o una cancelación exigen el pedido CANCELLED, y un pedido de oferta no puede
--     completarse, cancelarse ni reembolsarse sin que su reclamo se liquide;
--   · los contadores de la oferta (cupos vivos, presupuesto reservado y gastado) cuadran con
--     sus reclamos al confirmar la transacción (disparador diferido);
--   · el pedido de un reclamo es del mismo cliente, de la misma empresa, de origen
--     MARKETPLACE y con la atribución PROMOTION_CLAIM de ESA oferta;
--   · la economía de la oferta (variante, descuento, cuota) no cambia al publicarla.
--
-- Los valores nuevos de `AuditAccion` van aparte, en `20261049_deals_enums`; el cambio de
-- Merchant Billing (cuota de oferta), en `20261048_merchant_billing_cuota_de_oferta`.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED', 'COMPLETED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "DealDiscountType" AS ENUM ('PERCENT', 'AMOUNT_OFF', 'FIXED_PRICE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "DealClaimStatus" AS ENUM ('CLAIMED', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "deals" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "title"            TEXT NOT NULL,
    "description"      TEXT,
    "discountType"     "DealDiscountType" NOT NULL,
    "discountValue"    DECIMAL(12,2) NOT NULL,
    "currency"         TEXT NOT NULL DEFAULT 'DOP',
    "status"           "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason"     TEXT,
    "statusChangedAt"  TIMESTAMP(3),
    "publishedAt"      TIMESTAMP(3),
    "startsAt"         TIMESTAMP(3) NOT NULL,
    "endsAt"           TIMESTAMP(3),
    "voucherDays"      INTEGER NOT NULL DEFAULT 7,
    "newCustomersOnly" BOOLEAN NOT NULL DEFAULT false,
    "maxClaims"        INTEGER NOT NULL,
    "claimsActive"     INTEGER NOT NULL DEFAULT 0,
    "feePerRedemption" DECIMAL(12,2) NOT NULL,
    "budgetTotal"      DECIMAL(12,2) NOT NULL,
    "budgetReserved"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "budgetSpent"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdByUserId"  TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "deal_claims" (
    "id"         TEXT NOT NULL,
    "companyId"  TEXT NOT NULL,
    "dealId"     TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId"    TEXT NOT NULL,
    "status"     "DealClaimStatus" NOT NULL DEFAULT 'CLAIMED',
    "fee"        DECIMAL(12,2) NOT NULL,
    "savings"    DECIMAL(12,2) NOT NULL,
    "claimedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "closedAt"   TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deal_claims_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "deals_id_companyId_key" ON "deals" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "deals_companyId_status_idx" ON "deals" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "deals_status_startsAt_endsAt_idx" ON "deals" ("status", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "deals_catalogVariantId_idx" ON "deals" ("catalogVariantId");

CREATE UNIQUE INDEX IF NOT EXISTS "deal_claims_orderId_key" ON "deal_claims" ("orderId");
-- Una persona, una oferta, un reclamo.
CREATE UNIQUE INDEX IF NOT EXISTS "deal_claims_dealId_customerId_key" ON "deal_claims" ("dealId", "customerId");
CREATE UNIQUE INDEX IF NOT EXISTS "deal_claims_orderId_companyId_key" ON "deal_claims" ("orderId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "deal_claims_id_companyId_key" ON "deal_claims" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "deal_claims_companyId_status_expiresAt_idx" ON "deal_claims" ("companyId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "deal_claims_dealId_status_idx" ON "deal_claims" ("dealId", "status");
CREATE INDEX IF NOT EXISTS "deal_claims_customerId_idx" ON "deal_claims" ("customerId");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId): la base rechaza una oferta que junte la variante de otra
-- empresa, o un reclamo con el cliente, la oferta o el pedido de otra. Todas RESTRICT.
DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_dealId_companyId_fkey"
      FOREIGN KEY ("dealId", "companyId") REFERENCES "deals"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_customerId_companyId_fkey"
      FOREIGN KEY ("customerId", "companyId") REFERENCES "clientes"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_orderId_companyId_fkey"
      FOREIGN KEY ("orderId", "companyId") REFERENCES "membego_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- OJO con los NULL: un CHECK que evalúa a NULL SE ACEPTA. Todo lo que se compara aquí
-- son columnas NOT NULL; lo anulable (`publishedAt`, `redeemedAt`, `closedAt`) va con
-- IS NULL / IS NOT NULL, que nunca dan NULL.

-- OFERTA. Presupuesto y cupos en rango y nunca pasados; fechas coherentes.
DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_rangos"
      CHECK (length(btrim("title")) BETWEEN 1 AND 120
             AND "currency" ~ '^[A-Z]{3}$'
             AND "maxClaims" >= 1 AND "claimsActive" >= 0 AND "claimsActive" <= "maxClaims"
             AND "feePerRedemption" > 0
             AND "budgetTotal" > 0 AND "budgetReserved" >= 0 AND "budgetSpent" >= 0
             AND "budgetSpent" + "budgetReserved" <= "budgetTotal"
             AND "voucherDays" BETWEEN 1 AND 60
             AND ("endsAt" IS NULL OR "endsAt" > "startsAt"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_descuento"
      CHECK (("discountType" = 'PERCENT' AND "discountValue" > 0 AND "discountValue" <= 100)
          OR ("discountType" = 'AMOUNT_OFF' AND "discountValue" > 0)
          OR ("discountType" = 'FIXED_PRICE' AND "discountValue" >= 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Un borrador no está publicado; lo que está vivo o terminó, sí lo estuvo.
DO $$ BEGIN
    ALTER TABLE "deals" ADD CONSTRAINT "deals_publicada"
      CHECK (("status" <> 'DRAFT' OR "publishedAt" IS NULL)
         AND ("status" NOT IN ('ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED', 'COMPLETED') OR "publishedAt" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RECLAMO. Cuota positiva, ahorro no negativo, fechas coherentes con el estado.
DO $$ BEGIN
    ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_montos"
      CHECK ("fee" > 0 AND "savings" >= 0 AND "expiresAt" > "claimedAt");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "deal_claims" ADD CONSTRAINT "deal_claims_fechas"
      CHECK (("status" IN ('REDEEMED', 'REFUNDED')) = ("redeemedAt" IS NOT NULL)
         AND ("status" IN ('EXPIRED', 'CANCELLED', 'REFUNDED')) = ("closedAt" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── La oferta: nace borrador, su economía no cambia al publicarla, y solo hay ──
-- ── ciertas transiciones de estado.                                          ──
CREATE OR REPLACE FUNCTION deals_reglas() RETURNS trigger AS $$
DECLARE
    permitida BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'deals_inmutable: la oferta % ya se publicó y no se borra (se archiva).', OLD."id"
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'DRAFT' OR NEW."claimsActive" <> 0 OR NEW."budgetReserved" <> 0 OR NEW."budgetSpent" <> 0 THEN
            RAISE EXCEPTION 'deals_nace: una oferta nace en borrador y sin reclamos ni presupuesto gastado.'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'deals_inmutable: la identidad de la oferta % no cambia.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Publicada, su economía queda fija: lo que se ofreció y lo que cuesta no se reescribe.
    IF OLD."status" <> 'DRAFT' AND (
           NEW."catalogVariantId" <> OLD."catalogVariantId"
        OR NEW."discountType" <> OLD."discountType"
        OR NEW."discountValue" <> OLD."discountValue"
        OR NEW."feePerRedemption" <> OLD."feePerRedemption"
        OR NEW."currency" <> OLD."currency"
        OR NEW."voucherDays" <> OLD."voucherDays"
        OR NEW."newCustomersOnly" <> OLD."newCustomersOnly"
        OR NEW."startsAt" <> OLD."startsAt") THEN
        RAISE EXCEPTION 'deals_inmutable: la oferta % ya se publicó: su descuento, su cuota y su vigencia inicial no cambian.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" <> OLD."status" THEN
        permitida := CASE OLD."status"
            WHEN 'DRAFT'            THEN NEW."status" IN ('ACTIVE', 'ARCHIVED')
            WHEN 'ACTIVE'           THEN NEW."status" IN ('PAUSED', 'BUDGET_EXHAUSTED', 'COMPLETED', 'ARCHIVED')
            WHEN 'PAUSED'           THEN NEW."status" IN ('ACTIVE', 'BUDGET_EXHAUSTED', 'COMPLETED', 'ARCHIVED')
            WHEN 'BUDGET_EXHAUSTED' THEN NEW."status" IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')
            WHEN 'COMPLETED'        THEN NEW."status" IN ('ARCHIVED')
            ELSE false
        END;
        IF NOT permitida THEN
            RAISE EXCEPTION 'deals_estado: la oferta % no puede pasar de % a %.', OLD."id", OLD."status", NEW."status"
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "deals_reglas" ON "deals";
CREATE TRIGGER "deals_reglas"
    BEFORE INSERT OR UPDATE OR DELETE ON "deals"
    FOR EACH ROW EXECUTE FUNCTION deals_reglas();

-- ── El reclamo: coincide con su oferta y su pedido, y solo hay ciertas ─────────
-- ── transiciones, cada una atada al estado del pedido.                    ──
CREATE OR REPLACE FUNCTION deal_claims_reglas() RETURNS trigger AS $$
DECLARE
    o RECORD;
    d RECORD;
    a RECORD;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'deals_inmutable: un reclamo no se borra (reclamo %).', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'CLAIMED' THEN
            RAISE EXCEPTION 'deals_reclamo: un reclamo nace CLAIMED, no %.', NEW."status"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "customerId", "origin", "status" INTO o
          FROM "membego_orders" WHERE "id" = NEW."orderId" AND "companyId" = NEW."companyId";
        IF NOT FOUND THEN
            RAISE EXCEPTION 'deals_reclamo: el pedido % no existe en esta empresa.', NEW."orderId"
                USING ERRCODE = 'check_violation';
        END IF;
        IF o."customerId" <> NEW."customerId" OR o."origin" <> 'MARKETPLACE'
           OR o."status" NOT IN ('AWAITING_MERCHANT', 'IN_PROGRESS', 'READY') THEN
            RAISE EXCEPTION 'deals_reclamo: el pedido % debe ser del cliente, de origen MARKETPLACE y estar abierto.', NEW."orderId"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "channel", "promotionId" INTO a FROM "order_attributions" WHERE "orderId" = NEW."orderId";
        IF NOT FOUND OR a."channel" <> 'PROMOTION_CLAIM' OR a."promotionId" IS DISTINCT FROM NEW."dealId" THEN
            RAISE EXCEPTION 'deals_reclamo: el pedido % debe llevar la atribución PROMOTION_CLAIM de la oferta %.', NEW."orderId", NEW."dealId"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "feePerRedemption" INTO d FROM "deals" WHERE "id" = NEW."dealId" AND "companyId" = NEW."companyId";
        IF NOT FOUND OR d."feePerRedemption" <> NEW."fee" THEN
            RAISE EXCEPTION 'deals_reclamo: la cuota del reclamo debe ser la de la oferta %.', NEW."dealId"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."dealId" <> OLD."dealId"
       OR NEW."customerId" <> OLD."customerId" OR NEW."orderId" <> OLD."orderId"
       OR NEW."fee" <> OLD."fee" OR NEW."savings" <> OLD."savings"
       OR NEW."claimedAt" <> OLD."claimedAt" OR NEW."expiresAt" <> OLD."expiresAt" THEN
        RAISE EXCEPTION 'deals_inmutable: el reclamo % no cambia lo que se reclamó.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" <> OLD."status" THEN
        IF NOT (   (OLD."status" = 'CLAIMED'  AND NEW."status" IN ('REDEEMED', 'EXPIRED', 'CANCELLED'))
                OR (OLD."status" = 'REDEEMED' AND NEW."status" = 'REFUNDED')) THEN
            RAISE EXCEPTION 'deals_reclamo: el reclamo % no puede pasar de % a %.', OLD."id", OLD."status", NEW."status"
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT "status" INTO o FROM "membego_orders" WHERE "id" = NEW."orderId" AND "companyId" = NEW."companyId";
        IF NOT FOUND
           OR (NEW."status" = 'REDEEMED'  AND o."status" <> 'COMPLETED')
           OR (NEW."status" IN ('EXPIRED', 'CANCELLED') AND o."status" <> 'CANCELLED')
           OR (NEW."status" = 'REFUNDED'  AND o."status" <> 'REFUNDED') THEN
            RAISE EXCEPTION 'deals_reclamo: el reclamo % pasa a % pero su pedido está %.', OLD."id", NEW."status", COALESCE(o."status"::text, 'inexistente')
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW."redeemedAt" IS DISTINCT FROM OLD."redeemedAt" OR NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN
        RAISE EXCEPTION 'deals_inmutable: las fechas de cierre del reclamo % no cambian sin cambiar su estado.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "deal_claims_reglas" ON "deal_claims";
CREATE TRIGGER "deal_claims_reglas"
    BEFORE INSERT OR UPDATE OR DELETE ON "deal_claims"
    FOR EACH ROW EXECUTE FUNCTION deal_claims_reglas();

DROP TRIGGER IF EXISTS "deal_claims_sin_truncate" ON "deal_claims";
CREATE OR REPLACE FUNCTION deal_claims_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'deals_inmutable: los reclamos no se vacían con TRUNCATE.'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "deal_claims_sin_truncate"
    BEFORE TRUNCATE ON "deal_claims"
    FOR EACH STATEMENT EXECUTE FUNCTION deal_claims_sin_truncate();

-- ── Los contadores de la oferta cuadran con sus reclamos ────────────────────
-- Al CONFIRMAR la transacción (disparador diferido): cupos vivos = reclamos CLAIMED +
-- REDEEMED; presupuesto reservado = Σ cuota de los CLAIMED; gastado = Σ cuota de los
-- REDEEMED. Se dispara desde la oferta y desde sus reclamos: un contador que no cuadra
-- (un código que mueve uno y olvida el otro) hace fallar la transacción entera.
CREATE OR REPLACE FUNCTION deals_cuadre() RETURNS trigger AS $$
DECLARE
    v_deal    TEXT;
    d         RECORD;
    v_vivos   INTEGER;
    v_reserv  NUMERIC;
    v_gastado NUMERIC;
BEGIN
    IF TG_TABLE_NAME = 'deals' THEN
        v_deal := NEW."id";
    ELSIF TG_OP = 'DELETE' THEN
        v_deal := OLD."dealId";
    ELSE
        v_deal := NEW."dealId";
    END IF;
    SELECT "claimsActive", "budgetReserved", "budgetSpent" INTO d FROM "deals" WHERE "id" = v_deal;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    SELECT count(*) FILTER (WHERE "status" IN ('CLAIMED', 'REDEEMED')),
           coalesce(sum("fee") FILTER (WHERE "status" = 'CLAIMED'), 0),
           coalesce(sum("fee") FILTER (WHERE "status" = 'REDEEMED'), 0)
      INTO v_vivos, v_reserv, v_gastado
      FROM "deal_claims" WHERE "dealId" = v_deal;
    IF d."claimsActive" <> v_vivos OR d."budgetReserved" <> v_reserv OR d."budgetSpent" <> v_gastado THEN
        RAISE EXCEPTION 'deals_cuadre: la oferta % dice % cupos, % reservado y % gastado, pero sus reclamos suman % cupos, % reservado y % gastado.',
            v_deal, d."claimsActive", d."budgetReserved", d."budgetSpent", v_vivos, v_reserv, v_gastado
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "deals_cuadre_oferta" ON "deals";
CREATE CONSTRAINT TRIGGER "deals_cuadre_oferta"
    AFTER INSERT OR UPDATE ON "deals"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION deals_cuadre();

DROP TRIGGER IF EXISTS "deals_cuadre_reclamo" ON "deal_claims";
CREATE CONSTRAINT TRIGGER "deals_cuadre_reclamo"
    AFTER INSERT OR UPDATE ON "deal_claims"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION deals_cuadre();

-- ── Un pedido de oferta no se cierra sin liquidar su reclamo ─────────────────
-- Al confirmar la transacción: si un pedido con reclamo llega a COMPLETED, CANCELLED o
-- REFUNDED, su reclamo ya tiene que estar REDEEMED, EXPIRED/CANCELLED o REFUNDED. Es la
-- otra mitad de la regla del reclamo: no se puede completar un pedido de oferta por un
-- camino que se salte el presupuesto y la cuota (el único camino es el servicio de pedidos,
-- que liquida el reclamo en la misma transacción). No cambia nada de lo que ya hace
-- `membego_orders_reglas`: solo añade una comprobación al final.
CREATE OR REPLACE FUNCTION deals_pedido_cuadra() RETURNS trigger AS $$
DECLARE
    c RECORD;
BEGIN
    IF NEW."status" NOT IN ('COMPLETED', 'CANCELLED', 'REFUNDED') OR NEW."status" = OLD."status" THEN
        RETURN NULL;
    END IF;
    SELECT "status" INTO c FROM "deal_claims" WHERE "orderId" = NEW."id";
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF (NEW."status" = 'COMPLETED' AND c."status" <> 'REDEEMED')
       OR (NEW."status" = 'CANCELLED' AND c."status" NOT IN ('EXPIRED', 'CANCELLED'))
       OR (NEW."status" = 'REFUNDED'  AND c."status" <> 'REFUNDED') THEN
        RAISE EXCEPTION 'deals_pedido: el pedido % (oferta) pasa a % pero su reclamo está %: se liquida en la misma transacción.', NEW."id", NEW."status", c."status"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "deals_pedido_cuadra" ON "membego_orders";
CREATE CONSTRAINT TRIGGER "deals_pedido_cuadra"
    AFTER UPDATE OF "status" ON "membego_orders"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION deals_pedido_cuadra();
