-- COMMERCE CORE · bitácora del puente Supply → Catálogo (Fase 2.5).
--
-- Una acción de auditoría: el superadmin designó o retiró la empresa de la casa
-- (de ella cuelgan los ítems puente). Va en su propia migración porque
-- PostgreSQL no permite usar un valor de enum nuevo en la MISMA transacción que
-- lo crea.

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_BRIDGE_HOUSE_CHANGED';
END $$;
