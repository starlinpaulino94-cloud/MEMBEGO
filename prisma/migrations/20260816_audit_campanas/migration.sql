-- Rastro del REPARTO de campañas conjuntas.
--
-- Aplicar una campaña crea promociones y planes REALES en N empresas ajenas, y
-- archivarla los DESACTIVA en todas. Era la operación que más filas escribe de
-- todo el panel y la que menos rastro dejaba:
--
--   · Aplicar se registraba como `NOTA_INTERNA` con `payload.tipo =
--     'CAMPANA_GLOBAL_APLICADA'`, un subtipo que ni siquiera estaba en
--     `SUBTIPO_LABEL`: salía en crudo y no se podía filtrar.
--   · Archivar no registraba NADA.
--   · Los planes y promociones generados se creaban con `tx.plan.create` /
--     `tx.promocion.create` directos, saltándose la bitácora del catálogo.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PROMOCION_CREADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CAMPANA_APLICADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CAMPANA_ARCHIVADA';
