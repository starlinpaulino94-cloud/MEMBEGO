-- INV-5b3 · CONTEO POR LOTE.
--
-- Hasta INV-5b2 un producto con lotes no se podía contar (el conteo cuenta UN número por producto y un producto con lotes reparte
-- cada unidad entre sus lotes). Para contarlo hay que contar CADA LOTE: «de la crema, 4 del lote A-1 y 6 del B-2». Una línea de
-- conteo pasa a ser un PRODUCTO o, si el producto lleva lotes, un PRODUCTO EN UN LOTE:
--
--   · `inventory_count_lines."lotId"`   el lote que se contó (NULL = producto sin lotes, como siempre).
--
-- Todo lo demás de la línea sigue significando lo mismo: `counted` es lo que la persona contó (disponible + apartado), `expected` lo
-- que decía el sistema AL CONTAR (aquí, el saldo de ESE lote en la sucursal), y al aplicar se ajusta la DIFERENCIA con un movimiento
-- ADJUSTMENT cuyo reparto es ese lote. Cada línea tiene su propio movimiento, así que `movementId` sigue siendo único.
--
-- LA CLAVE DE UNA LÍNEA cambia: antes era (conteo, producto); ahora es (conteo, producto, lote), y para un producto sin lotes sigue
-- siendo (conteo, producto) — por eso hay DOS índices únicos: PostgreSQL no considera iguales dos NULL en un índice normal, y el
-- parcial `... WHERE "lotId" IS NULL` es lo que impide contar dos veces el mismo producto sin lotes.
--
-- LA BASE VIGILA LA COHERENCIA: el lote es de ESE producto y de ESA empresa (clave foránea compuesta, como los saldos por lote); un
-- producto que lleva lotes solo admite líneas con lote y uno que no los lleva, solo líneas sin él; y una línea no cambia de lote.
--
-- ADITIVA E IDEMPOTENTE, y de una sola transacción (todo o nada). Añade una columna que admite NULL (no reescribe la tabla ni cambia
-- ninguna fila) y cambia el índice único de las líneas por dos que valen lo mismo para todo lo que ya existe. Con el código viejo,
-- aplicarla antes no rompe nada: el código viejo nunca escribe `lotId`, y sus líneas siguen siendo únicas por (conteo, producto).
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el código después. Necesita la `20261068` (lotes) aplicada.
-- `lock_timeout` evita esperar indefinidamente a una transacción larga sobre `inventory_count_lines`: si no consigue el bloqueo en
-- 5 s falla entera y no deja nada a medias (se vuelve a aplicar sin problema).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── La columna ──────────────────────────────────────────────────────────────
ALTER TABLE "inventory_count_lines" ADD COLUMN IF NOT EXISTS "lotId" TEXT;

-- ── Los índices ─────────────────────────────────────────────────────────────
-- Primero los nuevos y luego se quita el viejo: en una sola transacción, nunca hay un instante sin garantía de unicidad.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_sessionId_catalogVariantId_lotId_key"
  ON "inventory_count_lines" ("sessionId", "catalogVariantId", "lotId");
-- Prisma no sabe expresar un índice único parcial. Para los productos SIN lotes (lotId NULL) sigue habiendo UNA línea por conteo.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_sin_lote_key"
  ON "inventory_count_lines" ("sessionId", "catalogVariantId") WHERE "lotId" IS NULL;
DROP INDEX IF EXISTS "inventory_count_lines_sessionId_catalogVariantId_key";
CREATE INDEX IF NOT EXISTS "inventory_count_lines_companyId_lotId_idx"
  ON "inventory_count_lines" ("companyId", "lotId");

-- ── La clave foránea ────────────────────────────────────────────────────────
-- COMPUESTA (lote, producto, empresa) hacia el lote: la base rechaza una línea que junte el lote de un producto con otro producto o
-- con otra empresa. Con `lotId` NULL (producto sin lotes) la clave no se comprueba (PostgreSQL: MATCH SIMPLE). RESTRICT: un lote
-- contado no se borra.
DO $$ BEGIN
    ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_lotId_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("lotId", "catalogVariantId", "companyId") REFERENCES "inventory_lots"("id", "catalogVariantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Las líneas solo se tocan con el conteo abierto, y no cambian de producto ni de lote ────────────────────────────────────────
-- Es la función de la 20261057 con una condición más (el lote). `CREATE OR REPLACE` conserva el disparador que ya la usa.
CREATE OR REPLACE FUNCTION inventory_count_lines_solo_abierta() RETURNS trigger AS $$
DECLARE
    estado "InventoryCountStatus";
BEGIN
    SELECT "status" INTO estado FROM "inventory_count_sessions"
     WHERE "id" = (CASE WHEN TG_OP = 'DELETE' THEN OLD."sessionId" ELSE NEW."sessionId" END);
    IF estado IS DISTINCT FROM 'OPEN' THEN
        RAISE EXCEPTION 'inventory_counts_inmutable: las líneas de un conteo % no admiten %.', COALESCE(estado::text, 'inexistente'), TG_OP
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId"
       OR NEW."sessionId" <> OLD."sessionId" OR NEW."catalogVariantId" <> OLD."catalogVariantId"
       OR NEW."lotId" IS DISTINCT FROM OLD."lotId") THEN
        RAISE EXCEPTION 'inventory_counts_inmutable: una línea de conteo no cambia de conteo, de producto ni de lote.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- ── Un producto con lotes se cuenta POR LOTE, y uno sin lotes, no ───────────────────────────────────────────────────────────────
-- Se comprueba al INSERTAR la línea. Activar los lotes de un producto con un conteo abierto no se admite (el servicio lo niega:
-- `ACTIVAR_CON_CONTEO_ABIERTO`), así que no puede haber líneas de un producto que cambie de régimen a mitad de conteo.
CREATE OR REPLACE FUNCTION inventory_count_lines_lote_coherente() RETURNS trigger AS $$
DECLARE
    lleva boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM "inventory_lot_tracking" WHERE "catalogVariantId" = NEW."catalogVariantId") INTO lleva;
    IF lleva AND NEW."lotId" IS NULL THEN
        RAISE EXCEPTION 'inventory_counts_lote: el producto % lleva lotes: su línea de conteo debe decir el lote.', NEW."catalogVariantId"
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT lleva AND NEW."lotId" IS NOT NULL THEN
        RAISE EXCEPTION 'inventory_counts_lote: el producto % no lleva lotes: su línea de conteo no puede traer lote.', NEW."catalogVariantId"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_count_lines_lote_coherente" ON "inventory_count_lines";
CREATE TRIGGER "inventory_count_lines_lote_coherente"
    BEFORE INSERT ON "inventory_count_lines"
    FOR EACH ROW EXECUTE FUNCTION inventory_count_lines_lote_coherente();

COMMIT;
