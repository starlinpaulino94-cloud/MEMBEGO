-- COMMERCE CORE · Merchant Billing (Fase 4 del Plan Maestro).
--
-- Lo que cada empresa le debe a Membego por los pedidos que la plataforma le trajo:
-- la comisión de cada pedido, el libro de la cuenta (append-only, con saldo corrido)
-- y el corte de cada periodo.
--
-- ADITIVA E IDEMPOTENTE. No toca ninguna tabla existente. Por sí sola no cambia nada
-- visible: nada escribe en estas tablas sin que un pedido de una empresa con la
-- capacidad PEDIDOS_MEMBEGO (apagada para todos) llegue a COMPLETED.
--
-- SEPARADA de Supply Economics: ninguna FK ni referencia hacia `supply_v2_*`, y el
-- libro rechaza en la base cualquier `referenceType` que no sea de este dominio.
--
-- Los valores nuevos de `AuditAccion` van aparte, en `20261045_merchant_billing_enums`.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "MerchantFeeModel" AS ENUM ('CPA_FIXED', 'PERCENTAGE', 'HYBRID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MerchantBillingCycle" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MerchantBillingStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MerchantCommissionType" AS ENUM ('CPA_FIXED', 'PERCENTAGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MerchantCommissionStatus" AS ENUM ('CONFIRMED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MerchantLedgerEntryType" AS ENUM ('REDEMPTION_FEE', 'ORDER_FEE', 'REFUND', 'ADJUSTMENT', 'PAYMENT', 'CREDIT', 'PROMOTIONAL_CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "merchant_billing_configs" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "feeModel"        "MerchantFeeModel" NOT NULL DEFAULT 'HYBRID',
    "cpaAmount"       DECIMAL(12,2) NOT NULL DEFAULT 100,
    "percentageRate"  DECIMAL(5,2) NOT NULL DEFAULT 8,
    "creditLimit"     DECIMAL(12,2) NOT NULL DEFAULT 5000,
    "billingCycle"    "MerchantBillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currency"        TEXT NOT NULL DEFAULT 'DOP',
    "status"          "MerchantBillingStatus" NOT NULL DEFAULT 'ACTIVE',
    "graceUntil"      TIMESTAMP(3),
    "holdManual"      BOOLEAN NOT NULL DEFAULT false,
    "statusReason"    TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchant_billing_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "merchant_ledger_entries" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "seq"            INTEGER NOT NULL,
    "type"           "MerchantLedgerEntryType" NOT NULL,
    "amount"         DECIMAL(14,2) NOT NULL,
    "balance"        DECIMAL(14,2) NOT NULL,
    "currency"       TEXT NOT NULL DEFAULT 'DOP',
    "referenceType"  TEXT NOT NULL,
    "referenceId"    TEXT NOT NULL,
    "reason"         TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchant_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "merchant_commissions" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,
    "orderId"           TEXT NOT NULL,
    "type"              "MerchantCommissionType" NOT NULL,
    "status"            "MerchantCommissionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "feeModel"          "MerchantFeeModel" NOT NULL,
    "verificationLevel" "MembegoVerificationLevel" NOT NULL,
    "baseAmount"        DECIMAL(12,2) NOT NULL,
    "rate"              DECIMAL(5,2),
    "amount"            DECIMAL(12,2) NOT NULL,
    "currency"          TEXT NOT NULL DEFAULT 'DOP',
    "ledgerEntryId"     TEXT NOT NULL,
    "reversalEntryId"   TEXT,
    "reversedAt"        TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchant_commissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "merchant_statements" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "period"           TEXT NOT NULL,
    "periodStart"      TIMESTAMP(3) NOT NULL,
    "periodEnd"        TIMESTAMP(3) NOT NULL,
    "billingCycle"     "MerchantBillingCycle" NOT NULL,
    "currency"         TEXT NOT NULL DEFAULT 'DOP',
    "openingBalance"   DECIMAL(14,2) NOT NULL,
    "totalOrders"      INTEGER NOT NULL,
    "totalGmv"         DECIMAL(14,2) NOT NULL,
    "totalCommissions" DECIMAL(14,2) NOT NULL,
    "reversals"        DECIMAL(14,2) NOT NULL,
    "adjustments"      DECIMAL(14,2) NOT NULL,
    "credits"          DECIMAL(14,2) NOT NULL,
    "payments"         DECIMAL(14,2) NOT NULL,
    "closingBalance"   DECIMAL(14,2) NOT NULL,
    "amountDue"        DECIMAL(14,2) NOT NULL,
    "entryCount"       INTEGER NOT NULL,
    "generatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchant_statements_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_billing_configs_companyId_key"
  ON "merchant_billing_configs" ("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_billing_configs_id_companyId_key"
  ON "merchant_billing_configs" ("id", "companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_ledger_entries_companyId_seq_key"
  ON "merchant_ledger_entries" ("companyId", "seq");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_ledger_entries_companyId_idempotencyKey_key"
  ON "merchant_ledger_entries" ("companyId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_ledger_entries_id_companyId_key"
  ON "merchant_ledger_entries" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "merchant_ledger_entries_companyId_createdAt_idx"
  ON "merchant_ledger_entries" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "merchant_ledger_entries_companyId_type_idx"
  ON "merchant_ledger_entries" ("companyId", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_orderId_key"
  ON "merchant_commissions" ("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_orderId_companyId_key"
  ON "merchant_commissions" ("orderId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_ledgerEntryId_key"
  ON "merchant_commissions" ("ledgerEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_ledgerEntryId_companyId_key"
  ON "merchant_commissions" ("ledgerEntryId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_reversalEntryId_key"
  ON "merchant_commissions" ("reversalEntryId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_reversalEntryId_companyId_key"
  ON "merchant_commissions" ("reversalEntryId", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_commissions_id_companyId_key"
  ON "merchant_commissions" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "merchant_commissions_companyId_createdAt_idx"
  ON "merchant_commissions" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "merchant_commissions_companyId_status_idx"
  ON "merchant_commissions" ("companyId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_statements_companyId_period_key"
  ON "merchant_statements" ("companyId", "period");
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_statements_id_companyId_key"
  ON "merchant_statements" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "merchant_statements_companyId_periodEnd_idx"
  ON "merchant_statements" ("companyId", "periodEnd");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId) hacia el pedido y entre comisión y asiento: la base
-- rechaza una comisión que junte un pedido o un asiento de otra empresa. Todas
-- RESTRICT: la contabilidad no se borra en cascada.
DO $$ BEGIN
    ALTER TABLE "merchant_billing_configs" ADD CONSTRAINT "merchant_billing_configs_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_statements" ADD CONSTRAINT "merchant_statements_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_orderId_companyId_fkey"
      FOREIGN KEY ("orderId", "companyId") REFERENCES "membego_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_ledgerEntryId_companyId_fkey"
      FOREIGN KEY ("ledgerEntryId", "companyId") REFERENCES "merchant_ledger_entries"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_reversalEntryId_companyId_fkey"
      FOREIGN KEY ("reversalEntryId", "companyId") REFERENCES "merchant_ledger_entries"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- OJO con los NULL: un CHECK que evalúa a NULL SE ACEPTA. Las reglas que comparan
-- columnas anulables van envueltas en coalesce(…, false) o comparan con
-- IS NOT DISTINCT FROM, para que lo que no encaje se rechace.

-- CONFIG. Tarifas y límites en rango; la gracia tiene fecha y solo la gracia la tiene.
DO $$ BEGIN
    ALTER TABLE "merchant_billing_configs" ADD CONSTRAINT "merchant_billing_configs_rangos"
      CHECK ("cpaAmount" >= 0 AND "percentageRate" >= 0 AND "percentageRate" <= 100 AND "creditLimit" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_billing_configs" ADD CONSTRAINT "merchant_billing_configs_gracia"
      CHECK (("status" = 'GRACE_PERIOD') = ("graceUntil" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- LIBRO. El signo del monto lo decide el tipo: lo que se cobra suma a la deuda, lo
-- que se devuelve, se paga o se acredita la baja; un ajuste puede ir a cualquier
-- lado pero nunca en cero y siempre con su motivo. Un asiento en cero no existe.
DO $$ BEGIN
    ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_signo"
      CHECK (("type" IN ('REDEMPTION_FEE', 'ORDER_FEE') AND "amount" > 0)
          OR ("type" IN ('REFUND', 'PAYMENT', 'CREDIT', 'PROMOTIONAL_CREDIT') AND "amount" < 0)
          OR ("type" = 'ADJUSTMENT' AND "amount" <> 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un ajuste o un crédito sin motivo es dinero que se mueve sin explicación.
DO $$ BEGIN
    ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_motivo"
      CHECK ("type" NOT IN ('ADJUSTMENT', 'CREDIT', 'PROMOTIONAL_CREDIT')
             OR length(btrim(coalesce("reason", ''))) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SEPARACIÓN de Supply Economics: el libro solo habla de comisiones, pagos de la
-- empresa, asientos manuales y cortes. Las comisiones y sus reversos SIEMPRE
-- cuelgan de una comisión.
DO $$ BEGIN
    ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_referencia"
      CHECK ("referenceType" IN ('COMMISSION', 'PAYMENT', 'MANUAL', 'STATEMENT')
             AND length(btrim("referenceId")) > 0
             AND length(btrim("idempotencyKey")) > 0
             AND ("type" NOT IN ('REDEMPTION_FEE', 'ORDER_FEE', 'REFUND') OR "referenceType" = 'COMMISSION')
             AND ("type" <> 'PAYMENT' OR "referenceType" = 'PAYMENT'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_seq"
      CHECK ("seq" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- COMISIÓN. Qué modelo decidió qué tipo (HYBRID: porcentaje si y solo si el pago
-- del pedido está verificado — es la misma regla que `modules/billing/domain`),
-- montos coherentes, y el estado va con su reverso.
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_modelo"
      CHECK (("feeModel" = 'CPA_FIXED' AND "type" = 'CPA_FIXED')
          OR ("feeModel" = 'PERCENTAGE' AND "type" = 'PERCENTAGE')
          OR ("feeModel" = 'HYBRID'
              AND (("type" = 'PERCENTAGE') = ("verificationLevel" IN ('PAYMENT_VERIFIED', 'FISCALLY_RECONCILED')))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_montos"
      CHECK ("baseAmount" >= 0 AND "amount" > 0
             AND (("type" = 'CPA_FIXED' AND "rate" IS NULL)
               OR ("type" = 'PERCENTAGE' AND coalesce("rate" > 0 AND "rate" <= 100
                                                      AND "amount" = round("baseAmount" * "rate" / 100, 2), false))));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "merchant_commissions" ADD CONSTRAINT "merchant_commissions_estado_reverso"
      CHECK (("status" = 'REVERSED') = ("reversalEntryId" IS NOT NULL)
             AND ("status" = 'REVERSED') = ("reversedAt" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CORTE. Las cifras se explican solas: el cierre es la apertura más todo lo que
-- pasó en el periodo, y lo debido es el cierre si es positivo.
DO $$ BEGIN
    ALTER TABLE "merchant_statements" ADD CONSTRAINT "merchant_statements_cuadre"
      CHECK ("periodEnd" > "periodStart"
             AND "totalOrders" >= 0 AND "entryCount" >= 0 AND "totalGmv" >= 0
             AND "totalCommissions" >= 0 AND "reversals" <= 0 AND "credits" <= 0 AND "payments" <= 0
             AND "closingBalance" = "openingBalance" + "totalCommissions" + "reversals" + "adjustments" + "credits" + "payments"
             AND "amountDue" = greatest("closingBalance", 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── El libro: saldo corrido y posición sin huecos ───────────────────────────
-- Cada asiento declara su posición (`seq`) y su saldo; la base comprueba que la
-- posición sea la siguiente y que el saldo sea el anterior más el monto, y que no
-- caiga en un periodo cuyo corte ya se emitió. Dos
-- escritores simultáneos no pueden ambos pasar: el segundo choca con el índice
-- único (companyId, seq). (El servicio además serializa por la fila de la config.)
CREATE OR REPLACE FUNCTION merchant_ledger_saldo() RETURNS trigger AS $$
DECLARE
    v_seq     INTEGER;
    v_balance NUMERIC;
    v_cortado TIMESTAMP(3);
BEGIN
    -- Un periodo que ya tiene su corte no recibe asientos nuevos: el corte quedaría desactualizado.
    SELECT max("periodEnd") INTO v_cortado FROM "merchant_statements" WHERE "companyId" = NEW."companyId";
    IF v_cortado IS NOT NULL AND NEW."createdAt" < v_cortado THEN
        RAISE EXCEPTION 'merchant_ledger_corte: el asiento es de antes de %, un periodo que ya tiene su corte.', v_cortado
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT "seq", "balance" INTO v_seq, v_balance
      FROM "merchant_ledger_entries"
     WHERE "companyId" = NEW."companyId"
     ORDER BY "seq" DESC
     LIMIT 1;
    IF NOT FOUND THEN
        v_seq := 0;
        v_balance := 0;
    END IF;
    IF NEW."seq" <> v_seq + 1 THEN
        RAISE EXCEPTION 'merchant_ledger_saldo: el asiento debe ocupar la posición % de la cuenta y declara %.', v_seq + 1, NEW."seq"
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."balance" <> v_balance + NEW."amount" THEN
        RAISE EXCEPTION 'merchant_ledger_saldo: el saldo después del asiento debe ser % (anterior % + monto %) y declara %.',
            v_balance + NEW."amount", v_balance, NEW."amount", NEW."balance"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "merchant_ledger_saldo" ON "merchant_ledger_entries";
CREATE TRIGGER "merchant_ledger_saldo"
    BEFORE INSERT ON "merchant_ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION merchant_ledger_saldo();

-- ── Libro y cortes NO se editan ─────────────────────────────────────────────
-- Un error se corrige con un asiento nuevo que lo contraría. Ni UPDATE, ni DELETE,
-- ni TRUNCATE. (`session_replication_role = replica`, que solo puede poner un
-- superusuario, desactiva los disparadores ordinarios: es la salida de las
-- pruebas y de una intervención deliberada de operaciones, no de la aplicación.)
CREATE OR REPLACE FUNCTION merchant_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'merchant_inmutable: % no admite % (fila %).', TG_TABLE_NAME, TG_OP, COALESCE(OLD."id", '-')
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION merchant_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'merchant_inmutable: % no admite TRUNCATE.', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "merchant_ledger_entries_sin_cambios" ON "merchant_ledger_entries";
CREATE TRIGGER "merchant_ledger_entries_sin_cambios"
    BEFORE UPDATE OR DELETE ON "merchant_ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION merchant_inmutable();
DROP TRIGGER IF EXISTS "merchant_ledger_entries_sin_truncate" ON "merchant_ledger_entries";
CREATE TRIGGER "merchant_ledger_entries_sin_truncate"
    BEFORE TRUNCATE ON "merchant_ledger_entries"
    FOR EACH STATEMENT EXECUTE FUNCTION merchant_sin_truncate();

DROP TRIGGER IF EXISTS "merchant_statements_sin_cambios" ON "merchant_statements";
CREATE TRIGGER "merchant_statements_sin_cambios"
    BEFORE UPDATE OR DELETE ON "merchant_statements"
    FOR EACH ROW EXECUTE FUNCTION merchant_inmutable();
DROP TRIGGER IF EXISTS "merchant_statements_sin_truncate" ON "merchant_statements";
CREATE TRIGGER "merchant_statements_sin_truncate"
    BEFORE TRUNCATE ON "merchant_statements"
    FOR EACH STATEMENT EXECUTE FUNCTION merchant_sin_truncate();

-- ── La comisión coincide con su asiento y con su pedido ─────────────────────
-- Al crearla: el pedido es de la empresa, NO es de Supply (esas ganancias se
-- liquidan por el lado de Supply), está completado, la base es la comisionable del
-- pedido y el asiento que la cobra existe, es del tipo que corresponde y por el
-- mismo monto. Después solo puede pasar de CONFIRMED a REVERSED (con el asiento de
-- reverso por el mismo monto, de signo contrario, y el pedido ya reembolsado); lo
-- demás de la fila no cambia. Nunca se borra.
CREATE OR REPLACE FUNCTION merchant_commissions_reglas() RETURNS trigger AS $$
DECLARE
    o RECORD;
    e RECORD;
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
DROP TRIGGER IF EXISTS "merchant_commissions_sin_truncate" ON "merchant_commissions";
CREATE TRIGGER "merchant_commissions_sin_truncate"
    BEFORE TRUNCATE ON "merchant_commissions"
    FOR EACH STATEMENT EXECUTE FUNCTION merchant_sin_truncate();
