-- VERIFICACIÓN DE IDENTIDAD (Fase 2) · acciones de la bitácora del proveedor.
--
-- Dos asientos nuevos: la sesión del proveedor se borró (la prueba de «procesar y purgar»: el proveedor
-- no se queda con los documentos) y un aviso del proveedor se descartó por no cuadrar con nuestro intento
-- (señal de seguridad: alguien mandó algo que no es de ese intento). El payload lleva CÓDIGOS e ids.
--
-- Al FINAL del enum y solos en su migración: PostgreSQL no deja USAR un valor de enum en la transacción
-- que lo crea (ver 20261078).

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_SESION_PURGADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'IDENTIDAD_EVENTO_DESCARTADO';
