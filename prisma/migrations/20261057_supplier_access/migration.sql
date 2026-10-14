-- SUPPLIER & FULFILLMENT COMMERCE · Slice 1 · acceso operativo del proveedor (Supplier Lite).
--
-- QUÉ CAMBIA. Un proveedor de Membego Supply tenía dos estados posibles de
-- acceso y ninguno estaba escrito: o era una `Company` registrada (y entraba al
-- portal `/admin/supply` con la capacidad MEMBEGO_SUPPLIER) o era EXTERNO y
-- operativamente anónimo. Desde aquí el acceso es una columna con su propio
-- ciclo (`accessStatus`), separado del estado comercial (`status`):
--
--   DRAFT → INVITED → ACTIVATION_PENDING → ACTIVE ⇄ SUSPENDED → TERMINATED
--
-- y ACTIVE exige la lista de preparación completa (`fulfillmentReadyAt`) o una
-- dispensa con motivo (`readinessWaivedAt` + `readinessWaivedReason`).
--
-- DATOS EXISTENTES (relevamiento §61). No se borra ni se recrea ningún
-- proveedor. Se clasifican:
--   · con empresa vinculada y status ACTIVE  → accessStatus ACTIVE con dispensa
--     'LEGACY_BACKFILL' (ya operaban por el portal; sus acuerdos no se rompen);
--   · con empresa vinculada y status INACTIVE/BLOCKED → SUSPENDED / TERMINATED;
--   · sin empresa (EXTERNAL) → DRAFT: hay que invitarlos (ACTIVE_WITHOUT_ACCESS).
--
-- Las invitaciones de equipo ganan `permisos` (el preset del rol de proveedor
-- que recibe la cuenta al aceptar) y `origen`.
--
-- Aditiva e idempotente.

ALTER TABLE "invitaciones" ADD COLUMN IF NOT EXISTS "origen" TEXT;
ALTER TABLE "invitaciones" ADD COLUMN IF NOT EXISTS "permisos" JSONB;

ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "accessStatus" "SupplyV2SupplierAccessStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "accessStatusReason" TEXT;
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "fulfillmentReadyAt" TIMESTAMP(3);
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "invitedEmail" TEXT;
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "qrTestCode" TEXT;
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "qrTestedAt" TIMESTAMP(3);
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "readinessWaivedAt" TIMESTAMP(3);
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "readinessWaivedReason" TEXT;
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "supply_v2_suppliers" ADD COLUMN IF NOT EXISTS "termsAcceptedById" TEXT;

CREATE INDEX IF NOT EXISTS "supply_v2_suppliers_accessStatus_idx" ON "supply_v2_suppliers"("accessStatus");

DO $$ BEGIN
    ALTER TABLE "supply_v2_suppliers" ADD CONSTRAINT "supply_v2_suppliers_termsAcceptedById_fkey"
        FOREIGN KEY ("termsAcceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas en la base ────────────────────────────────────────────────────────
-- Una dispensa siempre lleva motivo; ACTIVE exige preparación o dispensa.
-- OJO con los NULL: un CHECK que evalúa a NULL se acepta, por eso cada regla
-- se escribe como implicación explícita.
DO $$ BEGIN
    ALTER TABLE "supply_v2_suppliers" ADD CONSTRAINT "supply_v2_suppliers_dispensa_con_motivo"
        CHECK ("readinessWaivedAt" IS NULL OR ("readinessWaivedReason" IS NOT NULL AND length(btrim("readinessWaivedReason")) > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_v2_suppliers" ADD CONSTRAINT "supply_v2_suppliers_acceso_activo_preparado"
        CHECK ("accessStatus" <> 'ACTIVE' OR "fulfillmentReadyAt" IS NOT NULL OR "readinessWaivedAt" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Relevamiento de los proveedores existentes (idempotente) ─────────────────
-- Solo toca filas que siguen en DRAFT sin dispensa: una segunda ejecución no
-- pisa nada que el superadmin ya haya decidido.
UPDATE "supply_v2_suppliers"
   SET "accessStatus" = 'ACTIVE',
       "activatedAt" = COALESCE("activatedAt", "createdAt"),
       "readinessWaivedAt" = COALESCE("readinessWaivedAt", now()),
       "readinessWaivedReason" = COALESCE("readinessWaivedReason", 'LEGACY_BACKFILL: proveedor con empresa vinculada antes de Supplier Lite; sus acuerdos no se interrumpen.')
 WHERE "companyId" IS NOT NULL
   AND "status" = 'ACTIVE'
   AND "accessStatus" = 'DRAFT'
   AND "readinessWaivedAt" IS NULL;

UPDATE "supply_v2_suppliers"
   SET "accessStatus" = CASE WHEN "status" = 'BLOCKED' THEN 'TERMINATED'::"SupplyV2SupplierAccessStatus" ELSE 'SUSPENDED'::"SupplyV2SupplierAccessStatus" END,
       "accessStatusReason" = COALESCE("accessStatusReason", 'LEGACY_BACKFILL: estado comercial ' || "status" || '.')
 WHERE "companyId" IS NOT NULL
   AND "status" IN ('INACTIVE', 'BLOCKED')
   AND "accessStatus" = 'DRAFT';

DO $$
DECLARE
    v_con_acceso INTEGER;
    v_sin_acceso INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_con_acceso FROM "supply_v2_suppliers" WHERE "accessStatus" = 'ACTIVE';
    SELECT COUNT(*) INTO v_sin_acceso FROM "supply_v2_suppliers" WHERE "accessStatus" = 'DRAFT';
    RAISE NOTICE 'supplier_access: % proveedor(es) con acceso (dispensa histórica), % sin acceso (hay que invitarlos).', v_con_acceso, v_sin_acceso;
END $$;
