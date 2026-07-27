-- Campañas globales del superadmin: se definen una vez y se reparten a varias
-- empresas generando una promoción o un plan REAL dentro de cada una.
-- Idempotente. No modifica ninguna tabla existente (solo agrega dos nuevas).

CREATE TABLE IF NOT EXISTS "campanas_globales" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "plantilla" JSONB NOT NULL DEFAULT '{}',
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "todasLasEmpresas" BOOLEAN NOT NULL DEFAULT false,
    "creadaPorId" TEXT,
    "aplicadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campanas_globales_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "campanas_globales_estado_createdAt_idx"
    ON "campanas_globales"("estado", "createdAt");

CREATE TABLE IF NOT EXISTS "campana_global_empresas" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "promocionId" TEXT,
    "planId" TEXT,
    "error" TEXT,
    "aplicadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campana_global_empresas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "campana_global_empresas_campanaId_companyId_key"
    ON "campana_global_empresas"("campanaId", "companyId");
CREATE INDEX IF NOT EXISTS "campana_global_empresas_companyId_idx"
    ON "campana_global_empresas"("companyId");

DO $$ BEGIN
    ALTER TABLE "campanas_globales" ADD CONSTRAINT "campanas_globales_creadaPorId_fkey"
        FOREIGN KEY ("creadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "campana_global_empresas" ADD CONSTRAINT "campana_global_empresas_campanaId_fkey"
        FOREIGN KEY ("campanaId") REFERENCES "campanas_globales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "campana_global_empresas" ADD CONSTRAINT "campana_global_empresas_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Verificación: las 2 filas deben decir OK.
SELECT 'tabla campanas_globales' AS objeto,
       CASE WHEN to_regclass('public.campanas_globales') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL SELECT 'tabla campana_global_empresas',
       CASE WHEN to_regclass('public.campana_global_empresas') IS NOT NULL THEN 'OK' ELSE 'FALTA' END;
