-- Integraciones: sistemas satélite conectados a MembeGo (SSO + webhooks).
-- Idempotente. Solo AGREGA tablas nuevas.

CREATE TABLE IF NOT EXISTS "sistemas_conectados" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "urlBase" TEXT NOT NULL,
    "urlWebhook" TEXT,
    "secreto" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sistemas_conectados_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sistemas_conectados_slug_key" ON "sistemas_conectados"("slug");

CREATE TABLE IF NOT EXISTS "eventos_salientes" (
    "id" TEXT NOT NULL,
    "sistemaId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoError" TEXT,
    "enviadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eventos_salientes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "eventos_salientes_estado_createdAt_idx" ON "eventos_salientes"("estado","createdAt");
CREATE INDEX IF NOT EXISTS "eventos_salientes_companyId_tipo_createdAt_idx" ON "eventos_salientes"("companyId","tipo","createdAt");

DO $$ BEGIN ALTER TABLE "eventos_salientes" ADD CONSTRAINT "eventos_salientes_sistemaId_fkey"
  FOREIGN KEY ("sistemaId") REFERENCES "sistemas_conectados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'integraciones' AS objeto,
       CASE WHEN to_regclass('public.sistemas_conectados') IS NOT NULL
             AND to_regclass('public.eventos_salientes') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
