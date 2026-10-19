-- INV-5c · SERIES (número de serie por unidad).
--
-- Una SERIE es un LOTE DE UNA SOLA UNIDAD: su código es el número de serie, no vence y existe, como mucho, en un sitio a la vez. Todo lo que
-- ya sabe hacer un lote (la base mantiene su saldo por sucursal, cada movimiento se reparte entre lotes, se transfiere, se cuenta, se
-- busca su historia en el ledger) lo hace una serie sin código nuevo. Lo único que hay que añadir es qué productos llevan SERIES en vez de
-- lotes y la regla que las distingue:
--
--   · `inventory_lot_tracking."tracksSerials"`  el producto lleva series (se decide al activar y no cambia). Un producto lleva lotes O
--     series, no las dos cosas. Un producto con series no exige ni lleva vencimiento. Su lote «SIN LOTE» (lo que ya había al activar)
--     es «SIN SERIE»: puede tener varias unidades hasta que se les asigne su serie.
--
--   · UNA SERIE, UNA UNIDAD. Al terminar la transacción la base comprueba que de cada serie (cada lote con código de un producto con series)
--     haya A LO SUMO UNA unidad en TODO el inventario —sumando todas las sucursales, lo dañado y lo apartado— y que no tenga vencimiento.
--     Entrar dos veces la misma serie (en la misma sucursal o en dos a la vez), o tener la misma serie en dos sitios, hace fallar la
--     transacción. La comprobación toma un candado por serie: dos transacciones que meten la misma serie en sucursales distintas
--     (no se ven entre sí hasta confirmar) se turnan y la segunda ve la primera.
--
-- ADITIVA E IDEMPOTENTE, y de una sola transacción (todo o nada). Añade una columna con valor por defecto constante (no reescribe la tabla),
-- una restricción, un índice y dos disparadores diferidos; no cambia ninguna fila. Con el código viejo, aplicarla antes no rompe nada (el
-- código viejo nunca activa series). Necesita la `20261068` (lotes); `20261070` ya cambió la inmutabilidad de `inventory_lots`.
-- `lock_timeout` evita esperar indefinidamente: si no consigue el bloqueo en 5 s falla entera y no deja nada a medias.
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL ANTES que el código (lo hace el flujo «Migrar y desplegar» al fusionar).

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "inventory_lot_tracking" ADD COLUMN IF NOT EXISTS "tracksSerials" BOOLEAN NOT NULL DEFAULT false;

-- Un producto con series no exige vencimiento (una serie no vence).
DO $$ BEGIN
    ALTER TABLE "inventory_lot_tracking" ADD CONSTRAINT "inventory_lot_tracking_serie_sin_vencimiento"
      CHECK (NOT ("tracksSerials" AND "requiresExpiry"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- La búsqueda de una serie por su número en toda la empresa («¿dónde está la serie X?»).
CREATE INDEX IF NOT EXISTS "inventory_lots_companyId_code_idx" ON "inventory_lots" ("companyId", "code");

-- Si el producto lleva series o lotes no cambia nunca: es de la activación (se amplía la función de la `20261068`, que solo dejaba
-- cambiar `requiresExpiry`; `CREATE OR REPLACE` conserva el disparador que ya la usa).
CREATE OR REPLACE FUNCTION inventory_lot_tracking_solo_requiere_vencimiento() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
       OR NEW."catalogVariantId" IS DISTINCT FROM OLD."catalogVariantId" OR NEW."activatedBy" IS DISTINCT FROM OLD."activatedBy"
       OR NEW."tracksSerials" IS DISTINCT FROM OLD."tracksSerials"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'inventory_lot_inmutable: de la activación de lotes solo puede cambiar requiresExpiry (registro %).', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Una serie, una unidad ───────────────────────────────────────────────────
-- Relee todo con el id del lote (no usa la fila `NEW` de cuando se disparó: otra sentencia pudo cambiarla) y suma con COALESCE.
-- Un lote que no es una serie (producto con lotes, o el «SIN SERIE» legado) no se comprueba.
CREATE OR REPLACE FUNCTION inventory_serial_comprobar(p_lote text) RETURNS void AS $$
DECLARE
    v_serie boolean;
    v_legado boolean;
    v_vence date;
    v_codigo text;
    v_total bigint;
BEGIN
    SELECT coalesce(t."tracksSerials", false), l."legacy", l."expiresOn", l."code"
      INTO v_serie, v_legado, v_vence, v_codigo
      FROM "inventory_lots" l
      LEFT JOIN "inventory_lot_tracking" t ON t."catalogVariantId" = l."catalogVariantId"
     WHERE l."id" = p_lote;
    IF NOT FOUND OR NOT v_serie OR v_legado THEN
        RETURN;
    END IF;
    -- Dos transacciones que meten la misma serie en sitios distintos no se ven hasta confirmar: se turnan.
    PERFORM pg_advisory_xact_lock(hashtextextended('inventory_serial:' || p_lote, 0));
    IF v_vence IS NOT NULL THEN
        RAISE EXCEPTION 'inventory_serials_vencimiento: la serie % no vence.', v_codigo
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum("onHand" + "damaged"), 0) INTO v_total FROM "inventory_lot_balances" WHERE "lotId" = p_lote;
    IF v_total > 1 THEN
        RAISE EXCEPTION 'inventory_serials_unica: la serie % tiene % unidades en el inventario; una serie es UNA sola unidad.', v_codigo, v_total
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_serial_tg_saldo() RETURNS trigger AS $$
BEGIN
    PERFORM inventory_serial_comprobar(NEW."lotId");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_serial_tg_lote() RETURNS trigger AS $$
BEGIN
    PERFORM inventory_serial_comprobar(NEW."id");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lot_balances_serie_unica" ON "inventory_lot_balances";
CREATE CONSTRAINT TRIGGER "inventory_lot_balances_serie_unica"
    AFTER INSERT OR UPDATE OF "onHand", "damaged" ON "inventory_lot_balances"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_serial_tg_saldo();

DROP TRIGGER IF EXISTS "inventory_lots_serie_unica" ON "inventory_lots";
CREATE CONSTRAINT TRIGGER "inventory_lots_serie_unica"
    AFTER INSERT OR UPDATE OF "expiresOn" ON "inventory_lots"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_serial_tg_lote();

COMMIT;
