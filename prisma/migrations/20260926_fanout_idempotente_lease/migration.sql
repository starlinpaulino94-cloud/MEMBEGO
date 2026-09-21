-- ============================================================================
-- FAN-OUT IDEMPOTENTE + RECLAMO CON LEASE  ·  barrido de bugs ocultos (#4/#5)
-- ============================================================================
--
-- Dos defectos del outbox del bus de eventos, con la misma raíz:
--
--   #4  `despacharEventoEstrategia` marca el `DomainEvent` como `processed:true`
--       ANTES de repartirlo. Un kill del proceso (timeout serverless, OOM) entre
--       el flip y el final del reparto dejaba el evento «procesado» a medias, y
--       nadie lo recogía: el `catch` de reapertura solo cubre un `throw` JS, no
--       un kill, y el barrido solo miraba `processed:false`.
--
--   raíz El paso que reenvía a los satélites ACUÑABA una fila nueva de
--       `eventos_salientes` en cada llamada (id nuevo => `eventId` nuevo), así
--       que re-despachar el mismo evento le llegaba al satélite como un evento
--       DISTINTO que no podía deduplicar. Eso hacía inseguro tanto reclamar (#4)
--       como reintentar (#5).
--
-- El arreglo:
--
--   1. `eventos_salientes.domainEventId` + UNIQUE(sistemaId, domainEventId) y
--      `entregas_webhook` UNIQUE(suscripcionId, eventoId): el fan-out pasa a ser
--      idempotente por (destino, evento de dominio). Re-repartir reusa la misma
--      fila; `create` choca con P2002 y se salta.
--
--   2. `automation_events.despachadoAt`: se pone al TERMINAR el reparto. El
--      barrido reclama lo que quedó `processed:true` con `despachadoAt` null
--      pasado el lease y lo reabre. El re-despacho ya no duplica (por el punto 1).
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ES NO DESTRUCTIVO Y NO ROMPE AL CREAR LOS UNIQUE
--
-- `domainEventId` es una columna NUEVA: todas las filas existentes quedan a null,
-- y el UNIQUE de Postgres trata los null como distintos, así que no chocan. En
-- `entregas_webhook`, con el código anterior el reparto corría a lo sumo UNA vez
-- por (suscripción, evento) —un `throw` siempre ocurría antes del reparto—, así
-- que no hay pares duplicados que hagan fallar el índice; los avisos de
-- automatización van con `eventoId` null y tampoco chocan.
--
-- Solo AÑADE columnas nullable e índices únicos. Idempotente, sin backfill.
-- ============================================================================

-- AlterTable · el evento de dominio queda marcado cuando su reparto TERMINA.
ALTER TABLE "automation_events"
    ADD COLUMN IF NOT EXISTS "despachadoAt" TIMESTAMP(3);

-- AlterTable · clave de idempotencia del reenvío a satélites.
ALTER TABLE "eventos_salientes"
    ADD COLUMN IF NOT EXISTS "domainEventId" TEXT;

-- CreateIndex · una entrega por (satélite, evento de dominio).
CREATE UNIQUE INDEX IF NOT EXISTS "eventos_salientes_sistemaId_domainEventId_key"
    ON "eventos_salientes"("sistemaId", "domainEventId");

-- CreateIndex · una entrega por (suscripción, evento de dominio).
CREATE UNIQUE INDEX IF NOT EXISTS "entregas_webhook_suscripcionId_eventoId_key"
    ON "entregas_webhook"("suscripcionId", "eventoId");
