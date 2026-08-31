-- ============================================================================
-- MEMBEGO CONNECT · Fase 2 — Dead letter de la cola de trabajos
-- ============================================================================
-- Hasta hoy, cuando QStash agotaba sus reintentos el trabajo desaparecía de
-- nuestra vista. Con el failure callback, el mensaje difunto queda registrado
-- aquí con su carga íntegra: reencolarlo es un botón en el panel del
-- superadmin, igual que el DEAD_LETTER del outbox de satélites.
--
-- 100% ADITIVA. Idempotente: se puede ejecutar dos veces sin daño.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "trabajos_muertos" (
    "id"         TEXT NOT NULL,
    "mensajeId"  TEXT,
    "tipo"       TEXT NOT NULL,
    "companyId"  TEXT,
    "carga"      JSONB NOT NULL,
    "error"      TEXT,
    "intentos"   INTEGER NOT NULL DEFAULT 0,
    "estado"     TEXT NOT NULL DEFAULT 'PENDIENTE',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoAt" TIMESTAMP(3),
    CONSTRAINT "trabajos_muertos_pkey" PRIMARY KEY ("id")
);

-- Único sobre el id de mensaje de QStash: el callback también se reintenta, y
-- la segunda entrega debe chocar en vez de duplicar el difunto.
CREATE UNIQUE INDEX IF NOT EXISTS "trabajos_muertos_mensajeId_key"
  ON "trabajos_muertos"("mensajeId");
CREATE INDEX IF NOT EXISTS "trabajos_muertos_estado_createdAt_idx"
  ON "trabajos_muertos"("estado","createdAt");
CREATE INDEX IF NOT EXISTS "trabajos_muertos_companyId_createdAt_idx"
  ON "trabajos_muertos"("companyId","createdAt");

DO $$ BEGIN ALTER TABLE "trabajos_muertos"
  ADD CONSTRAINT "trabajos_muertos_estado_valido"
  CHECK ("estado" IN ('PENDIENTE','REENCOLADO','DESCARTADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Acciones del superadmin sobre difuntos, en la bitácora de auditoría.
-- ADD VALUE es transaccionalmente especial en Postgres, pero IF NOT EXISTS lo
-- hace seguro de repetir.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COLA_REENCOLADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COLA_DESCARTADA';

SELECT 'cola_dead_letter' AS objeto,
       CASE WHEN to_regclass('public.trabajos_muertos') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
