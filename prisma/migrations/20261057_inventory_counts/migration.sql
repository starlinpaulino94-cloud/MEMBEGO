-- INV-2b · CONTEO FÍSICO POR SUCURSAL.
--
-- Un inventario físico es una SESIÓN (número, sucursal, quién la abrió) con una
-- línea por producto contado. Mientras está ABIERTA se captura, se corrige y se
-- quita; al APLICARLA (o cancelarla) se congela. Cada producto contado produce
-- como mucho un ajuste del ledger por la DIFERENCIA (contado − esperado al
-- contar); lo que no se contó no se toca. El ledger sigue siendo la verdad.
--
-- ADITIVA E IDEMPOTENTE. Solo CREA tipos, tablas, índices y funciones nuevos; no
-- toca ninguna tabla, columna ni fila existente (los destinos de las FK
-- compuestas `(id, companyId)` de catálogo y sucursales ya existen). Por sí sola
-- no cambia nada visible: nadie escribe en estas tablas hasta que se abre un
-- conteo desde «Conteos».
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el
-- código después. Con el código viejo, aplicarla antes no rompe nada.

-- ── Tipo ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "InventoryCountStatus" AS ENUM ('OPEN', 'APPLIED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_count_sessions" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "number"         TEXT NOT NULL,
    "locationId"     TEXT NOT NULL,
    "status"         "InventoryCountStatus" NOT NULL DEFAULT 'OPEN',
    "note"           TEXT,
    "openedById"     TEXT,
    "appliedById"    TEXT,
    "cancelledById"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt"      TIMESTAMP(3),
    "cancelledAt"    TIMESTAMP(3),
    "cancelReason"   TEXT,
    "countedLines"   INTEGER,
    "adjustedLines"  INTEGER,
    "unitsOver"      INTEGER,
    "unitsShort"     INTEGER,
    "uncountedLines" INTEGER,
    CONSTRAINT "inventory_count_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_count_lines" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "sessionId"        TEXT NOT NULL,
    "catalogVariantId" TEXT NOT NULL,
    "counted"          INTEGER NOT NULL,
    "expected"         INTEGER NOT NULL,
    "countedById"      TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onHandBefore"     INTEGER,
    "onHandAfter"      INTEGER,
    "movementId"       TEXT,
    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_sessions_companyId_number_key"
  ON "inventory_count_sessions" ("companyId", "number");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_sessions_id_companyId_key"
  ON "inventory_count_sessions" ("id", "companyId");
CREATE INDEX IF NOT EXISTS "inventory_count_sessions_companyId_createdAt_idx"
  ON "inventory_count_sessions" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_count_sessions_companyId_locationId_status_idx"
  ON "inventory_count_sessions" ("companyId", "locationId", "status");

-- UN SOLO conteo abierto por sucursal. Es un índice único PARCIAL: Prisma no lo
-- sabe expresar, y es justo lo que impide que dos personas abran «el» inventario
-- de la misma sucursal a la vez (el segundo en llegar recibe la violación y el
-- servicio le dice cuál está abierto).
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_sessions_un_abierto_por_sucursal"
  ON "inventory_count_sessions" ("companyId", "locationId") WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_movementId_key"
  ON "inventory_count_lines" ("movementId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_sessionId_catalogVariantId_key"
  ON "inventory_count_lines" ("sessionId", "catalogVariantId");
CREATE INDEX IF NOT EXISTS "inventory_count_lines_companyId_catalogVariantId_idx"
  ON "inventory_count_lines" ("companyId", "catalogVariantId");

-- ── Claves foráneas ─────────────────────────────────────────────────────────
-- COMPUESTAS (id, companyId) hacia sucursal, variante y sesión: la base
-- rechaza un conteo que junte la sucursal de una empresa con la variante de
-- otra. Todas RESTRICT: con historial no se borra nada.
DO $$ BEGIN
    ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_locationId_companyId_fkey"
      FOREIGN KEY ("locationId", "companyId") REFERENCES "sucursales"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_sessionId_companyId_fkey"
      FOREIGN KEY ("sessionId", "companyId") REFERENCES "inventory_count_sessions"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_catalogVariantId_companyId_fkey"
      FOREIGN KEY ("catalogVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_movementId_fkey"
      FOREIGN KEY ("movementId") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Reglas que Prisma no sabe expresar ──────────────────────────────────────
-- El número es `CNT-AAAA-NNNNNN`; textos acotados; y cada estado cuenta la
-- misma historia: abierto no tiene cierre ni resumen; aplicado tiene fecha y
-- resumen completo; cancelado tiene fecha de cancelación.
DO $$ BEGIN
    ALTER TABLE "inventory_count_sessions" ADD CONSTRAINT "inventory_count_sessions_forma"
      CHECK ("number" ~ '^CNT-[0-9]{4}-[0-9]{6,}$'
             AND (("note" IS NULL) OR length("note") <= 500)
             AND (("cancelReason" IS NULL) OR length("cancelReason") <= 300)
             AND (
                  ("status" = 'OPEN' AND "appliedAt" IS NULL AND "cancelledAt" IS NULL
                     AND "countedLines" IS NULL AND "adjustedLines" IS NULL AND "unitsOver" IS NULL
                     AND "unitsShort" IS NULL AND "uncountedLines" IS NULL)
               OR ("status" = 'APPLIED' AND "appliedAt" IS NOT NULL AND "cancelledAt" IS NULL
                     AND "countedLines" > 0 AND "adjustedLines" >= 0 AND "adjustedLines" <= "countedLines"
                     AND "unitsOver" >= 0 AND "unitsShort" >= 0 AND "uncountedLines" >= 0)
               OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "appliedAt" IS NULL
                     AND "countedLines" IS NULL)
             ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lo contado es un entero de 0 a un millón (como el máximo de un movimiento); lo
-- esperado nunca es negativo; el resultado va completo o no va, y si hubo ajuste
-- hay existencias de antes y de después.
DO $$ BEGIN
    ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_forma"
      CHECK ("counted" >= 0 AND "counted" <= 1000000 AND "expected" >= 0
             AND (("onHandBefore" IS NULL) = ("onHandAfter" IS NULL))
             AND ("onHandBefore" IS NULL OR ("onHandBefore" >= 0 AND "onHandAfter" >= 0))
             AND ("movementId" IS NULL OR "onHandBefore" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Un conteo cerrado no cambia ─────────────────────────────────────────────
-- Igual que el ledger y las entradas, pero con una diferencia: mientras la sesión
-- está ABIERTA es un borrador de trabajo (se captura, se corrige, se quita una
-- línea); desde que se aplica o se cancela queda congelada. Va en la base y no
-- solo en el servicio porque el servicio no es la única puerta.
-- (`session_replication_role = replica`, que solo puede poner un superusuario,
-- desactiva los disparadores ordinarios: es la salida de las pruebas y de una
-- intervención deliberada de operaciones, no de la aplicación.)
CREATE OR REPLACE FUNCTION inventory_count_sessions_cerrada() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inventory_counts_inmutable: los conteos de inventario no admiten DELETE (%).', TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" <> 'OPEN' THEN
        RAISE EXCEPTION 'inventory_counts_inmutable: un conteo % no admite cambios (%).', OLD."status", OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Abierto: solo cambian la nota y el cierre. Lo que identifica al conteo no.
    IF NEW."id" <> OLD."id" OR NEW."companyId" <> OLD."companyId" OR NEW."number" <> OLD."number"
       OR NEW."locationId" <> OLD."locationId" OR NEW."createdAt" <> OLD."createdAt"
       OR NEW."openedById" IS DISTINCT FROM OLD."openedById" THEN
        RAISE EXCEPTION 'inventory_counts_inmutable: de un conteo no se cambia su número, su sucursal ni quién lo abrió (%).', OLD."number"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_count_sessions_sin_cambios" ON "inventory_count_sessions";
CREATE TRIGGER "inventory_count_sessions_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_count_sessions"
    FOR EACH ROW EXECUTE FUNCTION inventory_count_sessions_cerrada();

-- Las líneas solo se tocan mientras la sesión está abierta. El servicio escribe
-- el resultado de cada línea ANTES de pasar la sesión a «aplicada», en la misma
-- transacción.
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
       OR NEW."sessionId" <> OLD."sessionId" OR NEW."catalogVariantId" <> OLD."catalogVariantId") THEN
        RAISE EXCEPTION 'inventory_counts_inmutable: una línea de conteo no cambia de conteo ni de producto.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_count_lines_solo_abierta" ON "inventory_count_lines";
CREATE TRIGGER "inventory_count_lines_solo_abierta"
    BEFORE INSERT OR UPDATE OR DELETE ON "inventory_count_lines"
    FOR EACH ROW EXECUTE FUNCTION inventory_count_lines_solo_abierta();

CREATE OR REPLACE FUNCTION inventory_counts_sin_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inventory_counts_inmutable: los conteos de inventario no admiten TRUNCATE.'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_count_sessions_sin_truncate" ON "inventory_count_sessions";
CREATE TRIGGER "inventory_count_sessions_sin_truncate"
    BEFORE TRUNCATE ON "inventory_count_sessions"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_counts_sin_truncate();

DROP TRIGGER IF EXISTS "inventory_count_lines_sin_truncate" ON "inventory_count_lines";
CREATE TRIGGER "inventory_count_lines_sin_truncate"
    BEFORE TRUNCATE ON "inventory_count_lines"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_counts_sin_truncate();
