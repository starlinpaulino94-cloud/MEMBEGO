-- ============================================================================
-- PLATAFORMA · Fase 3 — Eventos v2, cola de descarte e idempotencia
-- ============================================================================
-- Ver docs/platform/eventos-v2.md y docs/PLATFORM_ARCHITECTURE_REPORT.md §12, §29, §74.
--
-- Tres cosas, todas aditivas:
--
--   1. `traceId` en el outbox. Una visita genera hasta cuatro eventos hacia dos
--      sistemas; sin un hilo común, reconstruir «qué pasó con la visita de las
--      3 de la tarde» es cruzar registros a ojo entre logs de empresas
--      distintas.
--
--   2. `FALLIDO` → `DEAD_LETTER`. No es un cambio de palabra: un fallo es un
--      intento que salió mal y se repite; esto es un evento que ya no se va a
--      entregar solo y necesita que alguien decida. Antes eran la misma
--      palabra y por eso nadie miraba la cola.
--
--   3. `claves_idempotencia`. Un reintento de red sobre un canje consume el
--      beneficio dos veces, y el satélite no puede distinguir «no llegó» de
--      «llegó y se perdió la respuesta». Esta tabla es lo que convierte esa
--      ambigüedad en una respuesta repetible.
--
-- Idempotente: se puede correr varias veces sin efecto.
-- ============================================================================

-- ── 1 · Hilo de traza en el outbox ──────────────────────────────────────────
ALTER TABLE "eventos_salientes" ADD COLUMN IF NOT EXISTS "traceId" TEXT;

-- ── 2 · Cola de descarte ────────────────────────────────────────────────────
--
-- Las filas ya agotadas pasan a la palabra nueva. Es un renombrado del estado
-- terminal, no una reapertura: lo que estaba muerto sigue muerto, y sigue
-- reencolable desde el panel con su payload intacto.
UPDATE "eventos_salientes" SET "estado" = 'DEAD_LETTER' WHERE "estado" = 'FALLIDO';

-- Después del backfill, para que la sentencia anterior no se encuentre el
-- CHECK a medio camino.
DO $$ BEGIN ALTER TABLE "eventos_salientes"
  ADD CONSTRAINT "eventos_salientes_estado_valido"
  CHECK ("estado" IN ('PENDIENTE','ENVIADO','DEAD_LETTER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3 · Claves de idempotencia ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "claves_idempotencia" (
    "id"             TEXT NOT NULL,
    "sistemaId"      TEXT NOT NULL,
    "clave"          TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "endpoint"       TEXT NOT NULL,
    "huellaPeticion" TEXT NOT NULL,
    "estadoHttp"     INTEGER NOT NULL,
    "respuesta"      JSONB NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "claves_idempotencia_pkey" PRIMARY KEY ("id")
);

-- La unicidad es (sistema, clave) y NO (clave): dos satélites pueden usar «1»
-- sin pisarse, y ninguno puede leer la respuesta guardada del otro.
CREATE UNIQUE INDEX IF NOT EXISTS "claves_idempotencia_sistemaId_clave_key"
  ON "claves_idempotencia"("sistemaId","clave");
CREATE INDEX IF NOT EXISTS "claves_idempotencia_expiraAt_idx"
  ON "claves_idempotencia"("expiraAt");

SELECT 'eventos_v2_idempotencia' AS objeto,
       (SELECT count(*) FROM "eventos_salientes" WHERE "estado" = 'DEAD_LETTER') AS descartados,
       CASE WHEN to_regclass('public.claves_idempotencia') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
