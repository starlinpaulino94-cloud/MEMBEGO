-- COMMERCE CORE · bitácora de las ofertas con presupuesto (Fase 5).
--
-- Una acción de auditoría por cada cosa que pasa en una oferta: crearla, editarla (incluye
-- ampliar el presupuesto), cambiar su estado (publicar, pausar, agotarse, terminar), que
-- alguien la reclame, que se canjee y que un reclamo se cierre sin canjearse (vence, se
-- cancela o se reembolsa).
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum nuevo en la
-- MISMA transacción que lo crea.

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'DEAL_CREATED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'DEAL_UPDATED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'DEAL_STATUS_CHANGED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'DEAL_CLAIMED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'DEAL_REDEEMED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'DEAL_CLAIM_CLOSED';
END $$;
