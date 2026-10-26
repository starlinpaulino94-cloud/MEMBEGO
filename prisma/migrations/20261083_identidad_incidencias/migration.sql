-- VERIFICACIÓN DE IDENTIDAD (Fase 3) · incidencias.
--
-- Cuando una persona no puede verificarse, o cree que el resultado es incorrecto, lo cuenta desde su
-- pantalla. Es una incidencia de la PERSONA y de Membego (el proveedor lo gestiona Membego, no una
-- empresa): por eso no es un ticket de soporte de empresa. La mira el equipo autorizado en el panel
-- de administración (Fase 4).
--
-- El mensaje es texto libre de la persona, corto, y la pantalla le pide que NO escriba su número de
-- cédula. Aun así no se registra en ninguna bitácora ni en ningún correo: solo su id y su tipo.
--
-- Idempotente y aditiva.

CREATE TABLE IF NOT EXISTS "identidad_incidencias" (
    "id"            TEXT         NOT NULL,
    "userId"        TEXT         NOT NULL,
    "intentoId"     TEXT,
    "tipo"          TEXT         NOT NULL,
    "mensaje"       TEXT         NOT NULL,
    "estado"        TEXT         NOT NULL DEFAULT 'abierta',
    "creadaAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    "resueltaAt"    TIMESTAMP(3),
    "resueltaPorId" TEXT,

    CONSTRAINT "identidad_incidencias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "identidad_incidencias_userId_creadaAt_idx"
  ON "identidad_incidencias" ("userId", "creadaAt");
-- La cola del equipo: lo abierto primero, lo más viejo antes.
CREATE INDEX IF NOT EXISTS "identidad_incidencias_estado_creadaAt_idx"
  ON "identidad_incidencias" ("estado", "creadaAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_userId_fkey') THEN
    ALTER TABLE "identidad_incidencias"
      ADD CONSTRAINT "identidad_incidencias_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_intentoId_fkey') THEN
    ALTER TABLE "identidad_incidencias"
      ADD CONSTRAINT "identidad_incidencias_intentoId_fkey"
      FOREIGN KEY ("intentoId") REFERENCES "identidad_intentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_resueltaPorId_fkey') THEN
    ALTER TABLE "identidad_incidencias"
      ADD CONSTRAINT "identidad_incidencias_resueltaPorId_fkey"
      FOREIGN KEY ("resueltaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Valores válidos: la segunda barrera (el código los valida también).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_tipo_chk') THEN
    ALTER TABLE "identidad_incidencias" ADD CONSTRAINT "identidad_incidencias_tipo_chk"
      CHECK ("tipo" IN ('no_puedo_completar', 'rechazo_incorrecto', 'datos_incorrectos', 'otro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_estado_chk') THEN
    ALTER TABLE "identidad_incidencias" ADD CONSTRAINT "identidad_incidencias_estado_chk"
      CHECK ("estado" IN ('abierta', 'en_proceso', 'resuelta'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_mensaje_chk') THEN
    ALTER TABLE "identidad_incidencias" ADD CONSTRAINT "identidad_incidencias_mensaje_chk"
      CHECK (char_length("mensaje") BETWEEN 1 AND 600);
  END IF;
END $$;

-- RLS: se activa aquí; la política de dueño va en prisma/migrations_manual/2026-10-rls-identidad.sql.
ALTER TABLE "identidad_incidencias" ENABLE ROW LEVEL SECURITY;
