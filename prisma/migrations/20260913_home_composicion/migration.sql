-- F2a · Home comercial versionado + sinónimos de búsqueda (aditiva).
-- Solo CREATE TABLE / índices / valores de enum. Rollback: DROP TABLE.

-- Valores de auditoría para el ciclo de publicación.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COMPOSICION_GUARDADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COMPOSICION_PUBLICADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COMPOSICION_PAUSADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COMPOSICION_ARCHIVADA';

CREATE TABLE "home_revisiones" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "territorio" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
  "programadaPara" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "home_revisiones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "home_revisiones_companyId_estado_programadaPara_idx" ON "home_revisiones"("companyId", "estado", "programadaPara");

CREATE TABLE "home_bloques" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "orden" INTEGER NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "titulo" TEXT,
  "config" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "home_bloques_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "home_bloques_revisionId_tipo_key" ON "home_bloques"("revisionId", "tipo");
CREATE INDEX "home_bloques_revisionId_orden_idx" ON "home_bloques"("revisionId", "orden");

CREATE TABLE "busqueda_sinonimos" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "idioma" TEXT NOT NULL DEFAULT 'es-DO',
  "termino" TEXT NOT NULL,
  "equivalencia" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "busqueda_sinonimos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "busqueda_sinonimos_companyId_idioma_termino_key" ON "busqueda_sinonimos"("companyId", "idioma", "termino");
CREATE INDEX "busqueda_sinonimos_companyId_idioma_idx" ON "busqueda_sinonimos"("companyId", "idioma");

ALTER TABLE "home_revisiones" ADD CONSTRAINT "home_revisiones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_bloques" ADD CONSTRAINT "home_bloques_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "home_revisiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "busqueda_sinonimos" ADD CONSTRAINT "busqueda_sinonimos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
