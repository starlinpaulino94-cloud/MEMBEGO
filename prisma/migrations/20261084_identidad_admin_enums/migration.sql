-- VERIFICACIÓN DE IDENTIDAD (Fase 4) · administración: asientos y aviso de repetición.
--
-- Dos asientos nuevos para lo que hace el equipo de Membego: resolver un caso que esperaba a una persona
-- (rechazarlo o pedir que se repita) y atender una incidencia (tomarla o resolverla). Y un aviso para la
-- persona a la que se le pide repetir la verificación sin que cuente como un rechazo.
--
-- Al FINAL de cada enum y SOLOS en su migración: PostgreSQL no deja USAR un valor de enum en la transacción
-- que lo crea (ver 20261078).

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_REVISION_RESUELTA';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_INCIDENCIA_ATENDIDA';
END $$;
DO $$ BEGIN
    ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'IDENTIDAD_REPETIR';
END $$;
