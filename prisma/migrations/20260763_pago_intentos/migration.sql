-- Pasarela de pago: registro de intentos de cobro contra un procesador externo.
-- Necesario con cualquier pasarela: idempotencia de la confirmación,
-- conciliación contra el reporte del procesador, y evidencia ante disputas.
-- Idempotente. Solo AGREGA una tabla nueva.

CREATE TABLE IF NOT EXISTS "pago_intentos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clienteId" TEXT,
    "proveedor" TEXT NOT NULL,
    "compraId" TEXT,
    "membershipId" TEXT,
    "monto" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'DOP',
    "estado" TEXT NOT NULL DEFAULT 'CREADO',
    "referenciaExterna" TEXT,
    "autorizacion" TEXT,
    "motivoRechazo" TEXT,
    "respuesta" JSONB,
    "activadoAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pago_intentos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pago_intentos_companyId_estado_createdAt_idx" ON "pago_intentos"("companyId","estado","createdAt");
CREATE INDEX IF NOT EXISTS "pago_intentos_referenciaExterna_idx" ON "pago_intentos"("referenciaExterna");
CREATE INDEX IF NOT EXISTS "pago_intentos_compraId_idx" ON "pago_intentos"("compraId");
CREATE INDEX IF NOT EXISTS "pago_intentos_membershipId_idx" ON "pago_intentos"("membershipId");

DO $$ BEGIN ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_compraId_fkey"
  FOREIGN KEY ("compraId") REFERENCES "producto_compras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "pago_intentos" ADD CONSTRAINT "pago_intentos_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'tabla pago_intentos' AS objeto,
       CASE WHEN to_regclass('public.pago_intentos') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS estado;
