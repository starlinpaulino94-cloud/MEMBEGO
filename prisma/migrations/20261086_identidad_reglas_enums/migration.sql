-- VERIFICACIÓN DE IDENTIDAD (Fase 5) · reglas por función: el asiento del cambio de una regla.
--
-- Al FINAL del enum y SOLO en su migración: PostgreSQL no deja USAR un valor de enum en la transacción
-- que lo crea (ver 20261078).

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_REGLA_CAMBIADA';
END $$;
