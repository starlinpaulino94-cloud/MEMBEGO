-- ============================================================================
-- WEBHOOKS ENTRANTES  ·  auditoría de integraciones, hallazgo B-1
-- ============================================================================
--
-- MembeGo solo sabía empujar: eventos hacia los satélites y hacia los webhooks
-- que una empresa suscribe. No había ninguna forma de que algo de fuera
-- empujara hacia dentro, y ése era el hueco por el que cualquier integración
-- que no hubiéramos escrito a mano resultaba imposible para el usuario final.
--
-- Una fila aquí es una URL secreta a la que una herramienta ajena hace POST. Lo
-- que llega entra en el bus como `entrante.<slug>`.
--
-- ---------------------------------------------------------------------------
-- NO HAY TABLA DE RECEPCIONES, Y ES DELIBERADO
--
-- Lo recibido se guarda como evento en `automation_events`, que ya tiene el
-- payload, la empresa, el tipo y la hora. Una segunda tabla con los mismos
-- datos sería un sitio más que purgar, que aislar y que mantener sincronizado
-- — y dos respuestas posibles a «qué nos mandaron el martes».
--
-- ---------------------------------------------------------------------------
-- DEL TOKEN SOLO SE GUARDA SU HASH
--
-- La URL entera se enseña una vez al crearla. Que la URL sea el credencial es
-- lo normal en un webhook entrante, pero no obliga a guardarla en claro: con el
-- prefijo indexado y el secreto en scrypt, un volcado de esta tabla no permite
-- mandarle un evento a nadie.
--
-- Solo CREA una tabla. Idempotente.
-- ============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "webhooks_entrantes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "prefijo" TEXT NOT NULL,
    "secretoHash" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVE',
    "recibidos" INTEGER NOT NULL DEFAULT 0,
    "ultimoAt" TIMESTAMP(3),
    "creadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_entrantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "webhooks_entrantes_prefijo_key" ON "webhooks_entrantes"("prefijo");

-- CreateIndex · dos webhooks con el mismo slug emitirían el mismo evento y
-- sería imposible saber cuál de los dos lo mandó.
CREATE UNIQUE INDEX IF NOT EXISTS "webhooks_entrantes_companyId_slug_key" ON "webhooks_entrantes"("companyId", "slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhooks_entrantes_companyId_estado_idx" ON "webhooks_entrantes"("companyId", "estado");

-- El estado solo puede ser uno de los dos. Un valor inventado dejaría el
-- webhook en un limbo que el código lee como «ni activo ni pausado».
DO $$ BEGIN
  ALTER TABLE "webhooks_entrantes"
    ADD CONSTRAINT "webhooks_entrantes_estado_valido" CHECK ("estado" IN ('ACTIVE','PAUSED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
