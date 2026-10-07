-- COMMERCE CORE · bitácora de los pedidos Membego (Fase 3).
--
-- Una acción de auditoría por cada transición del pedido y por cada cambio de
-- monto o registro de pago. Quien hace cada cosa (empresa, cliente, empleado)
-- queda en `AuditLog.userId`; lo que hace el sistema (vencimientos) no audita
-- aquí.
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- nuevo en la MISMA transacción que lo crea.

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_CREATED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_ACCEPTED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_ADJUSTED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_READY';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_CONFIRMED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_COMPLETED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_CANCELLED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_REFUNDED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'ORDER_PAYMENT_RECORDED';
END $$;
