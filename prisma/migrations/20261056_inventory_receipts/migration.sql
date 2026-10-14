-- INV-2a · ENTRADAS DE MERCANCÍA CON VARIAS LÍNEAS.
--
-- Una entrada es un DOCUMENTO (número, sucursal, referencia/factura) con sus
-- líneas; cada línea apunta al movimiento PURCHASE del ledger que produjo. El
-- ledger sigue siendo la verdad: la entrada es el «por qué» agrupado.
--
-- ADITIVA E IDEMPOTENTE. Solo CREA tablas, un tipo y funciones nuevas; no toca
-- ninguna tabla, columna ni fila existente (los destinos de las FK compuestas
-- `(id, companyId)` de catálogo, sucursales y saldos ya existen desde
-- `20261038_inventory_core`). Por sí sola no cambia nada visible: nadie escribe
-- en estas tablas hasta que se usa «Nueva entrada» o «Importar CSV».
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el
-- código después. Con el código viejo, aplicarla antes no rompe nada.

-- ── Tipo ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "InventoryReceiptSource" AS ENUM ('MANUAL', 'CSV');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_receipts" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "number"         TEXT NOT NULL,
    "locationId"     TEXT NOT NULL,
    "source"         "InventoryReceiptSource" NOT NULL DEFAULT 'MANUAL',
    "reference"      TEXT,
    "note"           TEXT,
    "userId"         TEXT,
    "idempotencyKey" TEXT,
    "lineCount"      INTEGER NOT NULL,
    "unitCount"      INTEGER NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_receipt_lines" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "receiptId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "position"         INTEGER NOT NULL,
    "quantity"         INTEGER NOT NULL,
    "movementId"       TEXT NOT NULL,
    CONSTRAINT "inventory_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipts_companyId_number_key"
  ON "inventory_receipts" ("companyId", "number");
-- NULL no choca con NULL: las entradas sin clave conviven; dos con la misma
-- clave en la misma empresa, no.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipts_companyId_idempotencyKey_key"
  ON "inventory_receipts" ("companyId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipts_id_companyId_key"
  ON "inventory_receipts" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "inventory_receipts_companyId_createdAt_idx"
  ON "inventory_receipts" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_receipts_companyId_locationId_createdAt_idx"
  ON "inventory_receipts" ("companyId", "locationId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipt_lines_movementId_key"
  ON "inventory_receipt_lines" ("movementId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipt_lines_receiptId_catalogVariantId_key"
  ON "inventory_receipt_lines" ("receiptId", "catalogVariantId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_receipt_lines_receiptId_position_key"
  ON "inventory_receipt_lines" ("receiptId", "position");
CREATE INDEX IF NOT EXISTS "inventory_receipt_lines_companyId_catalogVariantId_idx"
  ON "inventory_receipt_lines" ("companyId", "catalogVariantId");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId) hacia sucursal, variante y entrada: la base
-- rechaza una entrada que junte la sucursal de una empresa con la variante de
-- otra. Todas RESTRICT: con historial no se borra nada.
DO $$ BEGIN
    ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_locationId_companyId_fkey"
      FOREIGN KEY ("locationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_receiptId_companyId_fkey"
      FOREIGN KEY ("receiptId", "companyId") REFERENCES "inventory_receipts"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_movementId_fkey"
      FOREIGN KEY ("movementId") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- Una entrada tiene al menos una línea, y no menos unidades que líneas (cada
-- línea trae al menos una). El número es `ENT-AAAA-NNNNNN`. Textos acotados.
DO $$ BEGIN
    ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_forma"
      CHECK ("lineCount" > 0 AND "unitCount" >= "lineCount"
             AND "number" ~ '^ENT-[0-9]{4}-[0-9]{6,}$'
             AND (("reference" IS NULL) OR length("reference") <= 120)
             AND (("note" IS NULL) OR length("note") <= 500));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_receipt_lines" ADD CONSTRAINT "inventory_receipt_lines_forma"
      CHECK ("quantity" > 0 AND "quantity" <= 1000000 AND "position" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Las entradas NO se editan ───────────────────────────────────────────────
-- Igual que el ledger: ni UPDATE, ni DELETE, ni TRUNCATE. Un error se corrige
-- con un ajuste (otro movimiento) que deja rastro de qué se corrigió y por qué.
-- Va en la base y no solo en el servicio porque el servicio no es la única
-- puerta. (`session_replication_role = replica`, que solo puede poner un
-- superusuario, desactiva los disparadores ordinarios: es la salida de las
-- pruebas y de una intervención deliberada de operaciones, no de la aplicación.)
CREATE OR REPLACE FUNCTION inventory_receipts_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_receipts_inmutable: las entradas de inventario no admiten % (%).', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_receipts_sin_cambios" ON "inventory_receipts";
CREATE TRIGGER "inventory_receipts_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_receipts"
    FOR EACH ROW EXECUTE FUNCTION inventory_receipts_inmutable();

DROP TRIGGER IF EXISTS "inventory_receipt_lines_sin_cambios" ON "inventory_receipt_lines";
CREATE TRIGGER "inventory_receipt_lines_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_receipt_lines"
    FOR EACH ROW EXECUTE FUNCTION inventory_receipts_inmutable();

CREATE OR REPLACE FUNCTION inventory_receipts_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_receipts_inmutable: las entradas de inventario no admiten TRUNCATE.'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_receipts_sin_truncate" ON "inventory_receipts";
CREATE TRIGGER "inventory_receipts_sin_truncate"
    BEFORE TRUNCATE ON "inventory_receipts"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_receipts_sin_truncate();

DROP TRIGGER IF EXISTS "inventory_receipt_lines_sin_truncate" ON "inventory_receipt_lines";
CREATE TRIGGER "inventory_receipt_lines_sin_truncate"
    BEFORE TRUNCATE ON "inventory_receipt_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_receipts_sin_truncate();
