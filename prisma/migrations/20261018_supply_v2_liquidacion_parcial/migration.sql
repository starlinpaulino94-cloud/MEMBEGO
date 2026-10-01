-- MEMBEGO SUPPLY 2.0 · CORRECCIÓN: UNA OBLIGACIÓN PAGADA A MEDIAS SÍ SE LIQUIDA
--
-- `obligacionesLiquidablesEnTx` admite obligaciones PARTIALLY_PAID y escribe la
-- línea con el SALDO (`outstandingAmount`), pero el CHECK exigía la igualdad
-- `supplierNet = grossAmount − supplierDiscountAmount − commissionAmount`, que
-- solo se cumple si no se había pagado nada. En cuanto un proveedor tenía una
-- entrega con un anticipo aplicado, generar su liquidación moría con un error
-- crudo de PostgreSQL y TODO el periodo quedaba sin liquidar.
--
-- La línea y la cabecera guardan ahora lo ya pagado, y la identidad cierra
-- exacta en vez de relajarse a una desigualdad (que dejaría pasar un neto más
-- bajo por error):
--
--   supplierNet = grossAmount − supplierDiscountAmount − commissionAmount − alreadyPaidAmount
--
-- Aditiva e idempotente. Las filas anteriores llevan `alreadyPaid = 0`, así que
-- la identidad nueva coincide con la vieja y ninguna liquidación existente se
-- queda fuera del CHECK.

ALTER TABLE "supply_v2_settlement_lines" ADD COLUMN IF NOT EXISTS "alreadyPaidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "supply_v2_settlements" ADD COLUMN IF NOT EXISTS "alreadyPaidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "supply_v2_settlement_lines" DROP CONSTRAINT IF EXISTS "supply_v2_settlement_lines_money";
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlement_lines" ADD CONSTRAINT "supply_v2_settlement_lines_money"
        CHECK (
            "grossAmount" >= 0 AND "commissionAmount" >= 0 AND "supplierNet" >= 0
            AND "contractualAmount" >= 0 AND "supplierDiscountAmount" >= 0 AND "membegoSubsidyAmount" >= 0
            AND "customerPaidAmount" >= 0 AND "alreadyPaidAmount" >= 0
            AND "supplierNet" = "grossAmount" - "supplierDiscountAmount" - "commissionAmount" - "alreadyPaidAmount"
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "supply_v2_settlements" DROP CONSTRAINT IF EXISTS "supply_v2_settlements_money";
DO $$ BEGIN
    ALTER TABLE "supply_v2_settlements" ADD CONSTRAINT "supply_v2_settlements_money"
        CHECK (
            "grossSales" >= 0 AND "commissionAmount" >= 0 AND "supplierNet" >= 0 AND "paidAmount" >= 0
            AND "contractualValue" >= 0 AND "supplierDiscountTotal" >= 0 AND "membegoSubsidyTotal" >= 0
            AND "customerPaidTotal" >= 0 AND "alreadyPaidTotal" >= 0
            AND "supplierNet" = "grossSales" - "supplierDiscountTotal" - "commissionAmount" - "alreadyPaidTotal"
            AND "paidAmount" <= "supplierNet"
            AND "periodEnd" > "periodStart"
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
