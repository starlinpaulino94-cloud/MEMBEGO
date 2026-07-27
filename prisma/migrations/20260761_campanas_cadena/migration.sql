-- Campañas conjuntas EN CADENA: cada empresa aporta un beneficio distinto y
-- canjear uno desbloquea el siguiente. Añade imagen a la campaña y a cada paso.
-- Idempotente. Solo AGREGA (dos tablas nuevas + columnas nullable).

-- 1) Campaña: imagen de portada y modo (COPIA = replicar la misma oferta,
--    CADENA = beneficio distinto por empresa, encadenados).
ALTER TABLE "campanas_globales" ADD COLUMN IF NOT EXISTS "imagenUrl" TEXT;
ALTER TABLE "campanas_globales" ADD COLUMN IF NOT EXISTS "modo" TEXT NOT NULL DEFAULT 'COPIA';

-- 2) Eslabones de la cadena.
CREATE TABLE IF NOT EXISTS "campana_pasos" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "imagenUrl" TEXT,
    "plantilla" JSONB NOT NULL DEFAULT '{}',
    "promocionId" TEXT,
    "error" TEXT,
    "aplicadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campana_pasos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "campana_pasos_campanaId_orden_key"
    ON "campana_pasos"("campanaId", "orden");
CREATE INDEX IF NOT EXISTS "campana_pasos_companyId_idx" ON "campana_pasos"("companyId");

-- 3) Avance de cada cliente dentro de la cadena.
CREATE TABLE IF NOT EXISTS "campana_inscripciones" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "pasoActual" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "completadaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campana_inscripciones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "campana_inscripciones_campanaId_clienteId_key"
    ON "campana_inscripciones"("campanaId", "clienteId");
CREATE INDEX IF NOT EXISTS "campana_inscripciones_clienteId_idx"
    ON "campana_inscripciones"("clienteId");

-- 4) La compra recuerda de qué eslabón nació (para saber qué desbloquear).
ALTER TABLE "producto_compras" ADD COLUMN IF NOT EXISTS "campanaPasoId" TEXT;
CREATE INDEX IF NOT EXISTS "producto_compras_campanaPasoId_idx"
    ON "producto_compras"("campanaPasoId");

DO $$ BEGIN
    ALTER TABLE "campana_pasos" ADD CONSTRAINT "campana_pasos_campanaId_fkey"
        FOREIGN KEY ("campanaId") REFERENCES "campanas_globales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "campana_pasos" ADD CONSTRAINT "campana_pasos_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "campana_inscripciones" ADD CONSTRAINT "campana_inscripciones_campanaId_fkey"
        FOREIGN KEY ("campanaId") REFERENCES "campanas_globales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "campana_inscripciones" ADD CONSTRAINT "campana_inscripciones_clienteId_fkey"
        FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE "producto_compras" ADD CONSTRAINT "producto_compras_campanaPasoId_fkey"
        FOREIGN KEY ("campanaPasoId") REFERENCES "campana_pasos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Verificación: las 4 filas deben decir OK.
SELECT 'tabla campana_pasos' AS objeto,
       CASE WHEN to_regclass('public.campana_pasos') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL SELECT 'tabla campana_inscripciones',
       CASE WHEN to_regclass('public.campana_inscripciones') IS NOT NULL THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'columna campanas_globales.modo',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_name='campanas_globales' AND column_name='modo') THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'columna producto_compras.campanaPasoId',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_name='producto_compras' AND column_name='campanaPasoId') THEN 'OK' ELSE 'FALTA' END;
