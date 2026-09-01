-- ============================================================================
-- MEMBEGO CONNECT · Fase 3 — Webhooks salientes a cualquier URL
-- ============================================================================
-- Una empresa puede pedir que le avisemos a SU URL cuando pasa algo suyo, sin
-- que nadie de MembeGo tenga que registrar un satélite. Es el hermano abierto
-- de `sistemas_conectados`.
--
--   suscripciones_webhook  a dónde avisar, de qué eventos, con qué secreto
--   entregas_webhook       cada intento: outbox, igual que eventos_salientes
--
-- 100% ADITIVA. Idempotente: se puede ejecutar dos veces sin daño.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "suscripciones_webhook" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "nombre"         TEXT NOT NULL,
    "url"            TEXT NOT NULL,
    "eventos"        TEXT[],
    "secreto"        TEXT NOT NULL,
    "estado"         TEXT NOT NULL DEFAULT 'ACTIVE',
    "fallosSeguidos" INTEGER NOT NULL DEFAULT 0,
    "ultimoOkAt"     TIMESTAMP(3),
    "ultimoErrorAt"  TIMESTAMP(3),
    "ultimoError"    TEXT,
    "creadoPor"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "suscripciones_webhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "suscripciones_webhook_companyId_estado_idx"
  ON "suscripciones_webhook"("companyId","estado");

DO $$ BEGIN ALTER TABLE "suscripciones_webhook"
  ADD CONSTRAINT "suscripciones_webhook_estado_valido"
  CHECK ("estado" IN ('ACTIVE','PAUSED','DISABLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Solo https, y TAMBIÉN en la base: la validación de la aplicación le explica
-- el porqué a quien integra, pero un INSERT a mano no puede saltársela — un
-- webhook por http manda datos de clientes en claro por la red.
DO $$ BEGIN ALTER TABLE "suscripciones_webhook"
  ADD CONSTRAINT "suscripciones_webhook_url_https"
  CHECK ("url" LIKE 'https://%');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un secreto vacío firma cualquier cosa, y entonces la firma no prueba nada.
DO $$ BEGIN ALTER TABLE "suscripciones_webhook"
  ADD CONSTRAINT "suscripciones_webhook_secreto_no_vacio"
  CHECK (length("secreto") >= 16);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "entregas_webhook" (
    "id"            TEXT NOT NULL,
    "suscripcionId" TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "evento"        TEXT NOT NULL,
    "eventoId"      TEXT,
    "payload"       JSONB NOT NULL,
    "estado"        TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intentos"      INTEGER NOT NULL DEFAULT 0,
    "estadoHttp"    INTEGER,
    "ultimoError"   TEXT,
    "enviadoAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entregas_webhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "entregas_webhook_estado_createdAt_idx"
  ON "entregas_webhook"("estado","createdAt");
CREATE INDEX IF NOT EXISTS "entregas_webhook_companyId_createdAt_idx"
  ON "entregas_webhook"("companyId","createdAt");
CREATE INDEX IF NOT EXISTS "entregas_webhook_suscripcionId_createdAt_idx"
  ON "entregas_webhook"("suscripcionId","createdAt");

DO $$ BEGIN ALTER TABLE "entregas_webhook" ADD CONSTRAINT "entregas_webhook_suscripcionId_fkey"
  FOREIGN KEY ("suscripcionId") REFERENCES "suscripciones_webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mismo vocabulario que el outbox de satélites: un fallo se reintenta solo; un
-- DEAD_LETTER necesita que alguien decida.
DO $$ BEGIN ALTER TABLE "entregas_webhook"
  ADD CONSTRAINT "entregas_webhook_estado_valido"
  CHECK ("estado" IN ('PENDIENTE','ENVIADO','DEAD_LETTER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'connect_webhooks' AS objeto,
       CASE WHEN to_regclass('public.suscripciones_webhook') IS NOT NULL
             AND to_regclass('public.entregas_webhook')      IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
