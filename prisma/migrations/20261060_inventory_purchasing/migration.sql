-- INV-3b · PROVEEDORES Y ÓRDENES DE COMPRA.
--
-- Una ORDEN DE COMPRA es un documento (número `OC-AAAA-NNNNNN`, proveedor, sucursal que recibe) con una línea por producto:
-- cuánto se pide y a qué costo. Se arma como BORRADOR (las líneas se editan), se PIDE (desde ahí solo avanza) y se
-- RECIBE en una o varias recepciones; cada recepción crea una entrada de mercancía normal (`ENT-…`, con el costo de la
-- línea), así que el stock sigue teniendo un solo camino hacia el ledger. Lo que no llega se cierra con faltante y motivo.
--
--   · `inventory_suppliers`: a quién se le compra (nombre, contacto, días de crédito). Se desactiva, no se borra.
--   · `inventory_purchase_orders` y `inventory_purchase_order_lines`: el documento y sus líneas.
--   · `inventory_variant_suppliers`: qué proveedores surten un producto (código del proveedor, último costo, días de
--     entrega, preferido). El último costo lo actualiza cada recepción.
--   · `inventory_receipts."purchaseOrderId"`: la orden a la que responde una entrada (NULL en las demás).
--
-- ADITIVA E IDEMPOTENTE. Crea tipos, tablas, índices y funciones nuevos y añade UNA columna NULL (sin valor por defecto)
-- con su clave foránea a `inventory_receipts`; no toca ninguna fila existente ni el ledger. Por sí sola no cambia nada
-- visible: nadie escribe en estas tablas hasta que se crea un proveedor o una orden desde «Compras».
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el código después. Con el código viejo,
-- aplicarla antes no rompe nada. (No depende de INV-3a, pero el código de INV-3b sí: despliega 20261059 antes.)

-- ── Tipo ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "InventoryPurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_suppliers" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "taxId"       TEXT,
    "contactName" TEXT,
    "phone"       TEXT,
    "email"       TEXT,
    "creditDays"  INTEGER NOT NULL DEFAULT 0,
    "notes"       TEXT,
    "active"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_purchase_orders" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "number"         TEXT NOT NULL,
    "supplierId"     TEXT NOT NULL,
    "locationId"     TEXT NOT NULL,
    "status"         "InventoryPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "reference"      TEXT,
    "note"           TEXT,
    "expectedAt"     TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdById"    TEXT,
    "orderedById"    TEXT,
    "closedById"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderedAt"      TIMESTAMP(3),
    "closedAt"       TIMESTAMP(3),
    "closeReason"    TEXT,
    "lineCount"      INTEGER NOT NULL DEFAULT 0,
    "orderedUnits"   INTEGER,
    "receivedUnits"  INTEGER,
    "shortUnits"     INTEGER,
    CONSTRAINT "inventory_purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_purchase_order_lines" (
    "id"                TEXT NOT NULL,
    "companyId"         TEXT NOT NULL,
    "orderId"           TEXT NOT NULL,
    "catalogVariantId"  TEXT NOT NULL,
    "position"          INTEGER NOT NULL,
    "quantityOrdered"   INTEGER NOT NULL,
    "quantityReceived"  INTEGER NOT NULL DEFAULT 0,
    "quantityCancelled" INTEGER NOT NULL DEFAULT 0,
    "unitCost"          DECIMAL(14,4) NOT NULL,
    CONSTRAINT "inventory_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_variant_suppliers" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "supplierId"       TEXT NOT NULL,
    "supplierSku"      TEXT,
    "lastCost"         DECIMAL(14,4),
    "lastCostAt"       TIMESTAMP(3),
    "leadTimeDays"     INTEGER,
    "preferred"        BOOLEAN NOT NULL DEFAULT false,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_variant_suppliers_pkey" PRIMARY KEY ("id")
);

-- La entrada de mercancía que responde a una orden (NULL en las demás). Columna NULL sin valor por defecto: no reescribe la tabla.
ALTER TABLE "inventory_receipts" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_suppliers_companyId_name_key" ON "inventory_suppliers" ("companyId", "name");
-- «Acme» y «ACME» son el mismo proveedor: el índice de arriba (el que Prisma conoce) distingue mayúsculas, este no.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_suppliers_companyId_name_lower_key" ON "inventory_suppliers" ("companyId", lower("name"));
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_suppliers_id_companyId_key" ON "inventory_suppliers" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "inventory_suppliers_companyId_active_idx" ON "inventory_suppliers" ("companyId", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_purchase_orders_companyId_number_key" ON "inventory_purchase_orders" ("companyId", "number");
-- NULL no choca con NULL: los borradores sin clave conviven; dos con la misma clave en la misma empresa, no.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_purchase_orders_companyId_idempotencyKey_key" ON "inventory_purchase_orders" ("companyId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_purchase_orders_id_companyId_key" ON "inventory_purchase_orders" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "inventory_purchase_orders_companyId_createdAt_idx" ON "inventory_purchase_orders" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_purchase_orders_companyId_status_createdAt_idx" ON "inventory_purchase_orders" ("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_purchase_orders_companyId_supplierId_status_idx" ON "inventory_purchase_orders" ("companyId", "supplierId", "status");
CREATE INDEX IF NOT EXISTS "inventory_purchase_orders_companyId_locationId_status_idx" ON "inventory_purchase_orders" ("companyId", "locationId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_purchase_order_lines_orderId_catalogVariantId_key" ON "inventory_purchase_order_lines" ("orderId", "catalogVariantId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_purchase_order_lines_orderId_position_key" ON "inventory_purchase_order_lines" ("orderId", "position");
CREATE INDEX IF NOT EXISTS "inventory_purchase_order_lines_companyId_catalogVariantId_idx" ON "inventory_purchase_order_lines" ("companyId", "catalogVariantId");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_variant_suppliers_catalogVariantId_supplierId_key" ON "inventory_variant_suppliers" ("catalogVariantId", "supplierId");
CREATE INDEX IF NOT EXISTS "inventory_variant_suppliers_companyId_supplierId_idx" ON "inventory_variant_suppliers" ("companyId", "supplierId");
-- A lo sumo UN proveedor preferido por producto.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_variant_suppliers_preferido_key" ON "inventory_variant_suppliers" ("catalogVariantId") WHERE "preferred";

CREATE INDEX IF NOT EXISTS "inventory_receipts_purchaseOrderId_idx" ON "inventory_receipts" ("purchaseOrderId");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId): la base rechaza una orden que junte el proveedor de una empresa con la sucursal o el producto
-- de otra. Todas RESTRICT: con historial no se borra nada.
DO $$ BEGIN
    ALTER TABLE "inventory_suppliers" ADD CONSTRAINT "inventory_suppliers_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_supplierId_companyId_fkey"
      FOREIGN KEY ("supplierId", "companyId") REFERENCES "inventory_suppliers"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_locationId_companyId_fkey"
      FOREIGN KEY ("locationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_orderId_companyId_fkey"
      FOREIGN KEY ("orderId", "companyId") REFERENCES "inventory_purchase_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_variant_suppliers" ADD CONSTRAINT "inventory_variant_suppliers_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_variant_suppliers" ADD CONSTRAINT "inventory_variant_suppliers_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_variant_suppliers" ADD CONSTRAINT "inventory_variant_suppliers_supplierId_companyId_fkey"
      FOREIGN KEY ("supplierId", "companyId") REFERENCES "inventory_suppliers"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- La entrada → su orden. Con `purchaseOrderId` NULL la clave compuesta no se comprueba (MATCH SIMPLE): las entradas de siempre no cambian.
DO $$ BEGIN
    ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_purchaseOrderId_companyId_fkey"
      FOREIGN KEY ("purchaseOrderId", "companyId") REFERENCES "inventory_purchase_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE "inventory_suppliers" ADD CONSTRAINT "inventory_suppliers_forma"
      CHECK (btrim("name") <> '' AND length("name") <= 120
             AND "creditDays" >= 0 AND "creditDays" <= 365
             AND ("taxId" IS NULL OR length("taxId") <= 30)
             AND ("contactName" IS NULL OR length("contactName") <= 120)
             AND ("phone" IS NULL OR length("phone") <= 40)
             AND ("email" IS NULL OR length("email") <= 160)
             AND ("notes" IS NULL OR length("notes") <= 500));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- El número es `OC-AAAA-NNNNNN`; textos acotados; y cada estado cuenta la misma historia:
--   · borrador → sin pedir ni cerrar y sin totales;
--   · pedida / parcial → pedida, con el total pedido congelado, sin cerrar;
--   · recibida → cerrada, llegó algo, y lo recibido más el faltante es lo pedido (y un faltante lleva motivo);
--   · cancelada → cerrada; si ya se había pedido, no llegó nada y lleva motivo.
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_forma"
      CHECK ("number" ~ '^OC-[0-9]{4}-[0-9]{6,}$'
             AND "lineCount" >= 0
             AND ("reference" IS NULL OR length("reference") <= 120)
             AND ("note" IS NULL OR length("note") <= 500)
             AND ("closeReason" IS NULL OR length("closeReason") <= 300)
             AND (
                  ("status" = 'DRAFT' AND "orderedAt" IS NULL AND "closedAt" IS NULL AND "closedById" IS NULL AND "closeReason" IS NULL
                     AND "orderedUnits" IS NULL AND "receivedUnits" IS NULL AND "shortUnits" IS NULL)
               OR ("status" IN ('ORDERED', 'PARTIAL') AND "orderedAt" IS NOT NULL AND "lineCount" > 0
                     AND "orderedUnits" IS NOT NULL AND "orderedUnits" >= "lineCount"
                     AND "closedAt" IS NULL AND "closedById" IS NULL AND "closeReason" IS NULL
                     AND "receivedUnits" IS NULL AND "shortUnits" IS NULL)
               OR ("status" = 'RECEIVED' AND "orderedAt" IS NOT NULL AND "orderedUnits" IS NOT NULL AND "closedAt" IS NOT NULL
                     AND "receivedUnits" IS NOT NULL AND "shortUnits" IS NOT NULL
                     AND "receivedUnits" > 0 AND "shortUnits" >= 0
                     AND "receivedUnits" + "shortUnits" = "orderedUnits"
                     AND ("shortUnits" = 0 OR "closeReason" IS NOT NULL))
               OR ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL
                     AND (("orderedAt" IS NULL AND "orderedUnits" IS NULL AND "receivedUnits" IS NULL AND "shortUnits" IS NULL)
                       OR ("orderedAt" IS NOT NULL AND "orderedUnits" IS NOT NULL AND "receivedUnits" = 0
                           AND "shortUnits" = "orderedUnits" AND "closeReason" IS NOT NULL)))
             ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lo pedido es de 1 a un millón (como el máximo de un movimiento); el costo, de 0 a cien millones; lo recibido y lo
-- cancelado nunca son negativos y entre los dos no pasan de lo pedido.
DO $$ BEGIN
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_forma"
      CHECK ("quantityOrdered" > 0 AND "quantityOrdered" <= 1000000 AND "position" >= 0
             AND "quantityReceived" >= 0 AND "quantityCancelled" >= 0
             AND "quantityReceived" + "quantityCancelled" <= "quantityOrdered"
             AND "unitCost" >= 0 AND "unitCost" <= 100000000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_variant_suppliers" ADD CONSTRAINT "inventory_variant_suppliers_forma"
      CHECK (("supplierSku" IS NULL OR length("supplierSku") <= 80)
             AND ("leadTimeDays" IS NULL OR ("leadTimeDays" >= 0 AND "leadTimeDays" <= 365))
             AND ("lastCost" IS NULL OR ("lastCost" >= 0 AND "lastCost" <= 100000000)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Los estados no se saltan y lo cerrado no cambia ─────────────────────────
-- Igual que el ledger, las entradas, los conteos y las transferencias: va en la base y no solo en el servicio porque el
-- servicio no es la única puerta. (`session_replication_role = replica`, que solo puede poner un superusuario, desactiva los
-- disparadores ordinarios: es la salida de las pruebas y de una intervención deliberada de operaciones.)
--
-- La orden: borrador → pedida | cancelada; pedida → parcial | recibida | cancelada; parcial → recibida. Una cerrada no
-- cambia. Lo que la identifica (número, quién y cuándo la creó, la clave) no se toca nunca; y desde que se pide, tampoco el
-- proveedor, la sucursal, las referencias, lo pedido ni cuándo y quién la pidió. No se borra: se cancela.
CREATE OR REPLACE FUNCTION inventory_purchase_orders_transicion() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: las órdenes de compra no admiten DELETE (%): se cancelan.', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" IN ('RECEIVED', 'CANCELLED') THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: una orden % no admite cambios (%).', OLD."status", OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."number" <> OLD."number"
       OR NEW."createdAt" <> OLD."createdAt" OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: de una orden no se cambia su número, quién la creó ni su clave (%).', OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" <> 'DRAFT' AND (NEW."supplierId" <> OLD."supplierId" OR NEW."locationId" <> OLD."locationId"
       OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."note" IS DISTINCT FROM OLD."note"
       OR NEW."expectedAt" IS DISTINCT FROM OLD."expectedAt" OR NEW."lineCount" <> OLD."lineCount"
       OR NEW."orderedUnits" IS DISTINCT FROM OLD."orderedUnits" OR NEW."orderedAt" IS DISTINCT FROM OLD."orderedAt"
       OR NEW."orderedById" IS DISTINCT FROM OLD."orderedById") THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: una orden ya pedida no cambia de proveedor, de sucursal ni de lo pedido (%).', OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'ORDERED', 'CANCELLED'))
         OR (OLD."status" = 'ORDERED' AND NEW."status" IN ('PARTIAL', 'RECEIVED', 'CANCELLED'))
         OR (OLD."status" = 'PARTIAL' AND NEW."status" = 'RECEIVED')) THEN
        RAISE EXCEPTION 'inventory_purchasing_transicion: una orden % no puede pasar a % (%).', OLD."status", NEW."status", OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_purchase_orders_sin_cambios" ON "inventory_purchase_orders";
CREATE TRIGGER "inventory_purchase_orders_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_purchase_orders"
    FOR EACH ROW EXECUTE FUNCTION inventory_purchase_orders_transicion();

-- Las líneas: mientras la orden es BORRADOR se agregan, cambian y quitan (nacen sin nada recibido); desde que se pide,
-- ni se agregan ni se quitan ni cambian de producto, cantidad o costo, y solo suben sus contadores (recibido, cancelado),
-- que NUNCA bajan, mientras la orden siga abierta. El servicio escribe el resultado de las líneas ANTES de cerrar la orden,
-- en la misma transacción.
CREATE OR REPLACE FUNCTION inventory_purchase_order_lines_avance() RETURNS trigger AS $$
DECLARE
    estado "InventoryPurchaseOrderStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT "status" INTO estado FROM "inventory_purchase_orders" WHERE "id" = OLD."orderId";
        IF estado IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'inventory_purchasing_inmutable: a una orden % no se le quitan líneas.', COALESCE(estado::text, 'inexistente')
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN OLD;
    END IF;
    SELECT "status" INTO estado FROM "inventory_purchase_orders" WHERE "id" = NEW."orderId";
    IF TG_OP = 'INSERT' THEN
        IF estado IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'inventory_purchasing_inmutable: a una orden % no se le agregan líneas.', COALESCE(estado::text, 'inexistente')
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW."quantityReceived" <> 0 OR NEW."quantityCancelled" <> 0 THEN
            RAISE EXCEPTION 'inventory_purchasing_inmutable: una línea nueva nace sin nada recibido ni cancelado.'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."orderId" <> OLD."orderId" THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: una línea no cambia de orden.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF estado = 'DRAFT' THEN
        IF NEW."quantityReceived" <> 0 OR NEW."quantityCancelled" <> 0 THEN
            RAISE EXCEPTION 'inventory_purchasing_inmutable: en un borrador nada se ha recibido ni cancelado.'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF estado NOT IN ('ORDERED', 'PARTIAL') THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: las líneas de una orden % no admiten UPDATE.', COALESCE(estado::text, 'inexistente')
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."catalogVariantId" <> OLD."catalogVariantId" OR NEW."position" <> OLD."position"
       OR NEW."quantityOrdered" <> OLD."quantityOrdered" OR NEW."unitCost" <> OLD."unitCost" THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: de una línea ya pedida no se cambia su producto, su cantidad ni su costo.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."quantityReceived" < OLD."quantityReceived" OR NEW."quantityCancelled" < OLD."quantityCancelled" THEN
        RAISE EXCEPTION 'inventory_purchasing_inmutable: lo recibido o cancelado de una línea no baja.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_purchase_order_lines_avance" ON "inventory_purchase_order_lines";
CREATE TRIGGER "inventory_purchase_order_lines_avance"
    BEFORE INSERT OR UPDATE OR DELETE ON "inventory_purchase_order_lines"
    FOR EACH ROW EXECUTE FUNCTION inventory_purchase_order_lines_avance();

CREATE OR REPLACE FUNCTION inventory_purchasing_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_purchasing_inmutable: las órdenes de compra no admiten TRUNCATE (%).', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_purchase_orders_sin_truncate" ON "inventory_purchase_orders";
CREATE TRIGGER "inventory_purchase_orders_sin_truncate"
    BEFORE TRUNCATE ON "inventory_purchase_orders"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_purchasing_sin_truncate();

DROP TRIGGER IF EXISTS "inventory_purchase_order_lines_sin_truncate" ON "inventory_purchase_order_lines";
CREATE TRIGGER "inventory_purchase_order_lines_sin_truncate"
    BEFORE TRUNCATE ON "inventory_purchase_order_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_purchasing_sin_truncate();
