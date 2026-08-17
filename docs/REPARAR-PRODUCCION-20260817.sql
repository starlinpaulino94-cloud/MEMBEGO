-- ═══════════════════════════════════════════════════════════════════════════
-- REPARACIÓN DE PRODUCCIÓN · 17-08-2026
-- Migraciones que están en el código pero no en la base de datos.
-- Todo es idempotente: si alguna ya se aplicó, no pasa nada al repetirla.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · LO QUE ROMPE EL ESCÁNER  ← la causa del error que estás viendo
--     El escáner lee las visitas del cliente con TODAS sus columnas. Sin
--     estas cuatro, PostgreSQL responde «column does not exist» y la acción
--     del servidor revienta antes de contestar.
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaAt"         TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaMotivo"     TEXT;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaPorId"      TEXT;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaPorSistema" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visits_revertidaPorId_fkey'
  ) THEN
    ALTER TABLE "visits"
      ADD CONSTRAINT "visits_revertidaPorId_fkey"
      FOREIGN KEY ("revertidaPorId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "visits_revertidas_idx"
  ON "visits" ("revertidaAt")
  WHERE "revertidaAt" IS NOT NULL;

-- 2 · VALORES DE AUDITORÍA
--     Cada acción que el sistema audita tiene que existir en este tipo. Si
--     falta, la operación entera falla al intentar dejar su rastro.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'VISITA_REVERTIDA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'MEMBRESIA_DESACTIVADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'PROMOCION_CREADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CAMPANA_APLICADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CAMPANA_ARCHIVADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CAPACIDADES_ACTUALIZADAS';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INTEGRACION_SONDEADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INTEGRACION_REINTENTADA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'INTEGRACION_REENCOLADA';

-- 3 · ALINEACIÓN DE ESQUEMA (no toca datos)
ALTER TABLE "solicitudes_empresa" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "comision_entradas"   ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "comision_reglas"     ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursion_variantes" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursiones"         ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursiones_config"  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "liquidaciones"       ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "reservas_excursion"  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedor_bonos"      ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedor_metas"      ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedores"          ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ventas_excursion"    ALTER COLUMN "updatedAt" DROP DEFAULT;

-- `IF EXISTS` y no un bloque con EXCEPTION: si el índice ya se renombró, el
-- error de PostgreSQL es «undefined_table», no «undefined_object», y un
-- EXCEPTION mal elegido no lo atrapa.
ALTER INDEX IF EXISTS "vendedor_atribuciones_embudo_idx"
  RENAME TO "vendedor_atribuciones_companyId_vendedorId_etapa_createdAt_idx";
