-- COMMERCE CORE · bitácora de Merchant Billing (Fase 4).
--
-- Una acción de auditoría por cada cosa que hace UNA PERSONA sobre la cuenta de
-- una empresa: cambiar su configuración de cobro, asentar un pago, un ajuste o un
-- crédito, y cambiar su estado de cuenta (activa, en gracia, suspendida). Las
-- comisiones que genera el sistema no auditan aquí: su rastro es el propio libro,
-- que es inmutable.
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- nuevo en la MISMA transacción que lo crea.

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'BILLING_CONFIG_CHANGED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'BILLING_ENTRY_RECORDED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'BILLING_STATUS_CHANGED';
END $$;
