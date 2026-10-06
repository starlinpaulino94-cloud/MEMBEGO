-- MEMBEGO SUPPLY 2.0 · SLICE 9 · núcleo operativo: inbox externo y outbox.
--
-- Aditiva y segura para los datos que ya hay: dos tablas nuevas y nada más.
-- No toca ninguna columna existente, así que el despliegue no depende del
-- orden entre código y migración (expand/migrate/contract: esto es «expand»).

CREATE TABLE IF NOT EXISTS "supply_v2_external_events" (
    "id"              TEXT NOT NULL,
    "provider"        TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType"       TEXT NOT NULL,
    "payloadHash"     TEXT NOT NULL,
    "payload"         JSONB,
    "orderId"         TEXT,
    "correlationId"   TEXT NOT NULL,
    "status"          "SupplyV2ExternalEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts"        INTEGER NOT NULL DEFAULT 0,
    "lastError"       TEXT,
    "nextAttemptAt"   TIMESTAMP(3),
    "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"     TIMESTAMP(3),
    "retriedById"     TEXT,
    "retriedAt"       TIMESTAMP(3),
    CONSTRAINT "supply_v2_external_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "supply_v2_outbox_events" (
    "id"            TEXT NOT NULL,
    "eventType"     TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId"   TEXT NOT NULL,
    "payload"       JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "dedupeKey"     TEXT NOT NULL,
    "status"        "SupplyV2OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "lastError"     TEXT,
    "availableAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"   TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retriedById"   TEXT,
    "retriedAt"     TIMESTAMP(3),
    CONSTRAINT "supply_v2_outbox_events_pkey" PRIMARY KEY ("id")
);

-- ──────────────────────────────────────────────────────────────────────────
-- LA IDENTIDAD IDEMPOTENTE, EN LA BASE
--
-- No basta con comprobarlo en el servicio: dos procesos que entran a la vez
-- pasan los dos la comprobación y solo el índice los separa. Es la misma
-- doctrina que `claves_idempotencia` y que el outbox de satélites.
-- ──────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_external_events_provider_externalEventId_eventTyp_key"
    ON "supply_v2_external_events" ("provider", "externalEventId", "eventType");

CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_outbox_events_dedupeKey_key"
    ON "supply_v2_outbox_events" ("dedupeKey");

CREATE INDEX IF NOT EXISTS "supply_v2_external_events_status_nextAttemptAt_idx"
    ON "supply_v2_external_events" ("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "supply_v2_external_events_provider_receivedAt_idx"
    ON "supply_v2_external_events" ("provider", "receivedAt");
CREATE INDEX IF NOT EXISTS "supply_v2_external_events_correlationId_idx"
    ON "supply_v2_external_events" ("correlationId");
CREATE INDEX IF NOT EXISTS "supply_v2_external_events_orderId_idx"
    ON "supply_v2_external_events" ("orderId");

CREATE INDEX IF NOT EXISTS "supply_v2_outbox_events_status_availableAt_idx"
    ON "supply_v2_outbox_events" ("status", "availableAt");
CREATE INDEX IF NOT EXISTS "supply_v2_outbox_events_aggregateType_aggregateId_idx"
    ON "supply_v2_outbox_events" ("aggregateType", "aggregateId");
CREATE INDEX IF NOT EXISTS "supply_v2_outbox_events_correlationId_idx"
    ON "supply_v2_outbox_events" ("correlationId");

-- ──────────────────────────────────────────────────────────────────────────
-- FORMA COHERENTE
--
-- Los intentos no son negativos, y un evento TERMINADO tiene fecha de
-- término. Un PROCESSED sin `processedAt` sería una fila que dice que se
-- procesó y no sabe cuándo: al investigar un pago, eso es justo el dato que
-- se busca.
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE "supply_v2_external_events" ADD CONSTRAINT "supply_v2_external_events_shape"
        CHECK ("attempts" >= 0
           AND (("status" = 'PROCESSED') = ("processedAt" IS NOT NULL))
           AND ("retriedById" IS NULL) = ("retriedAt" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_outbox_events" ADD CONSTRAINT "supply_v2_outbox_events_shape"
        CHECK ("attempts" >= 0
           AND (("status" = 'DELIVERED') = ("processedAt" IS NOT NULL))
           AND ("retriedById" IS NULL) = ("retriedAt" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_external_events" ADD CONSTRAINT "supply_v2_external_events_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "supply_v2_customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_external_events" ADD CONSTRAINT "supply_v2_external_events_retriedById_fkey"
        FOREIGN KEY ("retriedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "supply_v2_outbox_events" ADD CONSTRAINT "supply_v2_outbox_events_retriedById_fkey"
        FOREIGN KEY ("retriedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
