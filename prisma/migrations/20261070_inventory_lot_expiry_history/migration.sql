-- INV-5b5 · CORREGIR EL VENCIMIENTO DE UN LOTE (con su historia) y DESHACER LA ACTIVACIÓN DE LOTES.
--
-- Hasta INV-5b4 el código y el vencimiento de un lote eran inmutables: un lote mal capturado se corregía moviendo sus unidades a otro
-- lote. Eso no sirve cuando lo mal capturado es la FECHA de un lote que ya tiene ventas, apartados y transferencias encima. Ahora el
-- vencimiento (solo el vencimiento) se puede corregir, pero NUNCA sin dejar rastro: cada cambio es una fila de
-- `inventory_lot_expiry_changes` (lote, fecha anterior, fecha nueva, motivo y quién), append-only como el ledger.
--
--   · `inventory_lot_expiry_changes`  la historia de los vencimientos de cada lote. Sin UPDATE, DELETE ni TRUNCATE.
--   · `inventory_lots` deja de ser del todo inmutable: el disparador nuevo solo deja cambiar `expiresOn`, nunca en el lote «SIN LOTE», y
--     SOLO si en la MISMA transacción hay una fila de historia que diga exactamente ese cambio (fecha anterior → fecha nueva). Un
--     UPDATE a mano, o un servicio con un error, que cambie la fecha sin historia, falla.
--
-- DESHACER LA ACTIVACIÓN. `inventory_lot_tiene_historial` decía «¿tuvo ALGÚN movimiento este producto?» y, con eso, una activación hecha
-- por error nunca se podía deshacer (todo producto con existencias tiene movimientos de antes). Lo que protege la historia de los lotes
-- son los REPARTOS de movimiento: mientras ningún movimiento haya sido repartido entre lotes, los lotes, sus saldos y sus aperturas son
-- solo configuración. La función pasa a decir «¿tiene algún movimiento repartido entre lotes?». En cuanto el producto se vende, se
-- recibe o se transfiere con lotes, ya hay reparto y la activación deja de poder deshacerse (como hasta ahora).
--
-- ADITIVA E IDEMPOTENTE, y de una sola transacción (todo o nada). Crea una tabla, cambia el cuerpo de dos funciones y reemplaza un
-- disparador; no reescribe ni cambia ninguna fila. Con el código viejo, aplicarla antes no rompe nada (el código viejo nunca cambia un
-- vencimiento ni deshace una activación). Necesita la `20261068` (lotes). `lock_timeout` evita esperar indefinidamente a una
-- transacción larga sobre `inventory_lots`: si no consigue el bloqueo en 5 s falla entera y no deja nada a medias.
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL ANTES que el código (lo hace el flujo «Migrar y desplegar» al fusionar).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── La historia de los vencimientos ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_lot_expiry_changes" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "lotId"            TEXT NOT NULL,
    -- El día que decía el lote antes (NULL = no vencía) y el que dice ahora (NULL = ya no vence).
    "previousExpiresOn" DATE,
    "newExpiresOn"      DATE,
    "reason"           TEXT NOT NULL,
    -- Quién lo corrigió (sin FK: un usuario que se borra no reescribe la historia).
    "changedBy"        TEXT,
    -- La transacción que lo escribió: el disparador de `inventory_lots` solo acepta un cambio de fecha con una fila de ESTA transacción.
    "txid"             BIGINT NOT NULL DEFAULT txid_current(),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_lot_expiry_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_lot_expiry_changes_lotId_createdAt_idx"
  ON "inventory_lot_expiry_changes" ("lotId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_lot_expiry_changes_companyId_createdAt_idx"
  ON "inventory_lot_expiry_changes" ("companyId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "inventory_lot_expiry_changes" ADD CONSTRAINT "inventory_lot_expiry_changes_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- El lote es de ESE producto y de ESA empresa (como los saldos por lote). RESTRICT: un lote con historia de vencimientos no se borra.
DO $$ BEGIN
    ALTER TABLE "inventory_lot_expiry_changes" ADD CONSTRAINT "inventory_lot_expiry_changes_lot_variant_company_fkey"
      FOREIGN KEY ("lotId", "catalogVariantId", "companyId") REFERENCES "inventory_lots"("id", "catalogVariantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un cambio cambia algo; las fechas son días razonables (las mismas del lote); el motivo no está vacío.
DO $$ BEGIN
    ALTER TABLE "inventory_lot_expiry_changes" ADD CONSTRAINT "inventory_lot_expiry_changes_cambio"
      CHECK ("previousExpiresOn" IS DISTINCT FROM "newExpiresOn"
         AND ("previousExpiresOn" IS NULL OR ("previousExpiresOn" >= DATE '2000-01-01' AND "previousExpiresOn" <= DATE '2100-12-31'))
         AND ("newExpiresOn" IS NULL OR ("newExpiresOn" >= DATE '2000-01-01' AND "newExpiresOn" <= DATE '2100-12-31'))
         AND length(btrim("reason")) BETWEEN 1 AND 300);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── La historia no se edita ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS "inventory_lot_expiry_changes_sin_cambios" ON "inventory_lot_expiry_changes";
CREATE TRIGGER "inventory_lot_expiry_changes_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_lot_expiry_changes"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_inmutable();
DROP TRIGGER IF EXISTS "inventory_lot_expiry_changes_sin_truncate" ON "inventory_lot_expiry_changes";
CREATE TRIGGER "inventory_lot_expiry_changes_sin_truncate"
    BEFORE TRUNCATE ON "inventory_lot_expiry_changes"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_lot_sin_truncate();

-- ── Del lote solo cambia el vencimiento, y con historia ─────────────────────
CREATE OR REPLACE FUNCTION inventory_lots_solo_vencimiento() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
       OR NEW."catalogVariantId" IS DISTINCT FROM OLD."catalogVariantId" OR NEW."code" IS DISTINCT FROM OLD."code"
       OR NEW."legacy" IS DISTINCT FROM OLD."legacy" OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'inventory_lot_inmutable: de un lote solo puede cambiar su vencimiento (lote %).', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."expiresOn" IS NOT DISTINCT FROM OLD."expiresOn" THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "inventory_lot_expiry_changes" c
         WHERE c."lotId" = OLD."id" AND c."txid" = txid_current()
           AND c."previousExpiresOn" IS NOT DISTINCT FROM OLD."expiresOn"
           AND c."newExpiresOn" IS NOT DISTINCT FROM NEW."expiresOn"
    ) THEN
        RAISE EXCEPTION 'inventory_lot_inmutable: el vencimiento del lote % no cambia sin una fila de historia que diga de qué fecha a cuál.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lots_sin_cambios" ON "inventory_lots";
CREATE TRIGGER "inventory_lots_sin_cambios"
    BEFORE UPDATE ON "inventory_lots"
    FOR EACH ROW EXECUTE FUNCTION inventory_lots_solo_vencimiento();

-- ── ¿Tiene historia de lotes este producto? ─────────────────────────────────
-- Antes: «¿tuvo algún movimiento?». Ahora: «¿tiene algún movimiento repartido entre lotes?». Los movimientos de ANTES de activar los lotes
-- no tienen reparto y no dependen de ningún lote; los de después, todos. Gobierna cuándo se pueden borrar lotes, saldos por lote,
-- aperturas y la activación (los disparadores `…_borrado` la usan tal cual).
CREATE OR REPLACE FUNCTION inventory_lot_tiene_historial(p_variante text) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM "inventory_movement_lots" ml
          JOIN "inventory_levels" l ON l."id" = ml."inventoryLevelId"
         WHERE l."catalogVariantId" = p_variante
    ) OR EXISTS (
        SELECT 1 FROM "inventory_lot_expiry_changes" c WHERE c."catalogVariantId" = p_variante
    );
$$ LANGUAGE sql STABLE;

COMMIT;
