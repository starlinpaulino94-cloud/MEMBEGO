-- COMMERCE CORE · verificación de pago: los valores de enum (sprint de cierre, 2026-10-08).
--
-- Van en su propia migración porque PostgreSQL no permite USAR un valor de enum nuevo en
-- la misma transacción que lo crea; la migración siguiente (20261051) los usa.
--
--   · `EXTERNAL_PAYMENT_REPORTED`: el negocio AFIRMA que cobró con tarjeta o transferencia
--     (referencia tecleada). Hasta hoy eso elevaba el pedido a `PAYMENT_VERIFIED` y, en el
--     modelo HYBRID, cobraba el 8 % sobre la palabra de la empresa. Desde ahora
--     `PAYMENT_VERIFIED` queda reservado a una fuente externa confiable.
--     Se añade AL FINAL del enum (ADD VALUE sin BEFORE) para que el diff de Prisma no
--     vea deriva; el orden de evidencia lo fija `NIVELES` en el dominio de pedidos.
--   · `MembegoPaymentEvidenceSource`: quién respalda una constancia de pago.
--   · `VERIFICATION_ADJUSTMENT`: el asiento con la diferencia de comisión cuando el pago se
--     verifica después de cobrar el CPA (append-only; la comisión original no se edita).

ALTER TYPE "MembegoVerificationLevel" ADD VALUE IF NOT EXISTS 'EXTERNAL_PAYMENT_REPORTED';

ALTER TYPE "MerchantLedgerEntryType" ADD VALUE IF NOT EXISTS 'VERIFICATION_ADJUSTMENT';

-- Bitácora: «una fuente externa verificó el pago» (distinto de «la empresa registró un pago»).
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_PAYMENT_VERIFIED';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'COMMISSION_VERIFICATION_ADJUSTED';

DO $$ BEGIN
    CREATE TYPE "MembegoPaymentEvidenceSource" AS ENUM ('MERCHANT_REPORTED', 'GATEWAY_VERIFIED', 'BANK_RECONCILED', 'PROVIDER_VERIFIED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
