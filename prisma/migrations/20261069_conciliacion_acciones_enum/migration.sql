-- CONCILIACIÓN ACCIONABLE (pago con tarjeta → comprobante, fase 4) · acciones de la bitácora.
--
-- La conciliación deja de ser solo una lista: desde ella se puede GENERAR el comprobante de un
-- cobro con tarjeta, REINTENTAR su entrega o MARCARLA como entregada. Cada una mueve dinero o
-- estado de un cliente, así que cada una deja su asiento en la bitácora con quién la hizo.
--
-- Se añaden AL FINAL del enum (ADD VALUE sin BEFORE) para que el diff de Prisma no vea deriva.
-- Van solas en su migración: PostgreSQL no deja USAR un valor de enum en la transacción que lo crea.

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONCILIACION_COMPROBANTE_GENERADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONCILIACION_ENTREGA_REINTENTADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONCILIACION_ENTREGA_MARCADA';
