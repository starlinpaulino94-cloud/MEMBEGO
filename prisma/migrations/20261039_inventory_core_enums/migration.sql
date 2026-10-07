-- COMMERCE CORE · bitácora del inventario (Fase 2).
--
-- Tres acciones de auditoría para lo que una persona hace a mano con el stock:
-- mover existencias (entrada, ajuste, daño, devolución), transferir entre
-- sucursales y fijar el umbral de stock bajo. Las ventas y las reservas que
-- hace el sistema no auditan aquí: ya quedan en el ledger
-- (`inventory_movements`), que es más fino que cualquier bitácora.
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- nuevo en la MISMA transacción que lo crea.

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INVENTORY_STOCK_CHANGED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INVENTORY_TRANSFERRED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INVENTORY_CONFIGURED';
END $$;
