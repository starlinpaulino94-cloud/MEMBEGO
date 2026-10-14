-- INV-2c · TRANSFERENCIAS CON ENVÍO ENTRE SUCURSALES.
--
-- Una transferencia con envío es un DOCUMENTO (número, origen, destino) con una
-- línea por producto. Al enviarla las unidades salen del origen (movimiento
-- TRANSFER_OUT del ledger) y quedan EN TRÁNSITO —no disponibles en ninguna
-- sucursal— hasta que el destino las recibe (TRANSFER_IN), en una o varias
-- recepciones. Si no llegan, se cancela (lo pendiente vuelve al origen) o se
-- cierra con faltante y motivo. El ledger sigue siendo la verdad: el documento es
-- el «por qué» agrupado. La transferencia directa de siempre (sale y entra en el
-- mismo instante) NO usa estas tablas y sigue funcionando igual.
--
-- ADITIVA E IDEMPOTENTE. Solo CREA tipos, tablas, índices y funciones nuevos; no
-- toca ninguna tabla, columna ni fila existente (los destinos de las FK
-- compuestas `(id, companyId)` de catálogo y sucursales ya existen). Por sí sola
-- no cambia nada visible: nadie escribe en estas tablas hasta que se envía una
-- transferencia desde «Transferencias».
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el
-- código después. Con el código viejo, aplicarla antes no rompe nada.

-- ── Tipo ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "InventoryTransferStatus" AS ENUM ('SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_transfers" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "number"         TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId"   TEXT NOT NULL,
    "status"         "InventoryTransferStatus" NOT NULL DEFAULT 'SENT',
    "note"           TEXT,
    "idempotencyKey" TEXT,
    "sentById"       TEXT,
    "closedById"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"       TIMESTAMP(3),
    "closeReason"    TEXT,
    "lineCount"      INTEGER NOT NULL,
    "unitCount"      INTEGER NOT NULL,
    "receivedUnits"  INTEGER,
    "returnedUnits"  INTEGER,
    "lostUnits"      INTEGER,
    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_transfer_lines" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "transferId"       TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "position"         INTEGER NOT NULL,
    "quantitySent"     INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "quantityReturned" INTEGER NOT NULL DEFAULT 0,
    "quantityLost"     INTEGER NOT NULL DEFAULT 0,
    "outMovementId"    TEXT NOT NULL,
    CONSTRAINT "inventory_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfers_companyId_number_key"
  ON "inventory_transfers" ("companyId", "number");
-- NULL no choca con NULL: los envíos sin clave conviven; dos con la misma clave en
-- la misma empresa, no.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfers_companyId_idempotencyKey_key"
  ON "inventory_transfers" ("companyId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfers_id_companyId_key"
  ON "inventory_transfers" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "inventory_transfers_companyId_createdAt_idx"
  ON "inventory_transfers" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_transfers_companyId_status_createdAt_idx"
  ON "inventory_transfers" ("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_transfers_companyId_fromLocationId_status_idx"
  ON "inventory_transfers" ("companyId", "fromLocationId", "status");
CREATE INDEX IF NOT EXISTS "inventory_transfers_companyId_toLocationId_status_idx"
  ON "inventory_transfers" ("companyId", "toLocationId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfer_lines_outMovementId_key"
  ON "inventory_transfer_lines" ("outMovementId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfer_lines_transferId_catalogVariantId_key"
  ON "inventory_transfer_lines" ("transferId", "catalogVariantId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfer_lines_transferId_position_key"
  ON "inventory_transfer_lines" ("transferId", "position");
CREATE INDEX IF NOT EXISTS "inventory_transfer_lines_companyId_catalogVariantId_idx"
  ON "inventory_transfer_lines" ("companyId", "catalogVariantId");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId) hacia las dos sucursales, la variante y el traslado:
-- la base rechaza un envío que junte la sucursal de una empresa con la de otra o
-- con la variante de otra. Todas RESTRICT: con historial no se borra nada.
DO $$ BEGIN
    ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_fromLocationId_companyId_fkey"
      FOREIGN KEY ("fromLocationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_toLocationId_companyId_fkey"
      FOREIGN KEY ("toLocationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transferId_companyId_fkey"
      FOREIGN KEY ("transferId", "companyId") REFERENCES "inventory_transfers"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_outMovementId_fkey"
      FOREIGN KEY ("outMovementId") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- El número es `TRF-AAAA-NNNNNN`; origen y destino son sucursales distintas;
-- textos acotados; y cada estado cuenta la misma historia:
--   · enviada / parcial → sin cierre ni resumen;
--   · recibida → cerrada, nada volvió al origen, lo recibido más lo perdido es lo
--     enviado, y si algo se perdió hay motivo;
--   · cancelada → cerrada, nada se perdió, y lo recibido más lo devuelto es lo enviado.
DO $$ BEGIN
    ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_forma"
      CHECK ("number" ~ '^TRF-[0-9]{4}-[0-9]{6,}$'
             AND "fromLocationId" <> "toLocationId"
             AND "lineCount" > 0 AND "unitCount" >= "lineCount"
             AND (("note" IS NULL) OR length("note") <= 500)
             AND (("closeReason" IS NULL) OR length("closeReason") <= 300)
             AND (
                  ("status" IN ('SENT', 'PARTIAL') AND "closedAt" IS NULL AND "closedById" IS NULL AND "closeReason" IS NULL
                     AND "receivedUnits" IS NULL AND "returnedUnits" IS NULL AND "lostUnits" IS NULL)
               OR ("status" = 'RECEIVED' AND "closedAt" IS NOT NULL
                     AND "receivedUnits" IS NOT NULL AND "returnedUnits" IS NOT NULL AND "lostUnits" IS NOT NULL
                     AND "receivedUnits" >= 0 AND "returnedUnits" = 0 AND "lostUnits" >= 0
                     AND "receivedUnits" + "lostUnits" = "unitCount"
                     AND ("lostUnits" = 0 OR "closeReason" IS NOT NULL))
               OR ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL
                     AND "receivedUnits" IS NOT NULL AND "returnedUnits" IS NOT NULL AND "lostUnits" IS NOT NULL
                     AND "receivedUnits" >= 0 AND "returnedUnits" >= 0 AND "lostUnits" = 0
                     AND "receivedUnits" + "returnedUnits" = "unitCount")
             ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lo enviado es de 1 a un millón (como el máximo de un movimiento); lo recibido,
-- devuelto y perdido nunca son negativos y entre los tres no pasan de lo enviado.
DO $$ BEGIN
    ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_forma"
      CHECK ("quantitySent" > 0 AND "quantitySent" <= 1000000 AND "position" >= 0
             AND "quantityReceived" >= 0 AND "quantityReturned" >= 0 AND "quantityLost" >= 0
             AND "quantityReceived" + "quantityReturned" + "quantityLost" <= "quantitySent");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Los estados no se saltan y lo cerrado no cambia ─────────────────────────
-- Igual que el ledger, las entradas y los conteos: va en la base y no solo en el
-- servicio porque el servicio no es la única puerta. (`session_replication_role =
-- replica`, que solo puede poner un superusuario, desactiva los disparadores
-- ordinarios: es la salida de las pruebas y de una intervención deliberada de
-- operaciones, no de la aplicación.)
--
-- Una transferencia abierta (enviada / parcial) solo avanza: enviada → parcial |
-- recibida | cancelada; parcial → recibida | cancelada. Una cerrada no cambia.
-- Lo que la identifica (número, origen, destino, lo enviado, quién y cuándo la
-- envió, la clave) no se toca nunca.
CREATE OR REPLACE FUNCTION inventory_transfers_transicion() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inventory_transfers_inmutable: las transferencias de inventario no admiten DELETE (%).', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" IN ('RECEIVED', 'CANCELLED') THEN
        RAISE EXCEPTION 'inventory_transfers_inmutable: una transferencia % no admite cambios (%).', OLD."status", OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."number" <> OLD."number"
       OR NEW."fromLocationId" <> OLD."fromLocationId" OR NEW."toLocationId" <> OLD."toLocationId"
       OR NEW."createdAt" <> OLD."createdAt" OR NEW."lineCount" <> OLD."lineCount" OR NEW."unitCount" <> OLD."unitCount"
       OR NEW."sentById" IS DISTINCT FROM OLD."sentById" OR NEW."note" IS DISTINCT FROM OLD."note"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey" THEN
        RAISE EXCEPTION 'inventory_transfers_inmutable: de una transferencia no se cambia su número, sus sucursales ni lo enviado (%).', OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT ((OLD."status" = 'SENT' AND NEW."status" IN ('PARTIAL', 'RECEIVED', 'CANCELLED'))
         OR (OLD."status" = 'PARTIAL' AND NEW."status" IN ('RECEIVED', 'CANCELLED'))) THEN
        RAISE EXCEPTION 'inventory_transfers_transicion: una transferencia % no puede pasar a % (%).', OLD."status", NEW."status", OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_transfers_sin_cambios" ON "inventory_transfers";
CREATE TRIGGER "inventory_transfers_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_transfers"
    FOR EACH ROW EXECUTE FUNCTION inventory_transfers_transicion();

-- Las líneas: se crean junto con el envío (la transferencia nace «enviada»), y
-- después solo avanzan sus contadores (recibido, devuelto, perdido), que NUNCA
-- bajan, mientras la transferencia siga abierta. El servicio escribe el resultado
-- de las líneas ANTES de cerrar la transferencia, en la misma transacción.
CREATE OR REPLACE FUNCTION inventory_transfer_lines_avance() RETURNS trigger AS $$
DECLARE
    estado "InventoryTransferStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inventory_transfers_inmutable: las líneas de una transferencia no admiten DELETE.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT "status" INTO estado FROM "inventory_transfers" WHERE "id" = NEW."transferId";
    IF TG_OP = 'INSERT' THEN
        IF estado IS DISTINCT FROM 'SENT' THEN
            RAISE EXCEPTION 'inventory_transfers_inmutable: a una transferencia % no se le agregan líneas.', COALESCE(estado::text, 'inexistente')
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF estado NOT IN ('SENT', 'PARTIAL') THEN
        RAISE EXCEPTION 'inventory_transfers_inmutable: las líneas de una transferencia % no admiten UPDATE.', COALESCE(estado::text, 'inexistente')
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."transferId" <> OLD."transferId"
       OR NEW."catalogVariantId" <> OLD."catalogVariantId" OR NEW."position" <> OLD."position"
       OR NEW."quantitySent" <> OLD."quantitySent" OR NEW."outMovementId" <> OLD."outMovementId" THEN
        RAISE EXCEPTION 'inventory_transfers_inmutable: de una línea no se cambia su producto ni lo enviado.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."quantityReceived" < OLD."quantityReceived" OR NEW."quantityReturned" < OLD."quantityReturned" OR NEW."quantityLost" < OLD."quantityLost" THEN
        RAISE EXCEPTION 'inventory_transfers_inmutable: lo recibido, devuelto o perdido de una línea no baja.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_transfer_lines_avance" ON "inventory_transfer_lines";
CREATE TRIGGER "inventory_transfer_lines_avance"
    BEFORE INSERT OR UPDATE OR DELETE ON "inventory_transfer_lines"
    FOR EACH ROW EXECUTE FUNCTION inventory_transfer_lines_avance();

CREATE OR REPLACE FUNCTION inventory_transfers_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_transfers_inmutable: las transferencias de inventario no admiten TRUNCATE.'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_transfers_sin_truncate" ON "inventory_transfers";
CREATE TRIGGER "inventory_transfers_sin_truncate"
    BEFORE TRUNCATE ON "inventory_transfers"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_transfers_sin_truncate();

DROP TRIGGER IF EXISTS "inventory_transfer_lines_sin_truncate" ON "inventory_transfer_lines";
CREATE TRIGGER "inventory_transfer_lines_sin_truncate"
    BEFORE TRUNCATE ON "inventory_transfer_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_transfers_sin_truncate();
