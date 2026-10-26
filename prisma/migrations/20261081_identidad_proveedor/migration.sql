-- VERIFICACIÓN DE IDENTIDAD (Fase 2) · integración con el proveedor.
--
-- 1. `identidad_eventos_externos`: la BANDEJA de avisos del proveedor (webhooks). Se registra cada aviso
--    ya autenticado, una sola vez por `event_id`, y se procesa después: así un aviso repetido no repite
--    nada, y si el procesamiento falla queda pendiente para el reintento. NO guarda el cuerpo del aviso
--    ni el id de la sesión: solo el id del evento, su tipo, el estado que dijo, el id de NUESTRO intento
--    y un hash del cuerpo.
-- 2. Tres columnas en `identidad_intentos` para «procesar y purgar» y para la reconciliación.
--
-- Idempotente y aditiva (IF NOT EXISTS, CHECKs en DO $$).

-- ─── 1. La bandeja ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "identidad_eventos_externos" (
    "id"               TEXT         NOT NULL,
    "proveedor"        TEXT         NOT NULL,
    "eventoExternoId"  TEXT         NOT NULL,
    "tipo"             TEXT         NOT NULL,
    "estadoExterno"    TEXT,
    "intentoId"        TEXT,
    "payloadHash"      TEXT         NOT NULL,
    "estado"           TEXT         NOT NULL DEFAULT 'recibido',
    "detalle"          TEXT,
    "intentosDeProceso" INTEGER     NOT NULL DEFAULT 0,
    "recibidoAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesadoAt"      TIMESTAMP(3),

    CONSTRAINT "identidad_eventos_externos_pkey" PRIMARY KEY ("id")
);

-- El mismo aviso (los reintentos del proveedor reusan el `event_id`) se registra UNA vez.
CREATE UNIQUE INDEX IF NOT EXISTS "identidad_eventos_externos_proveedor_eventoExternoId_tipo_key"
  ON "identidad_eventos_externos" ("proveedor", "eventoExternoId", "tipo");
CREATE INDEX IF NOT EXISTS "identidad_eventos_externos_estado_recibidoAt_idx"
  ON "identidad_eventos_externos" ("estado", "recibidoAt");
CREATE INDEX IF NOT EXISTS "identidad_eventos_externos_intentoId_idx"
  ON "identidad_eventos_externos" ("intentoId");

-- ─── 2. Purga y reconciliación en el intento ────────────────────────────────

-- Cuándo se borró la sesión en el proveedor (la prueba de que los documentos ya no están allí).
ALTER TABLE "identidad_intentos" ADD COLUMN IF NOT EXISTS "purgadoAt"        TIMESTAMP(3);
-- Cuántas veces se intentó borrar sin éxito (para no reintentar eternamente en silencio).
ALTER TABLE "identidad_intentos" ADD COLUMN IF NOT EXISTS "purgaIntentos"    INTEGER NOT NULL DEFAULT 0;
-- La última vez que se le preguntó al proveedor por este intento (la reconciliación no insiste cada segundo).
ALTER TABLE "identidad_intentos" ADD COLUMN IF NOT EXISTS "ultimaConsultaAt" TIMESTAMP(3);

-- ─── 3. Valores válidos ─────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_eventos_externos_estado_chk') THEN
    ALTER TABLE "identidad_eventos_externos" ADD CONSTRAINT "identidad_eventos_externos_estado_chk"
      CHECK ("estado" IN ('recibido', 'procesado', 'ignorado', 'fallido'));
  END IF;
END $$;

-- ─── 4. RLS ─────────────────────────────────────────────────────────────────
--
-- Tabla de la PLATAFORMA (no de una persona ni de una empresa): sin política, denegada a todo rol que no
-- la bypasee. La política (solo omnisciente) va en prisma/migrations_manual/2026-10-rls-identidad.sql.

ALTER TABLE "identidad_eventos_externos" ENABLE ROW LEVEL SECURITY;
