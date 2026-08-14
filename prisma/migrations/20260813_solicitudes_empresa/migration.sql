-- Solicitudes de alta de empresa (etapa concierge del onboarding B2B).
-- El negocio llena el formulario público /solicitud-empresa; el superadmin
-- las revisa en /superadmin/solicitudes y crea la empresa con un clic.
-- Idempotente: se puede correr más de una vez sin daño.

DO $$ BEGIN
  CREATE TYPE "SolicitudEmpresaEstado" AS ENUM ('NUEVA', 'EN_REVISION', 'CONTACTADA', 'CREADA', 'DESCARTADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "solicitudes_empresa" (
  "id"             TEXT NOT NULL,
  "estado"         "SolicitudEmpresaEstado" NOT NULL DEFAULT 'NUEVA',
  "nombreNegocio"  TEXT NOT NULL,
  "tipoNegocio"    TEXT NOT NULL,
  "contactoCorreo" TEXT NOT NULL,
  "datos"          JSONB NOT NULL,
  "imagenes"       JSONB,
  "notasInternas"  TEXT,
  "companyId"      TEXT,
  "ipAddress"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "solicitudes_empresa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "solicitudes_empresa_estado_createdAt_idx"
  ON "solicitudes_empresa"("estado", "createdAt");
