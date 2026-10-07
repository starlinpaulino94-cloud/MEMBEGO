-- COMMERCE CORE · Merchant Billing — endurecimiento tras la auditoría del 2026-10-07.
--
-- Tres reglas que el libro no hacía cumplir por sí mismo (solo el servicio):
--
--  1. UNA MONEDA POR CUENTA. El asiento de una comisión llevaba la moneda del
--     pedido y los manuales la de la cuenta; nada impedía sumar dólares a un saldo
--     en pesos. Ahora el disparador del libro rechaza un asiento cuya moneda no sea
--     la de la cuenta (`merchant_billing_configs.currency`).
--  2. EL TIEMPO NO RETROCEDE. Un asiento no puede ser anterior al último de su
--     cuenta. Los cortes delimitan el periodo por fecha pero cuadran por posición:
--     un asiento con posición posterior y fecha anterior dejaba un periodo que no
--     se podía cortar nunca. (El servicio ya escribe `max(ahora, último)`.)
--  3. LAS CLAVES DEL SISTEMA SON DEL SISTEMA. Una clave `commission:…` solo la
--     lleva un asiento de comisión (y viceversa): una clave manual con ese prefijo
--     bloquearía para siempre el cobro o el reverso del pedido. Y un mismo depósito
--     (referencia de pago) no se acredita dos veces en la misma cuenta.
--
-- Aditiva e idempotente: reemplaza una función y añade un CHECK y un índice único
-- parcial. No toca datos. (`migrate diff` no ve disparadores, CHECK ni índices
-- parciales: los cubre `tests/postgres/billing.db.test.ts`.)

CREATE OR REPLACE FUNCTION merchant_ledger_saldo() RETURNS trigger AS $$
DECLARE
    v_seq      INTEGER;
    v_balance  NUMERIC;
    v_ultima   TIMESTAMP(3);
    v_cortado  TIMESTAMP(3);
    v_moneda   TEXT;
BEGIN
    -- Un periodo que ya tiene su corte no recibe asientos nuevos: el corte quedaría desactualizado.
    SELECT max("periodEnd") INTO v_cortado FROM "merchant_statements" WHERE "companyId" = NEW."companyId";
    IF v_cortado IS NOT NULL AND NEW."createdAt" < v_cortado THEN
        RAISE EXCEPTION 'merchant_ledger_corte: el asiento es de antes de %, un periodo que ya tiene su corte.', v_cortado
            USING ERRCODE = 'check_violation';
    END IF;
    -- Una cuenta, una moneda.
    SELECT "currency" INTO v_moneda FROM "merchant_billing_configs" WHERE "companyId" = NEW."companyId";
    IF FOUND AND NEW."currency" <> v_moneda THEN
        RAISE EXCEPTION 'merchant_ledger_moneda: la cuenta cobra en % y el asiento declara %.', v_moneda, NEW."currency"
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT "seq", "balance", "createdAt" INTO v_seq, v_balance, v_ultima
      FROM "merchant_ledger_entries"
     WHERE "companyId" = NEW."companyId"
     ORDER BY "seq" DESC
     LIMIT 1;
    IF NOT FOUND THEN
        v_seq := 0;
        v_balance := 0;
        v_ultima := NULL;
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
    -- El tiempo no retrocede: la fecha del asiento no es anterior a la del último de la cuenta.
    IF v_ultima IS NOT NULL AND NEW."createdAt" < v_ultima THEN
        RAISE EXCEPTION 'merchant_ledger_orden: el asiento es de %, anterior al último de la cuenta (%).', NEW."createdAt", v_ultima
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "merchant_ledger_saldo" ON "merchant_ledger_entries";
CREATE TRIGGER "merchant_ledger_saldo"
    BEFORE INSERT ON "merchant_ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION merchant_ledger_saldo();

-- Una clave `commission:…` ⇔ un asiento que cuelga de una comisión (ambas columnas son NOT NULL: la comparación no puede dar NULL).
DO $$ BEGIN
    ALTER TABLE "merchant_ledger_entries" ADD CONSTRAINT "merchant_ledger_entries_clave_comision"
        CHECK (("referenceType" = 'COMMISSION') = ("idempotencyKey" LIKE 'commission:%'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un depósito, un pago: la referencia de un PAGO es única por cuenta.
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_ledger_entries_pago_referencia"
    ON "merchant_ledger_entries" ("companyId", "referenceId")
    WHERE "referenceType" = 'PAYMENT';
