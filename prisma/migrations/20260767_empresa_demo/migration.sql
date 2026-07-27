-- Empresas de DEMOSTRACIÓN: existen para entrenar al personal, no para operar.
-- Todo lo que pasa dentro es de práctica — sus clientes, sus cobros y sus
-- números. Esta marca es la que corta, hacia afuera: la pasarela de pago real,
-- los correos salientes, la vitrina pública y las métricas de plataforma
-- (ver src/modules/demo/index.ts).
--
-- ADITIVA Y MÍNIMA: una sola columna booleana con valor por defecto. Ninguna
-- empresa existente cambia de comportamiento — todas quedan en `false`, que es
-- exactamente lo que son.
--
-- Ejecutar en el SQL Editor de Supabase. Idempotente.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "esDemo" BOOLEAN NOT NULL DEFAULT false;

-- Índice parcial: solo indexa las empresas de práctica (siempre unas pocas).
-- Lo usan tanto el panel de demostración como los filtros que las excluyen.
CREATE INDEX IF NOT EXISTS "companies_esDemo_idx"
  ON "companies" ("esDemo") WHERE "esDemo" = true;

-- ── Verificación ───────────────────────────────────────────────────────────
-- La primera fila debe decir true. La segunda debe dar 0: ninguna empresa
-- existente se convirtió en empresa de práctica por correr esto.
SELECT 'companies.esDemo' AS objeto,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'companies' AND column_name = 'esDemo') AS ok
UNION ALL
SELECT 'empresas marcadas como demo', COUNT(*) = 0
  FROM "companies" WHERE "esDemo" = true;

-- ── Acciones de auditoría nuevas ───────────────────────────────────────────
-- Marcar/desmarcar una empresa de práctica y reiniciarla dejan rastro. Añadir
-- valores a un enum es aditivo: ningún valor existente cambia ni se elimina.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'EMPRESA_DEMO_CAMBIADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'EMPRESA_DEMO_REINICIADA';
