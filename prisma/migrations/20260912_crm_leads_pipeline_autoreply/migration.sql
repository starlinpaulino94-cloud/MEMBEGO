-- ============================================================================
-- CRM · LEADS, NOTAS, PIPELINE Y AUTO-REPLY — pipeline de ventas + respuestas
-- automáticas por WhatsApp
-- ============================================================================
-- QUÉ AÑADE
--
--   Lead               pipeline de ventas clásico por empresa; UNIQUE por
--                      companyId+telefono, con score/etapa/prioridad/tags
--   NotaSeguimiento    notas, llamadas, correos… sobre un lead; CASCADE con él
--   PipelineConfig     configuración del pipeline por empresa (etapas, campos
--                      custom y automatizaciones en JSONB); companyId UNIQUE
--   AutoReplyConfig    reglas de auto-reply por keywords, catálogo y orden;
--                      UNIQUE por companyId+nombre
--
--   Nombres de tabla: Lead, NotaSeguimiento, PipelineConfig y AutoReplyConfig
--   NO llevan @@map en crm.prisma, así que Prisma usa el nombre del modelo tal
--   cual (el engine NO pluraliza ni pasa a minúsculas). Ids uuid()/cuid() sin
--   DEFAULT en la BD: los genera el cliente Prisma.
--
-- 100% ADITIVA: cuatro tablas nuevas. Idempotente (IF NOT EXISTS en todo, FK
-- guardada por DO). Todas llevan companyId:
-- ============================================================================

CREATE TABLE IF NOT EXISTS "Lead" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "clienteId"        TEXT,
  "nombre"           TEXT NOT NULL,
  "email"            TEXT,
  "telefono"         TEXT,
  "fuente"           TEXT NOT NULL DEFAULT 'ORGANICO',
  "canal"            TEXT NOT NULL DEFAULT 'WEB',
  "estado"           TEXT NOT NULL DEFAULT 'ACTIVO',
  "etapa"            TEXT NOT NULL DEFAULT 'NUEVO',
  "score"            INTEGER,
  "fechaSeguimiento" TIMESTAMP(3),
  "prioridad"        TEXT NOT NULL DEFAULT 'MEDIA',
  "asignadoA"        TEXT,
  "notas"            TEXT,
  "tags"             TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_companyId_telefono_key" ON "Lead"("companyId", "telefono");
CREATE INDEX IF NOT EXISTS "Lead_companyId_idx" ON "Lead"("companyId");
CREATE INDEX IF NOT EXISTS "Lead_companyId_estado_idx" ON "Lead"("companyId", "estado");
CREATE INDEX IF NOT EXISTS "Lead_companyId_etapa_idx" ON "Lead"("companyId", "etapa");
CREATE INDEX IF NOT EXISTS "Lead_fechaSeguimiento_idx" ON "Lead"("fechaSeguimiento");
CREATE INDEX IF NOT EXISTS "Lead_asignadoA_idx" ON "Lead"("asignadoA");

CREATE TABLE IF NOT EXISTS "NotaSeguimiento" (
  "id"           TEXT NOT NULL,
  "leadId"       TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "contenido"    TEXT NOT NULL,
  "tipo"         TEXT NOT NULL DEFAULT 'NOTA',
  "estado"       TEXT NOT NULL DEFAULT 'PENDIENTE',
  "fechaProxima" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotaSeguimiento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NotaSeguimiento_leadId_idx" ON "NotaSeguimiento"("leadId");
CREATE INDEX IF NOT EXISTS "NotaSeguimiento_leadId_createdAt_idx"
  ON "NotaSeguimiento"("leadId", "createdAt");

CREATE TABLE IF NOT EXISTS "PipelineConfig" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "categoria"        TEXT NOT NULL,
  "stages"           JSONB NOT NULL,
  "camposCustom"     JSONB NOT NULL,
  "automatizaciones" JSONB NOT NULL,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PipelineConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PipelineConfig_companyId_key" ON "PipelineConfig"("companyId");

CREATE TABLE IF NOT EXISTS "AutoReplyConfig" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "nombre"        TEXT NOT NULL,
  "keywords"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "esBienvenida"  BOOLEAN NOT NULL DEFAULT false,
  "tipoRespuesta" TEXT NOT NULL DEFAULT 'TEXTO',
  "contenido"     TEXT NOT NULL,
  "catalogoPath"  TEXT,
  "activa"        BOOLEAN NOT NULL DEFAULT true,
  "orden"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutoReplyConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutoReplyConfig_companyId_nombre_key"
  ON "AutoReplyConfig"("companyId", "nombre");
CREATE INDEX IF NOT EXISTS "AutoReplyConfig_companyId_activa_idx"
  ON "AutoReplyConfig"("companyId", "activa");

-- Única FK declarada en crm.prisma (NotaSeguimiento.lead → Lead, CASCADE).
-- Postgres no tiene ADD CONSTRAINT IF NOT EXISTS: se guarda con DO.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NotaSeguimiento_leadId_fkey'
  ) THEN
    ALTER TABLE "NotaSeguimiento"
      ADD CONSTRAINT "NotaSeguimiento_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Lead"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotaSeguimiento"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineConfig"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutoReplyConfig"   ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Tras aplicar: reaplicar prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql (idempotente)
-- ============================================================================
