-- INV-5a · LOTES Y VENCIMIENTO (trazabilidad por lote, con FEFO: primero lo que antes vence).
--
-- Hasta INV-4c el inventario sabía CUÁNTO hay de cada producto en cada sucursal, no DE QUÉ LOTE es ni CUÁNDO VENCE. Para un producto
-- con lotes hace falta saber de qué lote sale cada unidad que se vende, se daña o se devuelve. Esta migración añade la base:
--
--   · `inventory_lot_tracking`   qué productos LLEVAN lotes (se activa por producto; es de un solo sentido, ver abajo).
--   · `inventory_lots`           los lotes de un producto: código y, si lo tiene, el día en que vence. Cada producto con lotes
--                                tiene además el lote «SIN LOTE», que recibe lo que ya había el día que se activó.
--   · `inventory_lot_balances`   cuánto hay de cada lote en cada sucursal (disponible+apartado, apartado, dañado). Caché.
--   · `inventory_lot_openings`   lo que había de cada lote el día que se activó (siempre en «SIN LOTE»): el saldo de partida.
--   · `inventory_movement_lots`  el REPARTO de un movimiento del ledger entre lotes: un movimiento de 10 unidades puede salir
--                                7 de un lote y 3 de otro. APPEND-ONLY, como el ledger.
--
-- SALDO POR LOTE = APERTURA + EFECTO DE LOS REPARTOS. Los saldos por lote NO los escribe la aplicación: los mantiene la base con
-- un disparador que aplica cada apertura y cada reparto (con el mismo traslado de cubetas que usa el saldo de la sucursal). Así
-- un saldo por lote no puede divergir de su historia, ni siquiera por un error del servicio.
--
-- Y PARA UN PRODUCTO CON LOTES, LOS LOTES SUMAN LO QUE HAY. Al terminar cada transacción la base comprueba, con disparadores
-- diferidos, que (a) la suma de los saldos por lote de cada saldo de sucursal es IGUAL a ese saldo (en las tres cubetas), (b) cada
-- movimiento nuevo de un producto con lotes está repartido por completo (la suma de su reparto es su cantidad) y (c) un producto
-- sin lotes no tiene saldos por lote. Un script o una puerta nueva que mueva stock sin repartirlo hace fallar la transacción.
--
-- ACTIVAR ES DE UN SOLO SENTIDO (por ahora). Desactivar los lotes de un producto con historial dejaría repartos y saldos que ya
-- no cuadran con nada; decidir qué se hace con ellos es trabajo de «lotes II», si se pide. Un producto que NUNCA tuvo
-- movimientos sí puede limpiarse (lo hace el borrado de la variante del catálogo): ver `inventory_lot_borrado_sin_historial`.
--
-- ADITIVA E IDEMPOTENTE, y de una sola transacción (todo o nada). Solo toca las tablas existentes para añadir dos índices únicos
-- —destinos de las FK compuestas— que no cambian ningún dato ni ninguna consulta; el del ledger se construye bloqueando las
-- ESCRITURAS de `inventory_movements` mientras dura (segundos aun con cientos de miles de movimientos): aplíquese fuera de hora
-- punta. `lock_timeout` evita que la migración espere indefinidamente a una transacción larga: si no consigue el bloqueo en 5 s
-- falla sin dejar nada a medias y se reintenta.
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el código después. Con el SQL aplicado y el código viejo
-- no pasa nada (nadie activa lotes sin la pantalla nueva y los disparadores no hacen nada sobre productos sin lotes); con el
-- código nuevo y SIN el SQL, el inventario y los pedidos fallan. Depende de 20261067 (motivos codificados: `reasonCode`).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── Destinos de las FK compuestas ───────────────────────────────────────────
-- (id, variante, empresa) en el saldo: el saldo por lote hereda la variante y la empresa de su saldo de sucursal.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_levels_id_catalogVariantId_companyId_key"
  ON "inventory_levels" ("id", "catalogVariantId", "companyId");
-- (id, saldo, empresa) en el ledger: un reparto solo puede colgar de un movimiento DE ESE SALDO y de esa empresa.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_movements_id_inventoryLevelId_companyId_key"
  ON "inventory_movements" ("id", "inventoryLevelId", "companyId");

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_lot_tracking" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    -- true: todo lote nuevo de este producto debe traer fecha de vencimiento (lo exige el servicio al crear el lote).
    "requiresExpiry"   BOOLEAN NOT NULL DEFAULT false,
    -- Quién lo activó. Sin FK: un usuario que se borra no puede reescribir la historia.
    "activatedBy"      TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_lot_tracking_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_lots" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    -- El código del lote, tal como viene en el empaque (el servicio lo normaliza a mayúsculas y sin espacios sobrantes).
    "code"             TEXT NOT NULL,
    -- El DÍA en que vence (sin hora ni zona: «vence el 31 de mayo» es una fecha de calendario). NULL = no vence.
    "expiresOn"        DATE,
    -- El lote «SIN LOTE»: uno por producto, recibe lo que ya había al activar los lotes. Sin vencimiento.
    "legacy"           BOOLEAN NOT NULL DEFAULT false,
    "createdBy"        TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_lot_balances" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "inventoryLevelId" TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "lotId"            TEXT NOT NULL,
    -- Mismas tres cubetas que el saldo de la sucursal: onHand = disponible + apartado; reserved = apartado; damaged = dañado.
    "onHand"           INTEGER NOT NULL DEFAULT 0,
    "reserved"         INTEGER NOT NULL DEFAULT 0,
    "damaged"          INTEGER NOT NULL DEFAULT 0,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_lot_balances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_lot_openings" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "inventoryLevelId" TEXT NOT NULL,
    "lotId"            TEXT NOT NULL,
    "onHand"           INTEGER NOT NULL,
    "reserved"         INTEGER NOT NULL,
    "damaged"          INTEGER NOT NULL,
    "createdBy"        TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_lot_openings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_movement_lots" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "movementId"       TEXT NOT NULL,
    "inventoryLevelId" TEXT NOT NULL,
    "lotId"            TEXT NOT NULL,
    -- Cuántas unidades DEL MOVIMIENTO son de este lote. Siempre positiva: la dirección la dan las cubetas del movimiento.
    "quantity"         INTEGER NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movement_lots_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
-- Un producto lleva o no lleva lotes: una sola fila.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lot_tracking_catalogVariantId_key"
  ON "inventory_lot_tracking" ("catalogVariantId");
CREATE INDEX IF NOT EXISTS "inventory_lot_tracking_companyId_idx"
  ON "inventory_lot_tracking" ("companyId");

-- Destino de las FK compuestas de los saldos por lote.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lots_id_catalogVariantId_companyId_key"
  ON "inventory_lots" ("id", "catalogVariantId", "companyId");
-- Un código por producto, sin distinguir mayúsculas («lote a» y «LOTE A» son el mismo lote). Prisma no sabe expresar un
-- índice sobre una expresión: vive solo aquí.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lots_catalogVariantId_codigo_key"
  ON "inventory_lots" ("catalogVariantId", upper("code"));
-- Y un solo «SIN LOTE» por producto.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lots_legacy_key"
  ON "inventory_lots" ("catalogVariantId") WHERE "legacy";
CREATE INDEX IF NOT EXISTS "inventory_lots_catalogVariantId_expiresOn_idx"
  ON "inventory_lots" ("catalogVariantId", "expiresOn");
-- «Qué vence pronto en la empresa»: solo los lotes con fecha.
CREATE INDEX IF NOT EXISTS "inventory_lots_companyId_expiresOn_idx"
  ON "inventory_lots" ("companyId", "expiresOn") WHERE "expiresOn" IS NOT NULL;

-- Un saldo por lote y sucursal.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lot_balances_inventoryLevelId_lotId_key"
  ON "inventory_lot_balances" ("inventoryLevelId", "lotId");
CREATE INDEX IF NOT EXISTS "inventory_lot_balances_lotId_idx"
  ON "inventory_lot_balances" ("lotId");
CREATE INDEX IF NOT EXISTS "inventory_lot_balances_companyId_idx"
  ON "inventory_lot_balances" ("companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lot_openings_inventoryLevelId_lotId_key"
  ON "inventory_lot_openings" ("inventoryLevelId", "lotId");
CREATE INDEX IF NOT EXISTS "inventory_lot_openings_companyId_idx"
  ON "inventory_lot_openings" ("companyId");

-- Un movimiento reparte entre lotes distintos: un renglón por lote.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_movement_lots_movementId_lotId_key"
  ON "inventory_movement_lots" ("movementId", "lotId");
CREATE INDEX IF NOT EXISTS "inventory_movement_lots_inventoryLevelId_lotId_idx"
  ON "inventory_movement_lots" ("inventoryLevelId", "lotId");
CREATE INDEX IF NOT EXISTS "inventory_movement_lots_lotId_idx"
  ON "inventory_movement_lots" ("lotId");
CREATE INDEX IF NOT EXISTS "inventory_movement_lots_companyId_idx"
  ON "inventory_movement_lots" ("companyId");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS con la empresa (y la variante donde importa): la base rechaza un saldo por lote que junte el lote de un producto con
-- el saldo de otro, o los de dos empresas. Todas RESTRICT: con historial no se borra nada.
DO $$ BEGIN
    ALTER TABLE "inventory_lot_tracking" ADD CONSTRAINT "inventory_lot_tracking_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lot_tracking" ADD CONSTRAINT "inventory_lot_tracking_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_level_variant_company_fkey"
      FOREIGN KEY ("inventoryLevelId", "catalogVariantId", "companyId") REFERENCES "inventory_levels"("id", "catalogVariantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_lotId_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("lotId", "catalogVariantId", "companyId") REFERENCES "inventory_lots"("id", "catalogVariantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_lot_openings" ADD CONSTRAINT "inventory_lot_openings_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lot_openings" ADD CONSTRAINT "inventory_lot_openings_inventoryLevelId_companyId_fkey"
      FOREIGN KEY ("inventoryLevelId", "companyId") REFERENCES "inventory_levels"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- La apertura de un lote en una sucursal cuelga de SU saldo por lote (que ya existe, en cero, cuando se escribe).
DO $$ BEGIN
    ALTER TABLE "inventory_lot_openings" ADD CONSTRAINT "inventory_lot_openings_inventoryLevelId_lotId_fkey"
      FOREIGN KEY ("inventoryLevelId", "lotId") REFERENCES "inventory_lot_balances"("inventoryLevelId", "lotId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_movement_lots" ADD CONSTRAINT "inventory_movement_lots_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Un reparto cuelga de un movimiento DE ESE saldo y de esa empresa…
DO $$ BEGIN
    ALTER TABLE "inventory_movement_lots" ADD CONSTRAINT "inventory_movement_lots_movement_level_company_fkey"
      FOREIGN KEY ("movementId", "inventoryLevelId", "companyId") REFERENCES "inventory_movements"("id", "inventoryLevelId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- …y de un saldo por lote que existe (el lote es del mismo producto que el saldo: lo garantizan las FK del saldo por lote).
DO $$ BEGIN
    ALTER TABLE "inventory_movement_lots" ADD CONSTRAINT "inventory_movement_lots_inventoryLevelId_lotId_fkey"
      FOREIGN KEY ("inventoryLevelId", "lotId") REFERENCES "inventory_lot_balances"("inventoryLevelId", "lotId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- LOTE. Un código tiene entre 1 y 60 caracteres y no empieza ni termina con espacios. El lote «SIN LOTE» es el legado y solo ese
-- (y no vence). La fecha de vencimiento es un día razonable: pillar el «0225» o el «2205» por el «2025» antes de que se guarde.
DO $$ BEGIN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_codigo"
      CHECK (length("code") BETWEEN 1 AND 60 AND "code" = btrim("code"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_legado"
      CHECK ("legacy" = ("code" = 'SIN LOTE') AND (NOT "legacy" OR "expiresOn" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_vencimiento"
      CHECK ("expiresOn" IS NULL OR ("expiresOn" >= DATE '2000-01-01' AND "expiresOn" <= DATE '2100-12-31'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SALDOS. Las mismas reglas que el saldo de la sucursal: ninguna cubeta en negativo y lo apartado nunca supera lo que hay.
DO $$ BEGIN
    ALTER TABLE "inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_saldos"
      CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0 AND "reserved" <= "onHand");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_lot_openings" ADD CONSTRAINT "inventory_lot_openings_saldos"
      CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0 AND "reserved" <= "onHand");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_movement_lots" ADD CONSTRAINT "inventory_movement_lots_cantidad"
      CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── El efecto de un traslado de cubetas sobre un saldo ──────────────────────
-- onHand = DISPONIBLE + APARTADO, reserved = APARTADO, damaged = DAÑADO. Devuelve {Δ onHand, Δ reserved, Δ damaged} de mover
-- `p_cantidad` unidades de `p_origen` a `p_destino` (NULL = fuera del inventario). Es la MISMA cuenta que hace el saldo de la
-- sucursal con cada movimiento: la usan los disparadores de aquí y las pruebas que reconstruyen un saldo desde su historia.
CREATE OR REPLACE FUNCTION inventory_lot_efecto(p_origen "InventoryBucket", p_destino "InventoryBucket", p_cantidad integer)
RETURNS integer[] AS $$
    SELECT ARRAY[
        (CASE WHEN p_destino IN ('AVAILABLE', 'RESERVED') THEN p_cantidad ELSE 0 END)
          - (CASE WHEN p_origen IN ('AVAILABLE', 'RESERVED') THEN p_cantidad ELSE 0 END),
        (CASE WHEN p_destino = 'RESERVED' THEN p_cantidad ELSE 0 END)
          - (CASE WHEN p_origen = 'RESERVED' THEN p_cantidad ELSE 0 END),
        (CASE WHEN p_destino = 'DAMAGED' THEN p_cantidad ELSE 0 END)
          - (CASE WHEN p_origen = 'DAMAGED' THEN p_cantidad ELSE 0 END)
    ];
$$ LANGUAGE sql IMMUTABLE;

-- ── Los saldos por lote los escribe la base, no la aplicación ───────────────
-- Un saldo por lote NACE EN CERO (la aplicación solo lo crea) y SOLO se mueve con una apertura o con un reparto: sus dos
-- disparadores `AFTER INSERT` lo actualizan marcando la transacción con `membego.lot_balance = 'disparador'`. Cualquier otro
-- `UPDATE` que toque un contador (la aplicación, un script) se rechaza.
CREATE OR REPLACE FUNCTION inventory_lot_balances_nacen_en_cero() RETURNS trigger AS $$
BEGIN
    IF NEW."onHand" <> 0 OR NEW."reserved" <> 0 OR NEW."damaged" <> 0 THEN
        RAISE EXCEPTION 'inventory_lot_balances_solo_por_disparador: un saldo por lote nace en cero; sus unidades entran con una apertura o con un reparto de movimiento.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lot_balances_nacen_en_cero" ON "inventory_lot_balances";
CREATE TRIGGER "inventory_lot_balances_nacen_en_cero"
    BEFORE INSERT ON "inventory_lot_balances"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_balances_nacen_en_cero();

CREATE OR REPLACE FUNCTION inventory_lot_balances_solo_disparador() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
       OR NEW."inventoryLevelId" IS DISTINCT FROM OLD."inventoryLevelId"
       OR NEW."catalogVariantId" IS DISTINCT FROM OLD."catalogVariantId" OR NEW."lotId" IS DISTINCT FROM OLD."lotId" THEN
        RAISE EXCEPTION 'inventory_lot_balances_solo_por_disparador: un saldo por lote no cambia de lote, de saldo ni de empresa (saldo por lote %).', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW."onHand" IS DISTINCT FROM OLD."onHand" OR NEW."reserved" IS DISTINCT FROM OLD."reserved" OR NEW."damaged" IS DISTINCT FROM OLD."damaged")
       AND coalesce(current_setting('membego.lot_balance', true), '') <> 'disparador' THEN
        RAISE EXCEPTION 'inventory_lot_balances_solo_por_disparador: las unidades de un lote solo se mueven con un reparto de movimiento o una apertura (saldo por lote %).', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lot_balances_solo_disparador" ON "inventory_lot_balances";
CREATE TRIGGER "inventory_lot_balances_solo_disparador"
    BEFORE UPDATE ON "inventory_lot_balances"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_balances_solo_disparador();

-- Un reparto mueve el saldo por lote con el traslado de cubetas de SU movimiento.
CREATE OR REPLACE FUNCTION inventory_movement_lots_aplicar() RETURNS trigger AS $$
DECLARE
    v_origen "InventoryBucket";
    v_destino "InventoryBucket";
    v_efecto integer[];
BEGIN
    SELECT "sourceBucket", "destinationBucket" INTO v_origen, v_destino
      FROM "inventory_movements" WHERE "id" = NEW."movementId";
    v_efecto := inventory_lot_efecto(v_origen, v_destino, NEW."quantity");
    PERFORM set_config('membego.lot_balance', 'disparador', true);
    UPDATE "inventory_lot_balances"
       SET "onHand" = "onHand" + v_efecto[1], "reserved" = "reserved" + v_efecto[2], "damaged" = "damaged" + v_efecto[3],
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "inventoryLevelId" = NEW."inventoryLevelId" AND "lotId" = NEW."lotId";
    PERFORM set_config('membego.lot_balance', '', true);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_movement_lots_aplicar" ON "inventory_movement_lots";
CREATE TRIGGER "inventory_movement_lots_aplicar"
    AFTER INSERT ON "inventory_movement_lots"
    FOR EACH ROW EXECUTE FUNCTION inventory_movement_lots_aplicar();

-- Una apertura pone en el saldo por lote lo que había al activar.
CREATE OR REPLACE FUNCTION inventory_lot_openings_aplicar() RETURNS trigger AS $$
BEGIN
    PERFORM set_config('membego.lot_balance', 'disparador', true);
    UPDATE "inventory_lot_balances"
       SET "onHand" = "onHand" + NEW."onHand", "reserved" = "reserved" + NEW."reserved", "damaged" = "damaged" + NEW."damaged",
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "inventoryLevelId" = NEW."inventoryLevelId" AND "lotId" = NEW."lotId";
    PERFORM set_config('membego.lot_balance', '', true);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lot_openings_aplicar" ON "inventory_lot_openings";
CREATE TRIGGER "inventory_lot_openings_aplicar"
    AFTER INSERT ON "inventory_lot_openings"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_openings_aplicar();

-- ── La historia por lote NO se edita ────────────────────────────────────────
-- Repartos, aperturas y lotes son append-only: ni UPDATE ni TRUNCATE (un error se corrige con otro movimiento, no editando el
-- reparto). DELETE solo para limpiar un producto que NUNCA tuvo movimientos (ver `…_borrado_sin_historial`). El código y el
-- vencimiento de un lote tampoco cambian: un lote mal capturado se corrige moviendo sus unidades a otro lote (con su traza).
CREATE OR REPLACE FUNCTION inventory_lot_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_lot_inmutable: % no admite % (registro %).', TG_TABLE_NAME, TG_OP, COALESCE(OLD."id", '-')
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_lot_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_lot_inmutable: % no admite TRUNCATE.', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- ¿Tuvo alguna vez un movimiento este producto (en cualquier sucursal)? Sin historial, sus lotes son solo configuración.
CREATE OR REPLACE FUNCTION inventory_lot_tiene_historial(p_variante text) RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM "inventory_movements" m
          JOIN "inventory_levels" l ON l."id" = m."inventoryLevelId"
         WHERE l."catalogVariantId" = p_variante
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION inventory_lot_borrado_sin_historial() RETURNS trigger AS $$
DECLARE
    v_variante text;
BEGIN
    IF TG_TABLE_NAME = 'inventory_lot_openings' THEN
        SELECT "catalogVariantId" INTO v_variante FROM "inventory_levels" WHERE "id" = OLD."inventoryLevelId";
    ELSE
        v_variante := OLD."catalogVariantId";
    END IF;
    IF v_variante IS NOT NULL AND inventory_lot_tiene_historial(v_variante) THEN
        RAISE EXCEPTION 'inventory_lot_inmutable: % no admite DELETE de un producto con historial de movimientos (registro %).', TG_TABLE_NAME, OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Repartos: ni UPDATE ni DELETE ni TRUNCATE (un reparto nunca se borra: sin movimientos no hay repartos y el movimiento es eterno).
DROP TRIGGER IF EXISTS "inventory_movement_lots_sin_cambios" ON "inventory_movement_lots";
CREATE TRIGGER "inventory_movement_lots_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_movement_lots"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_inmutable();
DROP TRIGGER IF EXISTS "inventory_movement_lots_sin_truncate" ON "inventory_movement_lots";
CREATE TRIGGER "inventory_movement_lots_sin_truncate"
    BEFORE TRUNCATE ON "inventory_movement_lots"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_lot_sin_truncate();

-- Lotes y aperturas: sin UPDATE; DELETE solo sin historial.
DROP TRIGGER IF EXISTS "inventory_lots_sin_cambios" ON "inventory_lots";
CREATE TRIGGER "inventory_lots_sin_cambios"
    BEFORE UPDATE ON "inventory_lots"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_inmutable();
DROP TRIGGER IF EXISTS "inventory_lots_borrado" ON "inventory_lots";
CREATE TRIGGER "inventory_lots_borrado"
    BEFORE DELETE ON "inventory_lots"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_borrado_sin_historial();
DROP TRIGGER IF EXISTS "inventory_lots_sin_truncate" ON "inventory_lots";
CREATE TRIGGER "inventory_lots_sin_truncate"
    BEFORE TRUNCATE ON "inventory_lots"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_lot_sin_truncate();

DROP TRIGGER IF EXISTS "inventory_lot_openings_sin_cambios" ON "inventory_lot_openings";
CREATE TRIGGER "inventory_lot_openings_sin_cambios"
    BEFORE UPDATE ON "inventory_lot_openings"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_inmutable();
DROP TRIGGER IF EXISTS "inventory_lot_openings_borrado" ON "inventory_lot_openings";
CREATE TRIGGER "inventory_lot_openings_borrado"
    BEFORE DELETE ON "inventory_lot_openings"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_borrado_sin_historial();
DROP TRIGGER IF EXISTS "inventory_lot_openings_sin_truncate" ON "inventory_lot_openings";
CREATE TRIGGER "inventory_lot_openings_sin_truncate"
    BEFORE TRUNCATE ON "inventory_lot_openings"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_lot_sin_truncate();

-- Saldos por lote: se mueven por disparador; DELETE solo sin historial.
DROP TRIGGER IF EXISTS "inventory_lot_balances_borrado" ON "inventory_lot_balances";
CREATE TRIGGER "inventory_lot_balances_borrado"
    BEFORE DELETE ON "inventory_lot_balances"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_borrado_sin_historial();
DROP TRIGGER IF EXISTS "inventory_lot_balances_sin_truncate" ON "inventory_lot_balances";
CREATE TRIGGER "inventory_lot_balances_sin_truncate"
    BEFORE TRUNCATE ON "inventory_lot_balances"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_lot_sin_truncate();

-- Activación: de un solo sentido. Solo `requiresExpiry` puede cambiar; DELETE solo sin historial.
CREATE OR REPLACE FUNCTION inventory_lot_tracking_solo_requiere_vencimiento() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
       OR NEW."catalogVariantId" IS DISTINCT FROM OLD."catalogVariantId" OR NEW."activatedBy" IS DISTINCT FROM OLD."activatedBy"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'inventory_lot_inmutable: de la activación de lotes solo puede cambiar requiresExpiry (registro %).', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lot_tracking_cambios" ON "inventory_lot_tracking";
CREATE TRIGGER "inventory_lot_tracking_cambios"
    BEFORE UPDATE ON "inventory_lot_tracking"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_tracking_solo_requiere_vencimiento();
DROP TRIGGER IF EXISTS "inventory_lot_tracking_borrado" ON "inventory_lot_tracking";
CREATE TRIGGER "inventory_lot_tracking_borrado"
    BEFORE DELETE ON "inventory_lot_tracking"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_borrado_sin_historial();
DROP TRIGGER IF EXISTS "inventory_lot_tracking_sin_truncate" ON "inventory_lot_tracking";
CREATE TRIGGER "inventory_lot_tracking_sin_truncate"
    BEFORE TRUNCATE ON "inventory_lot_tracking"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_lot_sin_truncate();

-- Un lote solo existe para un producto que lleva lotes (la activación inserta primero `inventory_lot_tracking`, luego «SIN LOTE»).
CREATE OR REPLACE FUNCTION inventory_lots_solo_con_seguimiento() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "inventory_lot_tracking" WHERE "catalogVariantId" = NEW."catalogVariantId") THEN
        RAISE EXCEPTION 'inventory_lots_sin_seguimiento: el producto % no lleva lotes; actívalos antes de crear uno.', NEW."catalogVariantId"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lots_solo_con_seguimiento" ON "inventory_lots";
CREATE TRIGGER "inventory_lots_solo_con_seguimiento"
    BEFORE INSERT ON "inventory_lots"
    FOR EACH ROW EXECUTE FUNCTION inventory_lots_solo_con_seguimiento();

-- ── Los lotes suman lo que hay (disparadores DIFERIDOS: se comprueban al terminar la transacción) ──
-- Se comprueban al FINAL y no fila a fila porque una venta cambia el saldo de la sucursal, escribe el movimiento y reparte entre
-- lotes en tres sentencias: en medio las cuentas no cuadran, al terminar sí. Cada comprobación RELEE el saldo con su id (no usa
-- la fila `NEW` de cuando se disparó: otra sentencia pudo cambiarlo después) y suma con COALESCE (sin saldos por lote la suma es
-- NULL, y una comparación con NULL ni acepta ni rechaza: lo dejaría pasar).
CREATE OR REPLACE FUNCTION inventory_lot_comprobar_saldo(p_saldo text) RETURNS void AS $$
DECLARE
    v_variante text;
    v_on integer; v_res integer; v_dan integer;
    b_on bigint; b_res bigint; b_dan bigint; b_n bigint;
BEGIN
    SELECT "catalogVariantId", "onHand", "reserved", "damaged" INTO v_variante, v_on, v_res, v_dan
      FROM "inventory_levels" WHERE "id" = p_saldo;
    IF NOT FOUND THEN
        RETURN; -- el saldo ya no existe (limpieza de un producto sin historial): sus saldos por lote tuvieron que irse antes
    END IF;
    SELECT coalesce(sum("onHand"), 0), coalesce(sum("reserved"), 0), coalesce(sum("damaged"), 0), count(*)
      INTO b_on, b_res, b_dan, b_n
      FROM "inventory_lot_balances" WHERE "inventoryLevelId" = p_saldo;
    IF NOT EXISTS (SELECT 1 FROM "inventory_lot_tracking" WHERE "catalogVariantId" = v_variante) THEN
        IF b_n > 0 THEN
            RAISE EXCEPTION 'inventory_lots_sin_seguimiento: el saldo % es de un producto sin lotes y tiene saldos por lote.', p_saldo
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN;
    END IF;
    IF b_on <> v_on OR b_res <> v_res OR b_dan <> v_dan THEN
        RAISE EXCEPTION 'inventory_lots_suma: los lotes del saldo % suman (hay %, apartado %, dañado %) y el saldo dice (hay %, apartado %, dañado %).',
            p_saldo, b_on, b_res, b_dan, v_on, v_res, v_dan
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_lot_comprobar_movimiento(p_movimiento text) RETURNS void AS $$
DECLARE
    v_saldo text;
    v_cantidad integer;
    v_variante text;
    v_repartido bigint;
BEGIN
    SELECT "inventoryLevelId", "quantity" INTO v_saldo, v_cantidad FROM "inventory_movements" WHERE "id" = p_movimiento;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT "catalogVariantId" INTO v_variante FROM "inventory_levels" WHERE "id" = v_saldo;
    SELECT coalesce(sum("quantity"), 0) INTO v_repartido FROM "inventory_movement_lots" WHERE "movementId" = p_movimiento;
    IF v_variante IS NOT NULL AND EXISTS (SELECT 1 FROM "inventory_lot_tracking" WHERE "catalogVariantId" = v_variante) THEN
        IF v_repartido <> v_cantidad THEN
            RAISE EXCEPTION 'inventory_lots_reparto: el movimiento % es de % unidades de un producto con lotes y su reparto suma %.', p_movimiento, v_cantidad, v_repartido
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_repartido <> 0 THEN
        RAISE EXCEPTION 'inventory_lots_reparto: el movimiento % es de un producto sin lotes y tiene un reparto de % unidades.', p_movimiento, v_repartido
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_lot_tg_saldo() RETURNS trigger AS $$
BEGIN
    PERFORM inventory_lot_comprobar_saldo(NEW."id");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_lot_tg_saldo_por_lote() RETURNS trigger AS $$
BEGIN
    PERFORM inventory_lot_comprobar_saldo(CASE WHEN TG_OP = 'DELETE' THEN OLD."inventoryLevelId" ELSE NEW."inventoryLevelId" END);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_lot_tg_seguimiento() RETURNS trigger AS $$
DECLARE
    r record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "inventory_lot_tracking" WHERE "id" = NEW."id") THEN
        RETURN NULL; -- se insertó y se borró en la misma transacción
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "inventory_lots" WHERE "catalogVariantId" = NEW."catalogVariantId" AND "legacy") THEN
        RAISE EXCEPTION 'inventory_lots_sin_seguimiento: el producto % lleva lotes pero no tiene su lote «SIN LOTE».', NEW."catalogVariantId"
            USING ERRCODE = 'check_violation';
    END IF;
    FOR r IN SELECT "id" FROM "inventory_levels" WHERE "catalogVariantId" = NEW."catalogVariantId" LOOP
        PERFORM inventory_lot_comprobar_saldo(r."id");
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_lot_tg_movimiento() RETURNS trigger AS $$
BEGIN
    PERFORM inventory_lot_comprobar_movimiento(NEW."id");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION inventory_lot_tg_reparto() RETURNS trigger AS $$
BEGIN
    PERFORM inventory_lot_comprobar_movimiento(NEW."movementId");
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_levels_lotes_suman" ON "inventory_levels";
CREATE CONSTRAINT TRIGGER "inventory_levels_lotes_suman"
    AFTER INSERT OR UPDATE OF "onHand", "reserved", "damaged" ON "inventory_levels"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_tg_saldo();

DROP TRIGGER IF EXISTS "inventory_lot_balances_lotes_suman" ON "inventory_lot_balances";
CREATE CONSTRAINT TRIGGER "inventory_lot_balances_lotes_suman"
    AFTER INSERT OR UPDATE OR DELETE ON "inventory_lot_balances"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_tg_saldo_por_lote();

DROP TRIGGER IF EXISTS "inventory_lot_tracking_lotes_suman" ON "inventory_lot_tracking";
CREATE CONSTRAINT TRIGGER "inventory_lot_tracking_lotes_suman"
    AFTER INSERT ON "inventory_lot_tracking"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_tg_seguimiento();

DROP TRIGGER IF EXISTS "inventory_movements_repartido" ON "inventory_movements";
CREATE CONSTRAINT TRIGGER "inventory_movements_repartido"
    AFTER INSERT ON "inventory_movements"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_tg_movimiento();

DROP TRIGGER IF EXISTS "inventory_movement_lots_repartido" ON "inventory_movement_lots";
CREATE CONSTRAINT TRIGGER "inventory_movement_lots_repartido"
    AFTER INSERT ON "inventory_movement_lots"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_tg_reparto();

-- Un producto que DEJA de llevar lotes (se borra su activación, algo que solo se permite sin historial) no puede dejar lotes atrás: un
-- lote solo existe para un producto con seguimiento. Sin esta comprobación, borrar solo la fila de activación dejaría lotes y saldos
-- por lote de un producto «sin lotes» y ningún otro disparador lo vería (ninguno se dispara al borrar la activación). Diferido: la
-- limpieza de un producto borra repartos, saldos, aperturas, lotes y activación en el orden que quiera dentro de su transacción.
CREATE OR REPLACE FUNCTION inventory_lot_tg_seguimiento_borrado() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "inventory_lot_tracking" WHERE "catalogVariantId" = OLD."catalogVariantId")
       AND EXISTS (SELECT 1 FROM "inventory_lots" WHERE "catalogVariantId" = OLD."catalogVariantId") THEN
        RAISE EXCEPTION 'inventory_lots_sin_seguimiento: el producto % dejó de llevar lotes pero conserva lotes.', OLD."catalogVariantId"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_lot_tracking_sin_lotes_huerfanos" ON "inventory_lot_tracking";
CREATE CONSTRAINT TRIGGER "inventory_lot_tracking_sin_lotes_huerfanos"
    AFTER DELETE ON "inventory_lot_tracking"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_tg_seguimiento_borrado();

COMMIT;
