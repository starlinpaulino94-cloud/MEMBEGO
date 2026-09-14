-- P1B · Separar cobro de cumplimiento + deduplicación real de notificaciones.
-- Estrictamente aditiva: solo ADD COLUMN (nulables o con default) y un índice
-- único nuevo. Rollback: DROP COLUMN / DROP INDEX (pierde el historial de
-- cumplimiento; no toca datos de negocio).

ALTER TABLE "pago_intentos" ADD COLUMN "fulfillmentEstado" TEXT NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE "pago_intentos" ADD COLUMN "fulfillmentAt" TIMESTAMP(3);
ALTER TABLE "pago_intentos" ADD COLUMN "fulfillmentError" TEXT;
ALTER TABLE "pago_intentos" ADD COLUMN "fulfillmentIntentos" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "notificaciones" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "notificaciones_userId_dedupeKey_key" ON "notificaciones"("userId", "dedupeKey");
