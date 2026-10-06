-- MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 3
--
-- ADITIVA, y con un cuidado concreto: hay incidentes de Slices anteriores en
-- producción y ninguno se toca. Lo único que se relaja es `supplierId`, que
-- pasa a admitir NULL —ampliar nunca invalida una fila existente—, y un CHECK
-- condicionado al tipo sostiene la regla que antes sostenía el NOT NULL.
--
-- Ninguna migración anterior se edita.

-- ── 1 · el incidente, extendido ────────────────────────────────────────────

-- Un aviso de pago de una pasarela no es dinero que Membego le deba a un
-- proveedor: es lo que un CLIENTE le paga a Membego, y puede llegar para una
-- referencia que no existe. Rellenar la columna con un «proveedor sistema»
-- sería mentir en la clave foránea.
ALTER TABLE "supply_v2_finance_incidents" ALTER COLUMN "supplierId" DROP NOT NULL;

ALTER TABLE "supply_v2_finance_incidents"
  ADD COLUMN IF NOT EXISTS "severity" "SupplyV2FinanceIncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "reasonCode" TEXT,
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "externalTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalEventRowId" TEXT,
  ADD COLUMN IF NOT EXISTS "orderId" TEXT,
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT,
  ADD COLUMN IF NOT EXISTS "internalStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "externalStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT,
  ADD COLUMN IF NOT EXISTS "resolution" "SupplyV2PaymentIncidentResolution";

-- La identidad estable del problema. Único, y NULL en todo lo histórico:
-- PostgreSQL admite varios NULL en un índice único, así que el pasado no se
-- altera y el futuro no puede duplicar un incidente.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_finance_incidents_dedupeKey_key"
  ON "supply_v2_finance_incidents" ("dedupeKey");

CREATE INDEX IF NOT EXISTS "supply_v2_finance_incidents_status_severity_createdAt_idx"
  ON "supply_v2_finance_incidents" ("status", "severity", "createdAt");
CREATE INDEX IF NOT EXISTS "supply_v2_finance_incidents_type_status_idx"
  ON "supply_v2_finance_incidents" ("type", "status");
CREATE INDEX IF NOT EXISTS "supply_v2_finance_incidents_orderId_idx"
  ON "supply_v2_finance_incidents" ("orderId");
CREATE INDEX IF NOT EXISTS "supply_v2_finance_incidents_provider_externalTransactionId_idx"
  ON "supply_v2_finance_incidents" ("provider", "externalTransactionId");
CREATE INDEX IF NOT EXISTS "supply_v2_finance_incidents_correlationId_idx"
  ON "supply_v2_finance_incidents" ("correlationId");

ALTER TABLE "supply_v2_finance_incidents"
  ADD CONSTRAINT "supply_v2_finance_incidents_externalEventRowId_fkey"
  FOREIGN KEY ("externalEventRowId") REFERENCES "supply_v2_external_events"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "supply_v2_finance_incidents"
  ADD CONSTRAINT "supply_v2_finance_incidents_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- LO QUE EL NOT NULL SOSTENÍA, AHORA CONDICIONADO AL TIPO.
--
-- Un incidente de proveedor sigue EXIGIENDO proveedor: esa regla no se pierde
-- al relajar la columna. Y un incidente de pago externo exige las dos cosas que
-- lo hacen investigable: de quién vino y por qué no cuadra.
ALTER TABLE "supply_v2_finance_incidents"
  DROP CONSTRAINT IF EXISTS "supply_v2_finance_incidents_shape_slice9";
ALTER TABLE "supply_v2_finance_incidents"
  ADD CONSTRAINT "supply_v2_finance_incidents_shape_slice9" CHECK (
    -- El proveedor es obligatorio en lo que es de un proveedor.
    ("type" <> 'REDEMPTION_REVERSED_AFTER_PAYMENT' OR "supplierId" IS NOT NULL)
    -- Un pago externo sin proveedor ni motivo no se puede investigar.
    AND ("type" <> 'EXTERNAL_PAYMENT_MISMATCH'
         OR ("provider" IS NOT NULL AND "reasonCode" IS NOT NULL))
    -- Cerrar un incidente de pago externo exige decir CÓMO se cerró. No se
    -- impone a lo histórico, que se resolvió cuando esa columna no existía.
    AND ("type" <> 'EXTERNAL_PAYMENT_MISMATCH' OR "status" <> 'RESOLVED'
         OR "resolution" IS NOT NULL));

-- ── 2 · la comprobación de un pago externo ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "supply_v2_payment_reconciliations" (
    "id"                    TEXT NOT NULL,
    "provider"              TEXT NOT NULL,
    "externalTransactionId" TEXT,
    "externalEventRowId"    TEXT,
    "orderId"               TEXT,
    "correlationId"         TEXT,
    "expectedAmount"        DECIMAL(14,2),
    "reportedAmount"        DECIMAL(14,2),
    "expectedCurrency"      TEXT,
    "reportedCurrency"      TEXT,
    "differenceAmount"      DECIMAL(14,2),
    "internalStatus"        TEXT,
    "externalStatus"        TEXT,
    "outcome"               TEXT NOT NULL,
    "reasonCode"            TEXT,
    "severity"              "SupplyV2FinanceIncidentSeverity" NOT NULL DEFAULT 'LOW',
    "checks"                INTEGER NOT NULL DEFAULT 1,
    "checkedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidentId"            TEXT,
    "dedupeKey"             TEXT NOT NULL,
    CONSTRAINT "supply_v2_payment_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_payment_reconciliations_dedupeKey_key"
  ON "supply_v2_payment_reconciliations" ("dedupeKey");
CREATE INDEX IF NOT EXISTS "supply_v2_payment_reconciliations_outcome_checkedAt_idx"
  ON "supply_v2_payment_reconciliations" ("outcome", "checkedAt");
CREATE INDEX IF NOT EXISTS "supply_v2_payment_reconciliations_provider_externalTransact_idx"
  ON "supply_v2_payment_reconciliations" ("provider", "externalTransactionId");
CREATE INDEX IF NOT EXISTS "supply_v2_payment_reconciliations_orderId_idx"
  ON "supply_v2_payment_reconciliations" ("orderId");
CREATE INDEX IF NOT EXISTS "supply_v2_payment_reconciliations_correlationId_idx"
  ON "supply_v2_payment_reconciliations" ("correlationId");
CREATE INDEX IF NOT EXISTS "supply_v2_payment_reconciliations_incidentId_idx"
  ON "supply_v2_payment_reconciliations" ("incidentId");

-- Forma: lo comprobado al menos una vez, y un veredicto de los cuatro que la
-- matriz pura puede dar. La base no deja escribir un quinto.
ALTER TABLE "supply_v2_payment_reconciliations"
  ADD CONSTRAINT "supply_v2_payment_reconciliations_shape" CHECK (
    "checks" >= 1
    AND "outcome" IN ('MATCHED', 'MISMATCH', 'WAITING', 'IGNORED')
    -- Un veredicto que no cuadra tiene que decir por qué.
    AND ("outcome" <> 'MISMATCH' OR "reasonCode" IS NOT NULL));

ALTER TABLE "supply_v2_payment_reconciliations"
  ADD CONSTRAINT "supply_v2_payment_reconciliations_externalEventRowId_fkey"
  FOREIGN KEY ("externalEventRowId") REFERENCES "supply_v2_external_events"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "supply_v2_payment_reconciliations"
  ADD CONSTRAINT "supply_v2_payment_reconciliations_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "supply_v2_payment_reconciliations"
  ADD CONSTRAINT "supply_v2_payment_reconciliations_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "supply_v2_finance_incidents"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;
