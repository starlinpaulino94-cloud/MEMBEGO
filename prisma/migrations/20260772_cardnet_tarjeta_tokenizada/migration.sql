-- Fase 2 CardNET: tarjeta guardada (tokenización hospedada) + renovación auto.
-- Aditivo e idempotente: se puede pegar en el SQL Editor de Supabase.
-- NO guarda número de tarjeta: solo referencias de CardNET y datos de exhibición.

-- CreateTable
CREATE TABLE IF NOT EXISTS "tarjetas_tokenizadas" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentProfileId" TEXT,
    "token" TEXT,
    "marca" TEXT,
    "ultimos4" TEXT,
    "vencMes" INTEGER,
    "vencAnio" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tarjetas_tokenizadas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tarjetas_tokenizadas_clienteId_activa_idx" ON "tarjetas_tokenizadas"("clienteId", "activa");
CREATE INDEX IF NOT EXISTS "tarjetas_tokenizadas_companyId_idx" ON "tarjetas_tokenizadas"("companyId");

-- AlterTable memberships
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "autoRenovar" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "tarjetaTokenizadaId" TEXT;

-- Foreign keys (con guarda para poder re-ejecutar sin error).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tarjetas_tokenizadas_companyId_fkey') THEN
    ALTER TABLE "tarjetas_tokenizadas" ADD CONSTRAINT "tarjetas_tokenizadas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tarjetas_tokenizadas_clienteId_fkey') THEN
    ALTER TABLE "tarjetas_tokenizadas" ADD CONSTRAINT "tarjetas_tokenizadas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='memberships_tarjetaTokenizadaId_fkey') THEN
    ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tarjetaTokenizadaId_fkey" FOREIGN KEY ("tarjetaTokenizadaId") REFERENCES "tarjetas_tokenizadas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
