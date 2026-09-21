-- ============================================================================
-- LA HISTORIA DE UNA MEMBRESÍA  ·  Fase 1 del sistema de reportes
-- ============================================================================
--
-- `memberships` guarda su ESTADO, no su historia. Mirando una fila se sabe que
-- hoy está CANCELADA; nunca cuándo se activó, cuántas veces se renovó, si subió
-- o bajó de plan, ni quién la cortó. «Membresías que bajaron de plan en agosto»
-- no es un reporte difícil: es un reporte imposible, porque el dato nunca se
-- escribió.
--
-- Esta migración solo AÑADE. No toca ni una fila existente, no borra nada y no
-- cambia ningún valor por defecto de lo que ya estaba. Las membresías de hoy
-- siguen funcionando igual sin un solo evento.
--
-- `membresia_eventos` es append-only por disciplina, no por restricción de la
-- base: una fila describe algo que ya pasó y no se corrige nunca. Si el hecho
-- cambió, hay un hecho nuevo. Es lo que permite que un informe cerrado siga
-- diciendo mañana lo mismo que hoy.
--
-- El backfill desde `audit_logs` va en la migración siguiente, a propósito:
-- crear la tabla y llenarla son dos operaciones con riesgos distintos, y
-- separarlas permite revertir una sin la otra.
-- ============================================================================

-- CreateEnum
CREATE TYPE "MembresiaEventoTipo" AS ENUM ('CREADA', 'ACTIVADA', 'RENOVADA', 'CAMBIO_PLAN', 'CANCELADA', 'VENCIDA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "MembresiaEventoOrigen" AS ENUM ('ADMIN', 'CLIENTE', 'SUPERADMIN', 'CRON', 'API', 'RECONSTRUIDO');

-- AlterTable · por qué se canceló, en palabras de quien la canceló.
-- Nullable sin valor por defecto: las canceladas de antes quedan en NULL, que
-- significa «no se preguntó», y eso es distinto de la cadena vacía.
-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "motivoCancelacion" TEXT;

-- CreateTable
CREATE TABLE "membresia_eventos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" "MembresiaEventoTipo" NOT NULL,
    "estadoAnterior" TEXT,
    "estadoNuevo" TEXT,
    "planAnteriorId" TEXT,
    "planNuevoId" TEXT,
    "precioAnterior" DECIMAL(10,2),
    "precioNuevo" DECIMAL(10,2),
    "monto" DECIMAL(10,2),
    "motivo" TEXT,
    "origen" "MembresiaEventoOrigen" NOT NULL,
    "actorUserId" TEXT,
    "ocurridoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconstruido" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "membresia_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membresia_eventos_companyId_tipo_ocurridoEn_idx" ON "membresia_eventos"("companyId", "tipo", "ocurridoEn");

-- CreateIndex
CREATE INDEX "membresia_eventos_membershipId_ocurridoEn_idx" ON "membresia_eventos"("membershipId", "ocurridoEn");

-- CreateIndex
CREATE INDEX "membresia_eventos_companyId_ocurridoEn_idx" ON "membresia_eventos"("companyId", "ocurridoEn");

-- AddForeignKey
ALTER TABLE "membresia_eventos" ADD CONSTRAINT "membresia_eventos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_eventos" ADD CONSTRAINT "membresia_eventos_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membresia_eventos" ADD CONSTRAINT "membresia_eventos_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

