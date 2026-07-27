-- Clientes de MOSTRADOR: gente que viene a lavar sin tener cuenta en la
-- plataforma. Hasta ahora esos lavados se anotaban fuera del sistema.
--
-- ADITIVA Y MÍNIMA: una sola columna booleana con valor por defecto. Ninguna
-- fila existente cambia de comportamiento — todos los clientes actuales quedan
-- en `false`, que es exactamente lo que son.
--
-- Ejecutar en el SQL Editor de Supabase. Idempotente.

ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "esLocal" BOOLEAN NOT NULL DEFAULT false;

-- Índice para listar los de mostrador de una empresa sin recorrer toda la
-- tabla. Parcial: solo indexa los que son de mostrador, que son los que se
-- filtran por esta columna.
CREATE INDEX IF NOT EXISTS "clientes_companyId_esLocal_idx"
  ON "clientes" ("companyId") WHERE "esLocal" = true;

-- ── Verificación ───────────────────────────────────────────────────────────
-- La primera fila debe decir true. La segunda debe dar 0: ningún cliente
-- existente se convirtió en cliente de mostrador por correr esto.
SELECT 'clientes.esLocal' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'clientes' AND column_name = 'esLocal') AS ok
UNION ALL
SELECT 'clientes marcados como mostrador', COUNT(*) = 0
  FROM "clientes" WHERE "esLocal" = true;
