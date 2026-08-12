-- Rastro de los cambios en el CATÁLOGO, que es lo que los clientes compran.
--
-- Hasta ahora, crear un plan, cambiarle el PRECIO, pausarlo o eliminarlo no
-- dejaba una sola línea en `audit_logs`. Si un cliente reclamaba «yo compré
-- esto a RD$1,200», no había forma de saber cuánto costaba ese plan la semana
-- pasada ni quién lo cambió. La única acción del módulo que sí se auditaba era
-- cancelar una membresía.
--
-- `PLAN_ACTUALIZADO` guarda en su payload el precio anterior y el nuevo, que es
-- el dato por el que se pregunta.
--
-- Pausar y reanudar van separados a propósito, en vez de un solo valor con el
-- estado en el payload: la pantalla de Auditoría filtra POR ACCIÓN, así que dos
-- valores permiten preguntar «¿quién dejó de ofrecer planes este mes?» sin
-- abrir línea por línea.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PLAN_CREADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PLAN_ACTUALIZADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PLAN_PAUSADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PLAN_REANUDADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PLAN_ELIMINADO';
