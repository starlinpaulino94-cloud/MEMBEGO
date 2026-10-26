-- VERIFICACIÓN DE IDENTIDAD (Fase 1) · acciones de la bitácora.
--
-- Cada paso que cambia el resultado de identidad de una persona deja su asiento: quién lo inició, qué
-- decidió el proveedor, quién lo revocó, quién del equipo de Membego miró el estado de alguien. El
-- payload lleva CÓDIGOS y ids, nunca nombre, documento, imagen ni texto del proveedor.
--
-- Se añaden AL FINAL del enum (ADD VALUE sin BEFORE) para que el diff de Prisma no vea deriva.
-- Van solas en su migración: PostgreSQL no deja USAR un valor de enum en la transacción que lo crea.

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_VERIFICACION_INICIADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_VERIFICACION_APROBADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_VERIFICACION_EN_REVISION';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_VERIFICACION_RECHAZADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_VERIFICACION_REVOCADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_VERIFICACION_EXPIRADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_REVALIDACION_REQUERIDA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_ESTADO_CONSULTADO_POR_STAFF';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_INTERRUPTOR_CAMBIADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_SUPRESION_SOLICITADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_SUPRESION_COMPLETADA';
