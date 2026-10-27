-- VERIFICACIÓN DE IDENTIDAD (Fase 4) · la respuesta del equipo a una incidencia.
--
-- Quien resuelve una incidencia le deja una respuesta a la persona (se le avisa en su campana) y queda
-- anotado quién la tomó. La respuesta la escribe el equipo de Membego: no lleva datos de la persona y no
-- va a ninguna bitácora (en la bitácora solo van ids y el resultado).
--
-- Idempotente y aditiva.

ALTER TABLE "identidad_incidencias" ADD COLUMN IF NOT EXISTS "respuesta"     TEXT;
ALTER TABLE "identidad_incidencias" ADD COLUMN IF NOT EXISTS "atendidaPorId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_atendidaPorId_fkey') THEN
    ALTER TABLE "identidad_incidencias"
      ADD CONSTRAINT "identidad_incidencias_atendidaPorId_fkey"
      FOREIGN KEY ("atendidaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_respuesta_chk') THEN
    ALTER TABLE "identidad_incidencias" ADD CONSTRAINT "identidad_incidencias_respuesta_chk"
      CHECK ("respuesta" IS NULL OR char_length("respuesta") BETWEEN 1 AND 500);
  END IF;
  -- Una incidencia resuelta lleva su respuesta, su fecha y quién la resolvió: sin eso no está resuelta.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_incidencias_resuelta_completa_chk') THEN
    ALTER TABLE "identidad_incidencias" ADD CONSTRAINT "identidad_incidencias_resuelta_completa_chk"
      CHECK ("estado" <> 'resuelta' OR ("respuesta" IS NOT NULL AND "resueltaAt" IS NOT NULL));
  END IF;
END $$;
