-- ============================================================================
-- META · Fase 1 — activos por empresa y eventos de webhook deduplicados
-- ============================================================================
-- QUÉ AÑADE
--
-- `activos_meta`: cada Página de Facebook, cuenta profesional de Instagram,
-- cuenta de WhatsApp Business (WABA) o número que una empresa autorizó. El
-- UNIQUE (tipo, idExterno) convierte «un activo de Meta pertenece a UNA
-- empresa de MembeGo» en una regla de la base. Es la misma protección que ya
-- tenía el WABA en conexiones_empresa, generalizada.
--
-- `eventos_meta`: cada notificación de Meta, cruda y una sola vez. Meta
-- reintenta durante 36 horas sin garantizar orden ni ausencia de duplicados;
-- el UNIQUE en claveDedupe hace inofensivo el reintento. Se procesa en cola.
-- `companyId` puede ser NULL: un aviso puede llegar antes de que el alta que
-- lo origina termine, y entonces todavía no tiene dueño.
--
-- 100% ADITIVA: dos tablas nuevas. Idempotente.
--
-- RLS: `2026-07-rls-capa2-aislamiento.sql` deduce las políticas del esquema
-- por la columna companyId; tras esta migración hay que volver a aplicarlo
-- (es idempotente) para que las dos tablas queden con su política. Mientras
-- tanto RLS está encendido y deniega, que es lo correcto para una tabla que
-- nadie ha decidido cómo aislar (docs/RLS.md).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "activos_meta" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "conexionId"  TEXT NOT NULL,
  "tipo"        TEXT NOT NULL,
  "idExterno"   TEXT NOT NULL,
  "nombre"      TEXT,
  "padreId"     TEXT,
  "sellado"     TEXT,
  "keyVersion"  INTEGER,
  "metadata"    JSONB,
  "suscritoAt"  TIMESTAMP(3),
  "estado"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "activos_meta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "activos_meta_tipo_idExterno_key" ON "activos_meta"("tipo", "idExterno");
CREATE INDEX IF NOT EXISTS "activos_meta_companyId_tipo_idx" ON "activos_meta"("companyId", "tipo");
CREATE INDEX IF NOT EXISTS "activos_meta_conexionId_idx" ON "activos_meta"("conexionId");

-- Restrict, no Cascade: una conexión con activos vivos no se borra — se
-- desconecta, y los activos se retiran (estado REMOVED) conservando historial.
ALTER TABLE "activos_meta"
  ADD CONSTRAINT "activos_meta_conexionId_fkey"
  FOREIGN KEY ("conexionId") REFERENCES "conexiones_empresa"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "eventos_meta" (
  "id"            TEXT NOT NULL,
  "objeto"        TEXT NOT NULL,
  "entryId"       TEXT NOT NULL,
  "campo"         TEXT NOT NULL,
  "claveDedupe"   TEXT NOT NULL,
  "companyId"     TEXT,
  "activoId"      TEXT,
  "conexionId"    TEXT,
  "payload"       JSONB NOT NULL,
  "timestampMeta" TIMESTAMP(3),
  "recibidoAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "procesadoAt"   TIMESTAMP(3),
  "error"         TEXT,
  CONSTRAINT "eventos_meta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "eventos_meta_claveDedupe_key" ON "eventos_meta"("claveDedupe");
CREATE INDEX IF NOT EXISTS "eventos_meta_companyId_recibidoAt_idx" ON "eventos_meta"("companyId", "recibidoAt");
CREATE INDEX IF NOT EXISTS "eventos_meta_procesadoAt_idx" ON "eventos_meta"("procesadoAt");

ALTER TABLE "activos_meta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eventos_meta" ENABLE ROW LEVEL SECURITY;
