-- ─────────────────────────────────────────────────────────────────────────────
-- Invita y Gana · creación de las tablas del módulo (MIGRACIÓN DE REPARACIÓN).
--
-- POR QUÉ EXISTE ESTE ARCHIVO Y POR QUÉ LLEVA UNA "b" EN EL NOMBRE
--
-- Estas tres tablas se crearon a mano en el SQL Editor de Supabase y nunca
-- tuvieron migración. La única prueba de su existencia en el historial era
-- `20260714_campana_invitacion_usar_banner`, que les AÑADE una columna — así
-- que el historial no se podía reproducir desde cero: fallaba justo ahí con
-- "relation campanas_invitacion does not exist".
--
-- La `b` coloca este archivo entre `20260713_promociones_v2` y
-- `20260714_campana_invitacion_usar_banner`, que es el hueco exacto donde
-- ocurrió aquel trabajo manual. Prisma ordena las migraciones por nombre de
-- carpeta, así que `20260713b_` va justo donde tiene que ir.
--
-- LA FORMA ES LA DE ENTONCES, NO LA DE HOY. Faltan a propósito dos columnas:
--   · `usarBanner`  la añade 20260714_campana_invitacion_usar_banner
--   · `contenido`   la añade 20260745_invita_contenido_editable
-- Ponerlas aquí haría fallar esas dos migraciones con "column already exists".
--
-- IDEMPOTENTE: en producción estas tablas YA EXISTEN. Todo va con
-- `IF NOT EXISTS` para que aplicarla allí no rompa nada ni cambie nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CampanaInvitacionEstado" AS ENUM ('BORRADOR', 'ACTIVA', 'PAUSADA', 'FINALIZADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InvitacionEventoTipo" AS ENUM ('COMPARTIDA', 'ENLACE_ABIERTO', 'LANDING_VISTA', 'REGISTRO_INICIADO', 'REGISTRO_COMPLETADO', 'PREMIO_RECLAMADO', 'MEMBRESIA_ADQUIRIDA', 'PRIMER_CANJE', 'CONVERSION_FINAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "campanas_invitacion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "textoLanding" TEXT,
    "imagenUrl" TEXT,
    "bannerUrl" TEXT,
    "metaRegistros" INTEGER NOT NULL,
    "beneficioInvitante" JSONB NOT NULL,
    "beneficioInvitado" JSONB NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "maxPremios" INTEGER,
    "premiosOtorgados" INTEGER NOT NULL DEFAULT 0,
    "estado" "CampanaInvitacionEstado" NOT NULL DEFAULT 'BORRADOR',
    "colorPrimario" TEXT,
    "colorSecundario" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campanas_invitacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invitacion_progresos" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registrosCompletados" INTEGER NOT NULL DEFAULT 0,
    "metaAlcanzada" BOOLEAN NOT NULL DEFAULT false,
    "premioReclamado" BOOLEAN NOT NULL DEFAULT false,
    "benefitGrantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitacion_progresos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invitacion_eventos" (
    "id" TEXT NOT NULL,
    "campanaId" TEXT NOT NULL,
    "clienteId" TEXT,
    "companyId" TEXT NOT NULL,
    "tipo" "InvitacionEventoTipo" NOT NULL,
    "canal" TEXT,
    "dispositivo" TEXT,
    "ipHash" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitacion_eventos_pkey" PRIMARY KEY ("id")
);

-- La campaña que originó cada referido. Se añadió a mano junto con las tablas.
ALTER TABLE "referidos" ADD COLUMN IF NOT EXISTS "campanaInvitacionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "campanas_invitacion_slug_key" ON "campanas_invitacion"("slug");
CREATE INDEX IF NOT EXISTS "campanas_invitacion_companyId_estado_idx" ON "campanas_invitacion"("companyId", "estado");
CREATE INDEX IF NOT EXISTS "campanas_invitacion_estado_fechaFin_idx" ON "campanas_invitacion"("estado", "fechaFin");
CREATE INDEX IF NOT EXISTS "invitacion_progresos_clienteId_idx" ON "invitacion_progresos"("clienteId");
CREATE UNIQUE INDEX IF NOT EXISTS "invitacion_progresos_campanaId_clienteId_key" ON "invitacion_progresos"("campanaId", "clienteId");
CREATE INDEX IF NOT EXISTS "invitacion_eventos_campanaId_tipo_idx" ON "invitacion_eventos"("campanaId", "tipo");
CREATE INDEX IF NOT EXISTS "invitacion_eventos_campanaId_clienteId_idx" ON "invitacion_eventos"("campanaId", "clienteId");
CREATE INDEX IF NOT EXISTS "referidos_campanaInvitacionId_idx" ON "referidos"("campanaInvitacionId");

-- AddForeignKey · el par DROP IF EXISTS + ADD es idempotente y deja la regla
-- ON DELETE exactamente como la declara el esquema.
ALTER TABLE "campanas_invitacion" DROP CONSTRAINT IF EXISTS "campanas_invitacion_companyId_fkey";
ALTER TABLE "campanas_invitacion" ADD CONSTRAINT "campanas_invitacion_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitacion_progresos" DROP CONSTRAINT IF EXISTS "invitacion_progresos_campanaId_fkey";
ALTER TABLE "invitacion_progresos" ADD CONSTRAINT "invitacion_progresos_campanaId_fkey"
  FOREIGN KEY ("campanaId") REFERENCES "campanas_invitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitacion_progresos" DROP CONSTRAINT IF EXISTS "invitacion_progresos_clienteId_fkey";
ALTER TABLE "invitacion_progresos" ADD CONSTRAINT "invitacion_progresos_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitacion_eventos" DROP CONSTRAINT IF EXISTS "invitacion_eventos_campanaId_fkey";
ALTER TABLE "invitacion_eventos" ADD CONSTRAINT "invitacion_eventos_campanaId_fkey"
  FOREIGN KEY ("campanaId") REFERENCES "campanas_invitacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitacion_eventos" DROP CONSTRAINT IF EXISTS "invitacion_eventos_clienteId_fkey";
ALTER TABLE "invitacion_eventos" ADD CONSTRAINT "invitacion_eventos_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "referidos" DROP CONSTRAINT IF EXISTS "referidos_campanaInvitacionId_fkey";
ALTER TABLE "referidos" ADD CONSTRAINT "referidos_campanaInvitacionId_fkey"
  FOREIGN KEY ("campanaInvitacionId") REFERENCES "campanas_invitacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
