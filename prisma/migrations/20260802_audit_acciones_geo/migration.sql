-- ============================================================================
-- Reparación del historial: valores de `AuditAccion` que faltaban.
-- ============================================================================
-- La fase de geolocalización añadió nueve acciones de auditoría al esquema
-- (`prisma/schema/identidad.prisma`) pero `20260801_geo_fundaciones` nunca las
-- añadió al enum de la base. El esquema y el historial llevan divergiendo desde
-- entonces, y el trabajo `esquema` del CI —el que existe justamente para
-- detectar «alguien editó el esquema y olvidó la migración»— falla por esto.
--
-- No se toca la migración ya aplicada: se repara con una nueva.
--
-- `ADD VALUE IF NOT EXISTS` para que sea idempotente y para que no reviente en
-- las bases donde los valores ya entraron por `prisma db push`.
-- ============================================================================

ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'UBICACION_GUARDADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'UBICACION_ELIMINADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONSENTIMIENTO_GEO_OTORGADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CONSENTIMIENTO_GEO_REVOCADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUCURSAL_UBICACION_GUARDADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUCURSAL_UBICACION_VERIFICADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CATALOGO_GEO_APROBADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SEGMENTO_EVALUADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CAMPANA_DIRIGIDA_ENVIADA';
