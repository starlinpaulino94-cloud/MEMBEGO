-- COMMERCE CORE · inventario con ledger (Fase 2 del Plan Maestro).
--
-- Cuánto hay de cada VARIANTE del catálogo unificado en cada SUCURSAL.
-- `inventory_levels` es el saldo (caché), `inventory_movements` el ledger que
-- lo explica y `inventory_reservations` lo apartado con fecha de vencimiento.
--
-- ADITIVA E IDEMPOTENTE. Solo toca las tablas existentes para añadir dos
-- índices únicos `(id, companyId)` —destino de las FK compuestas— que no
-- cambian ningún dato ni ninguna consulta. Por sí sola no cambia nada visible:
-- nadie escribe en estas tablas sin la capacidad CATALOGO_UNIFICADO y sin que
-- el ítem tenga activado `trackInventory`.
--
-- Los valores nuevos de `AuditAccion` van aparte, en `20261039_inventory_core_enums`.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "InventoryBucket" AS ENUM ('AVAILABLE', 'RESERVED', 'DAMAGED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'DAMAGE', 'RESERVATION', 'RESERVATION_RELEASE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Destinos de las FK compuestas ───────────────────────────────────────────
-- (id, companyId) ya es único por construcción (id lo es solo); el índice existe
-- para que PostgreSQL acepte una FK compuesta hacia esas columnas.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_variants_id_companyId_key"
  ON "catalog_variants" ("id", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "sucursales_id_companyId_key"
  ON "sucursales" ("id", "companyId");

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_levels" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,
    "catalogVariantId"  TEXT NOT NULL,
    "locationId"        TEXT NOT NULL,
    "onHand"            INTEGER NOT NULL DEFAULT 0,
    "reserved"          INTEGER NOT NULL DEFAULT 0,
    "damaged"           INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_movements" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,
    "inventoryLevelId"  TEXT NOT NULL,
    "type"              "InventoryMovementType" NOT NULL,
    "sourceBucket"      "InventoryBucket",
    "destinationBucket" "InventoryBucket",
    "quantity"          INTEGER NOT NULL,
    "previousOnHand"    INTEGER NOT NULL,
    "newOnHand"         INTEGER NOT NULL,
    "reason"            TEXT,
    "userId"            TEXT,
    "referenceType"     TEXT,
    "referenceId"       TEXT,
    "idempotencyKey"    TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_reservations" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "inventoryLevelId" TEXT NOT NULL,
    "quantity"         INTEGER NOT NULL,
    "status"           "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "referenceType"    TEXT,
    "referenceId"      TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"       TIMESTAMP(3),
    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
-- Una fila de saldo por variante y sucursal.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_levels_catalogVariantId_locationId_key"
  ON "inventory_levels" ("catalogVariantId", "locationId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_levels_id_companyId_key"
  ON "inventory_levels" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "inventory_levels_companyId_locationId_idx"
  ON "inventory_levels" ("companyId", "locationId");

-- NULL no choca con NULL: los movimientos sin clave conviven; dos con la misma
-- clave en la misma empresa, no.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_movements_companyId_idempotencyKey_key"
  ON "inventory_movements" ("companyId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "inventory_movements_inventoryLevelId_createdAt_idx"
  ON "inventory_movements" ("inventoryLevelId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_movements_companyId_createdAt_idx"
  ON "inventory_movements" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_movements_companyId_referenceType_referenceId_idx"
  ON "inventory_movements" ("companyId", "referenceType", "referenceId");

-- El barrido de vencimientos busca ACTIVE con expiresAt pasado.
CREATE INDEX IF NOT EXISTS "inventory_reservations_status_expiresAt_idx"
  ON "inventory_reservations" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "inventory_reservations_inventoryLevelId_status_idx"
  ON "inventory_reservations" ("inventoryLevelId", "status");
CREATE INDEX IF NOT EXISTS "inventory_reservations_companyId_referenceType_referenceId_idx"
  ON "inventory_reservations" ("companyId", "referenceType", "referenceId");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId) hacia la variante y la sucursal: la base rechaza un
-- saldo que junte la variante de una empresa con la sucursal de otra. Todas
-- RESTRICT: con historial de movimientos no se borra ni la variante ni la
-- sucursal (el historial es contabilidad); se descontinúa o se desactiva.
DO $$ BEGIN
    ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_locationId_companyId_fkey"
      FOREIGN KEY ("locationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventoryLevelId_companyId_fkey"
      FOREIGN KEY ("inventoryLevelId", "companyId") REFERENCES "inventory_levels"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_inventoryLevelId_companyId_fkey"
      FOREIGN KEY ("inventoryLevelId", "companyId") REFERENCES "inventory_levels"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- SALDO. Ninguna cubeta en negativo, y lo apartado nunca supera lo que hay
-- (`available = onHand − reserved` no puede ser negativo). Aunque el servicio ya
-- lo comprueba, estas reglas valen para cualquier otra puerta: un script, una
-- importación, una acción futura.
DO $$ BEGIN
    ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_saldos"
      CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0
             AND "reserved" <= "onHand" AND "lowStockThreshold" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- LEDGER. Un movimiento mueve una cantidad positiva y declara de dónde sale y a
-- dónde entra (al menos uno, y distintos).
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_forma"
      CHECK ("quantity" > 0 AND "previousOnHand" >= 0 AND "newOnHand" >= 0
             AND ("sourceBucket" IS NOT NULL OR "destinationBucket" IS NOT NULL)
             AND ("sourceBucket" IS DISTINCT FROM "destinationBucket"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cada tipo de movimiento solo puede hacer ciertos traslados. Es la MISMA tabla
-- que `modules/inventory/domain.ts` (MOVIMIENTOS_PERMITIDOS); una prueba contra
-- la base comprueba las 144 combinaciones para que no se separen.
--
-- OJO con los NULL: `"sourceBucket" = 'AVAILABLE'` con origen NULL da NULL, no
-- falso, y un CHECK que evalúa a NULL SE ACEPTA. Por eso las comparaciones usan
-- IS NOT DISTINCT FROM y toda la expresión va envuelta en coalesce(…, false):
-- lo que no encaje en ninguna rama se rechaza. (La prueba de las 144
-- combinaciones lo cazó: sin esto, DAMAGE de «nada» a DAMAGED pasaba.)
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_traslado"
      CHECK (coalesce(
        ("type" = 'PURCHASE'            AND "sourceBucket" IS NULL                                  AND "destinationBucket" IS NOT DISTINCT FROM 'AVAILABLE')
     OR ("type" = 'RETURN'              AND "sourceBucket" IS NULL                                  AND "destinationBucket" IS NOT DISTINCT FROM 'AVAILABLE')
     OR ("type" = 'TRANSFER_IN'         AND "sourceBucket" IS NULL                                  AND "destinationBucket" IS NOT DISTINCT FROM 'AVAILABLE')
     OR ("type" = 'TRANSFER_OUT'        AND "sourceBucket" IS NOT DISTINCT FROM 'AVAILABLE'         AND "destinationBucket" IS NULL)
     OR ("type" = 'SALE'                AND "sourceBucket" IN ('AVAILABLE', 'RESERVED')             AND "destinationBucket" IS NULL)
     OR ("type" = 'DAMAGE'              AND "sourceBucket" IS NOT DISTINCT FROM 'AVAILABLE'         AND "destinationBucket" IS NOT DISTINCT FROM 'DAMAGED')
     OR ("type" = 'RESERVATION'         AND "sourceBucket" IS NOT DISTINCT FROM 'AVAILABLE'         AND "destinationBucket" IS NOT DISTINCT FROM 'RESERVED')
     OR ("type" = 'RESERVATION_RELEASE' AND "sourceBucket" IS NOT DISTINCT FROM 'RESERVED'          AND "destinationBucket" IS NOT DISTINCT FROM 'AVAILABLE')
     OR ("type" = 'ADJUSTMENT' AND (
              ("sourceBucket" IS NULL                                  AND "destinationBucket" IS NOT DISTINCT FROM 'AVAILABLE')
           OR ("sourceBucket" IS NOT DISTINCT FROM 'AVAILABLE'         AND "destinationBucket" IS NULL)
           OR ("sourceBucket" IS NOT DISTINCT FROM 'DAMAGED'           AND "destinationBucket" IS NULL)
           OR ("sourceBucket" IS NOT DISTINCT FROM 'DAMAGED'           AND "destinationBucket" IS NOT DISTINCT FROM 'AVAILABLE')))
      , false));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un ajuste o un daño sin motivo es un faltante sin explicación.
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_motivo"
      CHECK ("type" NOT IN ('ADJUSTMENT', 'DAMAGE') OR length(btrim(coalesce("reason", ''))) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_forma"
      CHECK ("quantity" > 0
             AND (("status" = 'ACTIVE' AND "resolvedAt" IS NULL) OR ("status" <> 'ACTIVE' AND "resolvedAt" IS NOT NULL)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── El ledger NO se edita ───────────────────────────────────────────────────
-- `inventory_movements` es append-only: ni UPDATE, ni DELETE, ni TRUNCATE. Un
-- error se corrige con OTRO movimiento (ADJUSTMENT), que deja rastro de qué se
-- corrigió y por qué. Va en la base y no solo en el servicio porque el servicio
-- no es la única puerta.
--
-- (`session_replication_role = replica`, que solo puede poner un superusuario,
-- desactiva los disparadores ordinarios: es la salida de las pruebas y de una
-- intervención deliberada de operaciones, no de la aplicación.)
CREATE OR REPLACE FUNCTION inventory_movements_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_movements_inmutable: el ledger de inventario no admite % (movimiento %).', TG_OP, COALESCE(OLD."id", '-')
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_movements_sin_cambios" ON "inventory_movements";
CREATE TRIGGER "inventory_movements_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_movements"
    FOR EACH ROW EXECUTE FUNCTION inventory_movements_inmutable();

CREATE OR REPLACE FUNCTION inventory_movements_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_movements_inmutable: el ledger de inventario no admite TRUNCATE.'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_movements_sin_truncate" ON "inventory_movements";
CREATE TRIGGER "inventory_movements_sin_truncate"
    BEFORE TRUNCATE ON "inventory_movements"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_movements_sin_truncate();
