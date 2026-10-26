-- VERIFICACIÓN DE IDENTIDAD (Fase 3) · avisos a la persona y asiento de las incidencias.
--
-- Tres avisos nuevos para la campana de la persona (verificada, no se pudo, en revisión) y un asiento
-- de bitácora para cuando la persona reporta un problema con su verificación. Sus textos viven en
-- src/modules/identidad/avisosCore.ts y no llevan datos personales ni el motivo de un rechazo por fraude.
--
-- Al FINAL de cada enum y SOLOS en su migración: PostgreSQL no deja USAR un valor de enum en la
-- transacción que lo crea (ver 20261078).

DO $$ BEGIN
    ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'IDENTIDAD_VERIFICADA';
END $$;
DO $$ BEGIN
    ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'IDENTIDAD_RECHAZADA';
END $$;
DO $$ BEGIN
    ALTER TYPE "NotifTipo" ADD VALUE IF NOT EXISTS 'IDENTIDAD_EN_REVISION';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_INCIDENCIA_REPORTADA';
END $$;
