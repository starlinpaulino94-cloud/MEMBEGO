-- VERIFICACIÓN DE IDENTIDAD (Fase 5) · las reglas por función.
--
-- Una fila por OPERACIÓN en la que Membego puede pedir identidad verificada (hoy: el pago a un proveedor
-- de Supply). Es configuración de la PLATAFORMA —solo la lee y la escribe el superadmin y el servicio—, no
-- de una persona ni de una empresa. NACE VACÍA = ninguna regla: sin fila, la operación no pide nada. Las compras,
-- promociones, membresías, renovaciones y accesos no tienen fila ni pueden tenerla (el CHECK lo impide).
--
-- Idempotente y aditiva. La política de seguridad por fila está en
-- prisma/migrations_manual/2026-10-rls-identidad.sql (solo omnisciente, como el interruptor).

CREATE TABLE IF NOT EXISTS "identidad_reglas" (
    "operacion"   TEXT         NOT NULL,
    "activa"      BOOLEAN      NOT NULL DEFAULT false,
    "alcance"     TEXT         NOT NULL DEFAULT 'primer_pago',
    "reason"      TEXT,
    "changedById" TEXT,
    "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identidad_reglas_pkey" PRIMARY KEY ("operacion")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_reglas_changedById_fkey') THEN
    ALTER TABLE "identidad_reglas"
      ADD CONSTRAINT "identidad_reglas_changedById_fkey"
      FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- La segunda barrera: una operación inventada (o una compra) no entra, ni por fuera del servicio.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_reglas_operacion_chk') THEN
    ALTER TABLE "identidad_reglas" ADD CONSTRAINT "identidad_reglas_operacion_chk"
      CHECK ("operacion" IN ('PAGO_A_PROVEEDOR'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_reglas_alcance_chk') THEN
    ALTER TABLE "identidad_reglas" ADD CONSTRAINT "identidad_reglas_alcance_chk"
      CHECK ("alcance" IN ('primer_pago', 'todos'));
  END IF;
  -- Encender una regla deja dicho por qué: un candado sin motivo es una avería que nadie sabe explicar.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_reglas_motivo_chk') THEN
    ALTER TABLE "identidad_reglas" ADD CONSTRAINT "identidad_reglas_motivo_chk"
      CHECK (NOT "activa" OR ("reason" IS NOT NULL AND char_length("reason") BETWEEN 1 AND 300));
  END IF;
END $$;

ALTER TABLE "identidad_reglas" ENABLE ROW LEVEL SECURITY;
