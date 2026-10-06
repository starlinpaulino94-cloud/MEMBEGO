-- COMMERCE CORE · pedidos Membego (Fase 3 del Plan Maestro).
--
-- El pedido unificado del marketplace: qué pidió un cliente a una empresa, por
-- qué canal llegó (atribución), el monto que ambas partes aceptan (confirmación
-- dual), el registro de un pago externo y la prueba de que se cumplió (QR).
--
-- ADITIVA E IDEMPOTENTE. Solo toca las tablas existentes para añadir dos índices
-- únicos `(id, companyId)` —destino de las FK compuestas— que no cambian ningún
-- dato ni ninguna consulta. Por sí sola no cambia nada visible: nadie escribe en
-- estas tablas sin la capacidad PEDIDOS_MEMBEGO (apagada para todos).
--
-- Los valores nuevos de `AuditAccion` van aparte, en `20261043_membego_orders_enums`.

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "MembegoOrderStatus" AS ENUM ('CREATED', 'AWAITING_MERCHANT', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MembegoOrderOrigin" AS ENUM ('MARKETPLACE', 'POS', 'SUPPLY', 'EXCURSION', 'API');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MembegoPaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'MEMBEGO_CHECKOUT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MembegoVerificationLevel" AS ENUM ('ATTRIBUTED', 'REDEEMED', 'CUSTOMER_VERIFIED', 'PAYMENT_VERIFIED', 'FISCALLY_RECONCILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE "MembegoAttributionChannel" AS ENUM ('MARKETPLACE_BROWSE', 'MARKETPLACE_SEARCH', 'PROMOTION_CLAIM', 'CAMPAIGN', 'REFERRAL', 'QR_SCAN', 'SUPPLY_OFFER', 'DIRECT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Destinos de las FK compuestas ───────────────────────────────────────────
-- (id, companyId) ya es único por construcción (id lo es solo); el índice existe
-- para que PostgreSQL acepte una FK compuesta hacia esas columnas.
CREATE UNIQUE INDEX IF NOT EXISTS "clientes_id_companyId_key"
  ON "clientes" ("id", "companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_reservations_id_companyId_key"
  ON "inventory_reservations" ("id", "companyId");

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "membego_orders" (
    "id"                  TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "code"                TEXT NOT NULL,
    "locationId"          TEXT NOT NULL,
    "customerId"          TEXT NOT NULL,
    "status"              "MembegoOrderStatus" NOT NULL DEFAULT 'CREATED',
    "origin"              "MembegoOrderOrigin" NOT NULL,
    "paymentMethod"       "MembegoPaymentMethod",
    "verificationLevel"   "MembegoVerificationLevel" NOT NULL DEFAULT 'ATTRIBUTED',
    "currency"            TEXT NOT NULL DEFAULT 'DOP',
    "subtotal"            DECIMAL(12,2) NOT NULL,
    "discount"            DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustment"          DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentReason"    TEXT,
    "commissionableBase"  DECIMAL(12,2) NOT NULL,
    "tax"                 DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total"               DECIMAL(12,2) NOT NULL,
    "qrToken"             TEXT,
    "qrExpiresAt"         TIMESTAMP(3),
    "notes"               TEXT,
    "cancelReason"        TEXT,
    "refundReason"        TEXT,
    "acceptedAt"          TIMESTAMP(3),
    "readyAt"             TIMESTAMP(3),
    "completedAt"         TIMESTAMP(3),
    "cancelledAt"         TIMESTAMP(3),
    "refundedAt"          TIMESTAMP(3),
    "customerConfirmedAt" TIMESTAMP(3),
    "completedByUserId"   TEXT,
    "idempotencyKey"      TEXT,
    "sourceType"          TEXT,
    "sourceId"            TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membego_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "membego_order_lines" (
    "id"                     TEXT NOT NULL,
    "companyId"              TEXT NOT NULL,
    "orderId"                TEXT NOT NULL,
    "catalogVariantId"       TEXT NOT NULL,
    "description"            TEXT NOT NULL,
    "sku"                    TEXT NOT NULL,
    "quantity"               INTEGER NOT NULL,
    "unitPrice"              DECIMAL(12,2) NOT NULL,
    "discount"               DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal"              DECIMAL(12,2) NOT NULL,
    "inventoryReservationId" TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membego_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_attributions" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "orderId"         TEXT NOT NULL,
    "channel"         "MembegoAttributionChannel" NOT NULL,
    "campaignId"      TEXT,
    "promotionId"     TEXT,
    "referralCode"    TEXT,
    "supplyV2OfferId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_attributions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customer_confirmations" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "orderId"        TEXT NOT NULL,
    "confirmedTotal" DECIMAL(12,2) NOT NULL,
    "confirmedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_evidences" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "orderId"          TEXT NOT NULL,
    "method"           "MembegoPaymentMethod" NOT NULL,
    "amount"           DECIMAL(12,2) NOT NULL,
    "reference"        TEXT,
    "notes"            TEXT,
    "recordedByUserId" TEXT,
    "recordedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_evidences_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "membego_orders_qrToken_key"
  ON "membego_orders" ("qrToken");
-- NULL no choca con NULL: los pedidos sin clave / sin documento de origen conviven.
CREATE UNIQUE INDEX IF NOT EXISTS "membego_orders_companyId_code_key"
  ON "membego_orders" ("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_orders_companyId_idempotencyKey_key"
  ON "membego_orders" ("companyId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_orders_companyId_sourceType_sourceId_key"
  ON "membego_orders" ("companyId", "sourceType", "sourceId");
CREATE UNIQUE INDEX IF NOT EXISTS "membego_orders_id_companyId_key"
  ON "membego_orders" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "membego_orders_companyId_status_createdAt_idx"
  ON "membego_orders" ("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "membego_orders_companyId_customerId_createdAt_idx"
  ON "membego_orders" ("companyId", "customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "membego_orders_companyId_locationId_status_idx"
  ON "membego_orders" ("companyId", "locationId", "status");

CREATE INDEX IF NOT EXISTS "membego_order_lines_orderId_idx"
  ON "membego_order_lines" ("orderId");
CREATE INDEX IF NOT EXISTS "membego_order_lines_companyId_catalogVariantId_idx"
  ON "membego_order_lines" ("companyId", "catalogVariantId");

CREATE UNIQUE INDEX IF NOT EXISTS "order_attributions_orderId_key"
  ON "order_attributions" ("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "order_attributions_orderId_companyId_key"
  ON "order_attributions" ("orderId", "companyId");
CREATE INDEX IF NOT EXISTS "order_attributions_companyId_channel_idx"
  ON "order_attributions" ("companyId", "channel");

CREATE UNIQUE INDEX IF NOT EXISTS "customer_confirmations_orderId_key"
  ON "customer_confirmations" ("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_confirmations_orderId_companyId_key"
  ON "customer_confirmations" ("orderId", "companyId");
CREATE INDEX IF NOT EXISTS "customer_confirmations_companyId_confirmedAt_idx"
  ON "customer_confirmations" ("companyId", "confirmedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "payment_evidences_orderId_key"
  ON "payment_evidences" ("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_evidences_orderId_companyId_key"
  ON "payment_evidences" ("orderId", "companyId");
CREATE INDEX IF NOT EXISTS "payment_evidences_companyId_recordedAt_idx"
  ON "payment_evidences" ("companyId", "recordedAt");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId): la base rechaza un pedido que junte la sucursal o
-- el cliente de una empresa con otra, y una línea cuya variante, reserva o
-- pedido sean de otra. Todas RESTRICT: con pedidos no se borra nada de lo que
-- referencian (el historial es contabilidad).
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_locationId_companyId_fkey"
      FOREIGN KEY ("locationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_customerId_companyId_fkey"
      FOREIGN KEY ("customerId", "companyId") REFERENCES "clientes"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "membego_order_lines" ADD CONSTRAINT "membego_order_lines_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_order_lines" ADD CONSTRAINT "membego_order_lines_orderId_companyId_fkey"
      FOREIGN KEY ("orderId", "companyId") REFERENCES "membego_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_order_lines" ADD CONSTRAINT "membego_order_lines_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "membego_order_lines" ADD CONSTRAINT "membego_order_lines_inventoryReservationId_companyId_fkey"
      FOREIGN KEY ("inventoryReservationId", "companyId") REFERENCES "inventory_reservations"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_orderId_companyId_fkey"
      FOREIGN KEY ("orderId", "companyId") REFERENCES "membego_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_supplyV2OfferId_fkey"
      FOREIGN KEY ("supplyV2OfferId") REFERENCES "supply_v2_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "customer_confirmations" ADD CONSTRAINT "customer_confirmations_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "customer_confirmations" ADD CONSTRAINT "customer_confirmations_orderId_companyId_fkey"
      FOREIGN KEY ("orderId", "companyId") REFERENCES "membego_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "payment_evidences" ADD CONSTRAINT "payment_evidences_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "payment_evidences" ADD CONSTRAINT "payment_evidences_orderId_companyId_fkey"
      FOREIGN KEY ("orderId", "companyId") REFERENCES "membego_orders"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- (Aunque el servicio ya lo comprueba, estas reglas valen para cualquier otra
-- puerta: un script, una importación, una acción futura.)
--
-- OJO con los NULL: un CHECK que evalúa a NULL SE ACEPTA. Las reglas que
-- comparan columnas anulables van envueltas en coalesce(…, false) o comparan con
-- IS NOT DISTINCT FROM, para que lo que no encaje se rechace.

-- DINERO. Los totales cuadran: base = subtotal − descuento + ajuste; total =
-- base + impuestos. Ningún monto negativo, y no se descuenta más de lo vendido.
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_montos"
      CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "tax" >= 0
             AND "discount" <= "subtotal"
             AND "commissionableBase" >= 0
             AND "commissionableBase" = "subtotal" - "discount" + "adjustment"
             AND "total" = "commissionableBase" + "tax");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un ajuste de monto sin motivo es un cambio de precio sin explicación.
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_ajuste"
      CHECK ("adjustment" = 0 OR length(btrim(coalesce("adjustmentReason", ''))) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ESTADO ↔ FECHAS. Cada estado terminal deja su fecha, y solo él.
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_estado_fechas"
      CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
             AND ("status" IN ('COMPLETED', 'REFUNDED')) = ("completedAt" IS NOT NULL)
             AND ("status" = 'REFUNDED') = ("refundedAt" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cancelar o reembolsar sin motivo no deja rastro de por qué.
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_motivos"
      CHECK (("status" <> 'CANCELLED' OR length(btrim(coalesce("cancelReason", ''))) > 0)
             AND ("status" <> 'REFUNDED' OR length(btrim(coalesce("refundReason", ''))) > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- QR. Un pedido LISTO tiene su credencial y su vencimiento; token y vencimiento
-- van juntos o no van.
DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_qr"
      CHECK (("qrToken" IS NULL) = ("qrExpiresAt" IS NULL)
             AND ("status" <> 'READY' OR "qrToken" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_fuente"
      CHECK (("sourceType" IS NULL) = ("sourceId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "membego_orders" ADD CONSTRAINT "membego_orders_codigo"
      CHECK ("code" ~ '^MBG-PED-[0-9]{4}-[0-9]{6,}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "membego_order_lines" ADD CONSTRAINT "membego_order_lines_montos"
      CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "discount" >= 0
             AND "discount" <= "quantity" * "unitPrice"
             AND "lineTotal" = "quantity" * "unitPrice" - "discount"
             AND length(btrim("description")) > 0 AND length(btrim("sku")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ATRIBUCIÓN. Cada canal trae el dato que lo identifica (es la MISMA tabla que
-- `modules/orders/domain.ts`, DATO_DEL_CANAL).
DO $$ BEGIN
    ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_canal"
      CHECK (coalesce(
            ("channel" = 'SUPPLY_OFFER'    AND "supplyV2OfferId" IS NOT NULL)
         OR ("channel" = 'REFERRAL'        AND "referralCode"    IS NOT NULL)
         OR ("channel" = 'CAMPAIGN'        AND "campaignId"      IS NOT NULL)
         OR ("channel" = 'PROMOTION_CLAIM' AND "promotionId"     IS NOT NULL)
         OR ("channel" IN ('MARKETPLACE_BROWSE', 'MARKETPLACE_SEARCH', 'QR_SCAN', 'DIRECT'))
      , false));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "customer_confirmations" ADD CONSTRAINT "customer_confirmations_monto"
      CHECK ("confirmedTotal" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "payment_evidences" ADD CONSTRAINT "payment_evidences_monto"
      CHECK ("amount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── La máquina de estados vive TAMBIÉN en la base ───────────────────────────
-- Una transición que no esté en la tabla NO OCURRE, entre por donde entre. Es la
-- MISMA tabla que `modules/orders/domain.ts` (TRANSICIONES); una prueba contra la
-- base comprueba las 49 combinaciones para que no se separen.
--
--   CREATED           → AWAITING_MERCHANT, CANCELLED
--   AWAITING_MERCHANT → IN_PROGRESS, READY, CANCELLED
--   IN_PROGRESS       → READY, CANCELLED
--   READY             → COMPLETED, CANCELLED
--   COMPLETED         → REFUNDED
--   CANCELLED, REFUNDED: finales
--
-- Además: un pedido nace CREATED; lo que identifica el pedido y fija lo vendido
-- (empresa, código, cliente, sucursal, origen, moneda, subtotal, descuento,
-- impuestos) no cambia nunca; y un pedido cerrado (COMPLETED, CANCELLED,
-- REFUNDED) tampoco cambia su monto.
CREATE OR REPLACE FUNCTION membego_orders_reglas() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'CREATED' THEN
            RAISE EXCEPTION 'membego_orders_estado: un pedido nace CREATED, no %.', NEW."status"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."companyId" <> OLD."companyId" OR NEW."code" <> OLD."code"
       OR NEW."customerId" <> OLD."customerId" OR NEW."locationId" <> OLD."locationId"
       OR NEW."origin" <> OLD."origin" OR NEW."currency" <> OLD."currency"
       OR NEW."subtotal" <> OLD."subtotal" OR NEW."discount" <> OLD."discount"
       OR NEW."tax" <> OLD."tax" THEN
        RAISE EXCEPTION 'membego_orders_inmutable: el pedido % no cambia lo que identifica ni lo que se vendió.', OLD."code"
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD."status" IN ('COMPLETED', 'CANCELLED', 'REFUNDED')
       AND (NEW."adjustment" <> OLD."adjustment" OR NEW."commissionableBase" <> OLD."commissionableBase"
            OR NEW."total" <> OLD."total") THEN
        RAISE EXCEPTION 'membego_orders_inmutable: el pedido % ya está cerrado: su monto no cambia.', OLD."code"
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW."status" <> OLD."status" AND NOT (
          (OLD."status" = 'CREATED'           AND NEW."status" IN ('AWAITING_MERCHANT', 'CANCELLED'))
       OR (OLD."status" = 'AWAITING_MERCHANT' AND NEW."status" IN ('IN_PROGRESS', 'READY', 'CANCELLED'))
       OR (OLD."status" = 'IN_PROGRESS'       AND NEW."status" IN ('READY', 'CANCELLED'))
       OR (OLD."status" = 'READY'             AND NEW."status" IN ('COMPLETED', 'CANCELLED'))
       OR (OLD."status" = 'COMPLETED'         AND NEW."status" = 'REFUNDED')
    ) THEN
        RAISE EXCEPTION 'membego_orders_transicion: el pedido % no puede pasar de % a %.', OLD."code", OLD."status", NEW."status"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "membego_orders_reglas" ON "membego_orders";
CREATE TRIGGER "membego_orders_reglas"
    BEFORE INSERT OR UPDATE ON "membego_orders"
    FOR EACH ROW EXECUTE FUNCTION membego_orders_reglas();

-- ── Las líneas NO se editan ─────────────────────────────────────────────────
-- Lo que se pidió y a qué precio no se reescribe: un error se corrige con el
-- ajuste del pedido o cancelándolo. Ni UPDATE, ni DELETE, ni TRUNCATE.
--
-- (`session_replication_role = replica`, que solo puede poner un superusuario,
-- desactiva los disparadores ordinarios: es la salida de las pruebas y de una
-- intervención deliberada de operaciones, no de la aplicación.)
CREATE OR REPLACE FUNCTION membego_order_lines_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'membego_order_lines_inmutable: las líneas de un pedido no admiten % (línea %).', TG_OP, COALESCE(OLD."id", '-')
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "membego_order_lines_sin_cambios" ON "membego_order_lines";
CREATE TRIGGER "membego_order_lines_sin_cambios"
    BEFORE UPDATE OR DELETE ON "membego_order_lines"
    FOR EACH ROW EXECUTE FUNCTION membego_order_lines_inmutable();

CREATE OR REPLACE FUNCTION membego_order_lines_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'membego_order_lines_inmutable: las líneas de un pedido no admiten TRUNCATE.'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "membego_order_lines_sin_truncate" ON "membego_order_lines";
CREATE TRIGGER "membego_order_lines_sin_truncate"
    BEFORE TRUNCATE ON "membego_order_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION membego_order_lines_sin_truncate();

-- ── Un pedido sin líneas, o con líneas que no suman, no existe ──────────────
-- Disparador DIFERIDO (se evalúa al confirmar la transacción): el pedido y sus
-- líneas se insertan en la misma transacción, en cualquier orden. Como las
-- líneas son inmutables y `subtotal`/`discount` no cambian (regla de arriba), el
-- cuadre basta comprobarlo al crear.
CREATE OR REPLACE FUNCTION membego_orders_cuadre() RETURNS trigger AS $$
DECLARE
    v_order_id TEXT;
    v_subtotal NUMERIC;
    v_discount NUMERIC;
    v_n        BIGINT;
    v_sum      NUMERIC;
    v_sum_disc NUMERIC;
BEGIN
    IF TG_TABLE_NAME = 'membego_orders' THEN
        v_order_id := NEW."id";
    ELSE
        v_order_id := NEW."orderId";
    END IF;

    SELECT "subtotal", "discount" INTO v_subtotal, v_discount FROM "membego_orders" WHERE "id" = v_order_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT count(*), coalesce(sum("quantity" * "unitPrice"), 0), coalesce(sum("discount"), 0)
      INTO v_n, v_sum, v_sum_disc
      FROM "membego_order_lines" WHERE "orderId" = v_order_id;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'membego_orders_cuadre: el pedido % no tiene líneas.', v_order_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_sum <> v_subtotal OR v_sum_disc <> v_discount THEN
        RAISE EXCEPTION 'membego_orders_cuadre: las líneas del pedido % suman % (descuento %) y el pedido dice % (descuento %).',
            v_order_id, v_sum, v_sum_disc, v_subtotal, v_discount
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "membego_orders_cuadre_pedido" ON "membego_orders";
CREATE CONSTRAINT TRIGGER "membego_orders_cuadre_pedido"
    AFTER INSERT ON "membego_orders"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION membego_orders_cuadre();

DROP TRIGGER IF EXISTS "membego_orders_cuadre_lineas" ON "membego_order_lines";
CREATE CONSTRAINT TRIGGER "membego_orders_cuadre_lineas"
    AFTER INSERT ON "membego_order_lines"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION membego_orders_cuadre();
