-- INV-3a · COSTO Y VALOR DEL INVENTARIO.
--
-- Hasta ahora el ledger sabía CUÁNTO se movió pero no A QUÉ COSTO: no había costo promedio, valor del inventario ni costo
-- de ventas. Esta migración añade lo mínimo para que lo haya:
--
--   · `inventory_movements."unitCost"`: el costo unitario con que se VALORÓ cada movimiento. En una entrada es el que se
--     capturó; en una venta, devolución, daño o ajuste, el costo promedio vigente en ese instante (queda congelado: el
--     costo de ventas de un mes no cambia aunque el promedio cambie después). NULL = sin costo (los movimientos
--     anteriores a esta migración, y los de reservas y transferencias).
--   · `inventory_receipt_lines."unitCost"`: el costo capturado en cada línea de una entrada.
--   · `inventory_variant_costs`: el costo PROMEDIO PONDERADO de cada producto (uno por producto para toda la empresa).
--     Es una caché que mantienen las entradas con costo y las correcciones; se crea con la primera de cualquiera de las dos.
--   · `inventory_cost_adjustments`: el historial inmutable de las correcciones de costo (quién, de cuánto a cuánto, por qué).
--
-- ADITIVA E IDEMPOTENTE. Solo AÑADE dos columnas NULL (sin valor por defecto: PostgreSQL no reescribe la tabla), dos tablas
-- nuevas y sus índices, claves, CHECK y disparadores. No toca ninguna fila existente. Los CHECK de las dos tablas viejas se
-- crean `NOT VALID` y se validan aparte, para no mantener bloqueada la tabla de movimientos mientras se recorre.
--
-- ORDEN DE DESPLIEGUE (docs/MIGRACIONES.md) — AQUÍ ES OBLIGATORIO: ESTE SQL PRIMERO en Supabase, el código después. A
-- diferencia de las migraciones de INV-2, ésta toca `inventory_movements`, que escribe CADA venta, y el código nuevo lee y
-- escribe `unitCost` en todos sus movimientos. Con el SQL aplicado y el código viejo no pasa nada (la columna se ignora);
-- con el código nuevo y SIN el SQL, el inventario y los pedidos fallan.

-- ── Columnas nuevas en las tablas existentes ────────────────────────────────
ALTER TABLE "inventory_movements"     ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(14,4);
ALTER TABLE "inventory_receipt_lines" ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(14,4);

-- Un costo unitario va de 0 a cien millones (el tope que valida la aplicación). Cero es válido: una muestra regalada.
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_costo"
      CHECK ("unitCost" IS NULL OR ("unitCost" >= 0 AND "unitCost" <= 100000000)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "inventory_movements" VALIDATE CONSTRAINT "inventory_movements_costo";

DO $$ BEGIN
    ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_costo"
      CHECK ("unitCost" IS NULL OR ("unitCost" >= 0 AND "unitCost" <= 100000000)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "inventory_receipt_lines" VALIDATE CONSTRAINT "inventory_receipt_lines_costo";

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_variant_costs" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "averageCost"      DECIMAL(14,4) NOT NULL,
    "lastCost"         DECIMAL(14,4),
    "lastCostAt"       TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_variant_costs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_cost_adjustments" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "previousCost"     DECIMAL(14,4),
    "newCost"          DECIMAL(14,4) NOT NULL,
    "unitsOnHand"      INTEGER NOT NULL,
    "reason"           TEXT NOT NULL,
    "userId"           TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_cost_adjustments_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
-- Un solo costo por producto (la FK compuesta pide que la pareja sea única).
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_variant_costs_catalogVariantId_companyId_key"
  ON "inventory_variant_costs" ("catalogVariantId", "companyId");
CREATE INDEX IF NOT EXISTS "inventory_variant_costs_companyId_idx"
  ON "inventory_variant_costs" ("companyId");
CREATE INDEX IF NOT EXISTS "inventory_cost_adjustments_companyId_createdAt_idx"
  ON "inventory_cost_adjustments" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_cost_adjustments_catalogVariantId_createdAt_idx"
  ON "inventory_cost_adjustments" ("catalogVariantId", "createdAt");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId) hacia la variante: la base rechaza un costo que junte la empresa de uno con el producto de
-- otro. RESTRICT: con costo o historial de costo no se borra el producto.
DO $$ BEGIN
    ALTER TABLE "inventory_variant_costs" ADD CONSTRAINT "inventory_variant_costs_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_variant_costs" ADD CONSTRAINT "inventory_variant_costs_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- Costos de 0 a cien millones; la corrección explica qué cambió y por qué, y no deja un motivo en blanco.
DO $$ BEGIN
    ALTER TABLE "inventory_variant_costs" ADD CONSTRAINT "inventory_variant_costs_forma"
      CHECK ("averageCost" >= 0 AND "averageCost" <= 100000000
             AND ("lastCost" IS NULL OR ("lastCost" >= 0 AND "lastCost" <= 100000000)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_cost_adjustments" ADD CONSTRAINT "inventory_cost_adjustments_forma"
      CHECK ("newCost" >= 0 AND "newCost" <= 100000000
             AND ("previousCost" IS NULL OR ("previousCost" >= 0 AND "previousCost" <= 100000000))
             AND "unitsOnHand" >= 0
             AND btrim("reason") <> '' AND length("reason") <= 300);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Lo que no se reescribe ──────────────────────────────────────────────────
-- Igual que el ledger, las entradas, los conteos y las transferencias: va en la base y no solo en el servicio, porque el
-- servicio no es la única puerta. (`session_replication_role = replica`, que solo puede poner un superusuario, desactiva los
-- disparadores ordinarios: es la salida de las pruebas y de una intervención deliberada de operaciones.)
--
-- Una corrección de costo es historia: ni se edita ni se borra.
CREATE OR REPLACE FUNCTION inventory_cost_adjustments_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_cost_adjustments_inmutable: las correcciones de costo no admiten % (%).', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_cost_adjustments_sin_cambios" ON "inventory_cost_adjustments";
CREATE TRIGGER "inventory_cost_adjustments_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_cost_adjustments"
    FOR EACH ROW EXECUTE FUNCTION inventory_cost_adjustments_inmutable();

CREATE OR REPLACE FUNCTION inventory_costs_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_costs_inmutable: las tablas de costo de inventario no admiten TRUNCATE (%).', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_cost_adjustments_sin_truncate" ON "inventory_cost_adjustments";
CREATE TRIGGER "inventory_cost_adjustments_sin_truncate"
    BEFORE TRUNCATE ON "inventory_cost_adjustments"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_costs_sin_truncate();

-- El costo promedio sí cambia (con cada entrada con costo y cada corrección), pero el renglón no se borra ni cambia de
-- producto o de empresa: perderlo es perder un costo que no se puede reconstruir.
CREATE OR REPLACE FUNCTION inventory_variant_costs_identidad() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inventory_costs_inmutable: el costo promedio de un producto no se borra (%).', OLD."catalogVariantId"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."catalogVariantId" <> OLD."catalogVariantId" THEN
        RAISE EXCEPTION 'inventory_costs_inmutable: el costo promedio no cambia de producto ni de empresa (%).', OLD."catalogVariantId"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_variant_costs_identidad" ON "inventory_variant_costs";
CREATE TRIGGER "inventory_variant_costs_identidad"
    BEFORE UPDATE OR DELETE ON "inventory_variant_costs"
    FOR EACH ROW EXECUTE FUNCTION inventory_variant_costs_identidad();

DROP TRIGGER IF EXISTS "inventory_variant_costs_sin_truncate" ON "inventory_variant_costs";
CREATE TRIGGER "inventory_variant_costs_sin_truncate"
    BEFORE TRUNCATE ON "inventory_variant_costs"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_costs_sin_truncate();
