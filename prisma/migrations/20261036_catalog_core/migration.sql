-- COMMERCE CORE · catálogo unificado (Fase 1 del Plan Maestro).
--
-- `catalog_items` es lo que una empresa OFRECE y `catalog_variants` lo que se
-- COMPRA. Pedidos, inventario y promociones apuntarán siempre a la variante;
-- por eso un ítem simple nace con una variante `isDefault` en vez de quedarse
-- sin ninguna.
--
-- ADITIVA E IDEMPOTENTE. No toca ninguna tabla existente (`Servicio`,
-- `ProductoInventario`, `Promocion`, `Excursion` y Supply V2 siguen como
-- estaban) y, por sí sola, no cambia nada visible: nadie escribe en estas
-- tablas hasta que la empresa tenga la capacidad CATALOGO_UNIFICADO.
--
-- Sin ninguna FK hacia `supply_v2_*`: el puente con Supply llega en la Fase
-- 2.5 con su propia migración.
--
-- Los valores nuevos de `AuditAccion` van aparte, en `20261037_catalog_core_enums`.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "CatalogItemType" AS ENUM ('PHYSICAL_PRODUCT', 'SERVICE', 'BUNDLE', 'MEMBERSHIP', 'VOUCHER', 'DIGITAL_PRODUCT', 'GIFT_CARD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "CatalogItemStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "CatalogItemSource" AS ENUM ('MERCHANT', 'SUPPLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "CatalogVariantStatus" AS ENUM ('ACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "catalog_items" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "slug"         TEXT NOT NULL,
    "description"  TEXT,
    "type"         "CatalogItemType" NOT NULL,
    "status"       "CatalogItemStatus" NOT NULL DEFAULT 'DRAFT',
    "source"       "CatalogItemSource" NOT NULL DEFAULT 'MERCHANT',
    "currency"     TEXT NOT NULL DEFAULT 'DOP',
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "position"     INTEGER NOT NULL DEFAULT 0,
    "publishedAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "catalog_variants" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "catalogItemId"  TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "sku"            TEXT NOT NULL,
    "barcode"        TEXT,
    "price"          DECIMAL(12,2) NOT NULL,
    "cost"           DECIMAL(12,2),
    "compareAtPrice" DECIMAL(12,2),
    "attributes"     JSONB NOT NULL DEFAULT '{}',
    "isDefault"      BOOLEAN NOT NULL DEFAULT false,
    "status"         "CatalogVariantStatus" NOT NULL DEFAULT 'ACTIVE',
    "position"       INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catalog_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "catalog_categories" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "slug"      TEXT NOT NULL,
    "position"  INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "catalog_item_categories" (
    "companyId"     TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "categoryId"    TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_item_categories_pkey" PRIMARY KEY ("catalogItemId", "categoryId")
);

CREATE TABLE IF NOT EXISTS "catalog_item_images" (
    "id"            TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "path"          TEXT NOT NULL,
    "alt"           TEXT,
    "position"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_item_images_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "catalog_items_companyId_status_position_idx"
  ON "catalog_items" ("companyId", "status", "position");
CREATE INDEX IF NOT EXISTS "catalog_items_companyId_type_idx"
  ON "catalog_items" ("companyId", "type");
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_companyId_slug_key"
  ON "catalog_items" ("companyId", "slug");
-- Destino de las FK compuestas de las tablas hijas (ver abajo).
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_id_companyId_key"
  ON "catalog_items" ("id", "companyId");

CREATE INDEX IF NOT EXISTS "catalog_variants_catalogItemId_position_idx"
  ON "catalog_variants" ("catalogItemId", "position");
-- El SKU es único por EMPRESA, no por ítem: es lo que se escanea en caja.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_variants_companyId_sku_key"
  ON "catalog_variants" ("companyId", "sku");
-- NULL no choca con NULL en un índice único: dos variantes sin código de barras
-- conviven; dos con el mismo código, no.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_variants_companyId_barcode_key"
  ON "catalog_variants" ("companyId", "barcode");
-- A lo sumo UNA variante automática por ítem.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_variants_una_default"
  ON "catalog_variants" ("catalogItemId") WHERE "isDefault";

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_categories_companyId_slug_key"
  ON "catalog_categories" ("companyId", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_categories_id_companyId_key"
  ON "catalog_categories" ("id", "companyId");

CREATE INDEX IF NOT EXISTS "catalog_item_categories_categoryId_idx"
  ON "catalog_item_categories" ("categoryId");
CREATE INDEX IF NOT EXISTS "catalog_item_images_catalogItemId_position_idx"
  ON "catalog_item_images" ("catalogItemId", "position");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- Las de las tablas hijas hacia el ítem son COMPUESTAS (id, companyId): la base
-- rechaza una variante, imagen o categoría cuya empresa no sea la de su ítem.
-- Ninguna capa de la aplicación puede saltarse eso.
DO $$ BEGIN
    ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_catalogItemId_companyId_fkey"
      FOREIGN KEY ("catalogItemId", "companyId") REFERENCES "catalog_items"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_item_categories" ADD CONSTRAINT "catalog_item_categories_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_item_categories" ADD CONSTRAINT "catalog_item_categories_catalogItemId_companyId_fkey"
      FOREIGN KEY ("catalogItemId", "companyId") REFERENCES "catalog_items"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_item_categories" ADD CONSTRAINT "catalog_item_categories_categoryId_companyId_fkey"
      FOREIGN KEY ("categoryId", "companyId") REFERENCES "catalog_categories"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_item_images" ADD CONSTRAINT "catalog_item_images_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_item_images" ADD CONSTRAINT "catalog_item_images_catalogItemId_companyId_fkey"
      FOREIGN KEY ("catalogItemId", "companyId") REFERENCES "catalog_items"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- Un precio negativo es un dato corrupto, no un «regalo». Y el precio «antes»
-- que no es mayor que el precio deja de ser un descuento.
DO $$ BEGIN
    ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_precios"
      CHECK ("price" >= 0 AND ("cost" IS NULL OR "cost" >= 0)
             AND ("compareAtPrice" IS NULL OR "compareAtPrice" >= "price"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Las `capabilities` y los `attributes` son objetos, no listas ni escalares:
-- el código los lee con `->>` y una lista los haría callar en silencio.
DO $$ BEGIN
    ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_capabilities_objeto"
      CHECK (jsonb_typeof("capabilities") = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "catalog_variants" ADD CONSTRAINT "catalog_variants_attributes_objeto"
      CHECK (jsonb_typeof("attributes") = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Invariante: todo ítem tiene al menos una variante ───────────────────────
-- Y una variante `isDefault` solo existe mientras sea la ÚNICA del ítem.
--
-- Es un disparador DIFERIDO (se evalúa al confirmar la transacción, no fila a
-- fila) porque crear un ítem y su variante son dos INSERT: en medio hay un
-- instante sin variante que es legítimo. Lo que no puede ocurrir es confirmar
-- así.
--
-- Va en la base y no solo en el servicio porque el servicio no es la única
-- puerta: una importación masiva, un script de operaciones o una acción futura
-- escriben por otro camino. Si el ítem ya no existe (se borró en cascada), no
-- hay nada que vigilar.
CREATE OR REPLACE FUNCTION catalog_verificar_variantes() RETURNS trigger AS $$
DECLARE
    v_item   TEXT;
    v_total  INTEGER;
    v_por_defecto INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'catalog_items' THEN
        v_item := NEW."id";
    ELSIF TG_OP = 'DELETE' THEN
        v_item := OLD."catalogItemId";
    ELSE
        v_item := NEW."catalogItemId";
    END IF;

    IF NOT EXISTS (SELECT 1 FROM "catalog_items" WHERE "id" = v_item) THEN
        RETURN NULL;
    END IF;

    SELECT count(*), count(*) FILTER (WHERE "isDefault")
      INTO v_total, v_por_defecto
      FROM "catalog_variants" WHERE "catalogItemId" = v_item;

    IF v_total = 0 THEN
        RAISE EXCEPTION 'catalog_item_sin_variante: el ítem % necesita al menos una variante.', v_item
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_por_defecto > 0 AND v_total > 1 THEN
        RAISE EXCEPTION 'catalog_default_con_hermanas: la variante por defecto del ítem % solo puede existir si es la única.', v_item
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "catalog_items_variantes" ON "catalog_items";
CREATE CONSTRAINT TRIGGER "catalog_items_variantes"
    AFTER INSERT ON "catalog_items"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION catalog_verificar_variantes();

DROP TRIGGER IF EXISTS "catalog_variants_variantes" ON "catalog_variants";
CREATE CONSTRAINT TRIGGER "catalog_variants_variantes"
    AFTER INSERT OR DELETE OR UPDATE OF "isDefault", "catalogItemId" ON "catalog_variants"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION catalog_verificar_variantes();
