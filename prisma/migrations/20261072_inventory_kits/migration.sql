-- INV-5d · KITS (paquetes que descuentan sus componentes).
--
-- Un KIT es una variante del catálogo que NO lleva existencias propias: se arma con una RECETA (componentes y cuántas unidades de cada uno).
-- Vender un kit reserva, vende, libera y devuelve sus componentes; el ledger sigue siendo el de los componentes. Lo que el kit añade son dos tablas:
--
--   · `inventory_kit_components`    la receta: kit → componente × cantidad. Se edita (la receta de hoy vale para lo que se venda desde hoy).
--                                   Un kit no se compone de sí mismo y NO SE ANIDA: una variante o es un kit o es un componente, nunca las dos
--                                   cosas (la base lo vigila al cerrar la transacción).
--   · `inventory_kit_reservations`  qué reservas de componentes salieron de vender un kit en un pedido: pedido → kit → componente → reserva. Es la
--                                   FOTO de lo que se apartó (si la receta cambia después, el pedido sigue sabiendo lo que apartó). Sin UPDATE ni
--                                   DELETE, como las líneas de pedido: es evidencia.
--
-- ADITIVA E IDEMPOTENTE, y de una sola transacción (todo o nada). Crea dos tablas nuevas y un disparador diferido; no toca ninguna fila ni
-- ninguna tabla existente. Con el código viejo, aplicarla antes no rompe nada (el código viejo no sabe de kits). Necesita la `20261068` (para la
-- función de inmutabilidad). `lock_timeout` evita esperar indefinidamente: si no consigue un bloqueo en 5 s falla entera y no deja nada a medias.
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL ANTES que el código (lo hace el flujo «Migrar y desplegar» al fusionar).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── La receta ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_kit_components" (
    "id"                 TEXT NOT NULL,
    "companyId"          TEXT NOT NULL,
    "kitVariantId"       TEXT NOT NULL,
    "componentVariantId" TEXT NOT NULL,
    -- Unidades del componente por cada kit (entero de 1 al máximo de un movimiento).
    "quantity"           INTEGER NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_kit_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_kit_components_kitVariantId_componentVariantId_key"
  ON "inventory_kit_components" ("kitVariantId", "componentVariantId");
CREATE INDEX IF NOT EXISTS "inventory_kit_components_componentVariantId_idx" ON "inventory_kit_components" ("componentVariantId");
CREATE INDEX IF NOT EXISTS "inventory_kit_components_companyId_idx" ON "inventory_kit_components" ("companyId");

DO $$ BEGIN
    ALTER TABLE "inventory_kit_components" ADD CONSTRAINT "inventory_kit_components_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Kit y componente son variantes de ESA empresa. RESTRICT: una variante con receta (o usada en una) no se borra.
DO $$ BEGIN
    ALTER TABLE "inventory_kit_components" ADD CONSTRAINT "inventory_kit_components_kit_company_fkey"
      FOREIGN KEY ("kitVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_kit_components" ADD CONSTRAINT "inventory_kit_components_component_company_fkey"
      FOREIGN KEY ("componentVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un kit no se compone de sí mismo; la cantidad es un entero de 1 a 1.000.000.
DO $$ BEGIN
    ALTER TABLE "inventory_kit_components" ADD CONSTRAINT "inventory_kit_components_forma"
      CHECK ("kitVariantId" <> "componentVariantId" AND "quantity" BETWEEN 1 AND 1000000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Los kits no se anidan ───────────────────────────────────────────────────
-- Al cerrar la transacción, una variante no puede ser kit y componente a la vez (ni en la misma receta ni en otra).
CREATE OR REPLACE FUNCTION inventory_kit_sin_anidar() RETURNS trigger AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "inventory_kit_components" k WHERE k."kitVariantId" = NEW."componentVariantId")
       OR EXISTS (SELECT 1 FROM "inventory_kit_components" k WHERE k."componentVariantId" = NEW."kitVariantId") THEN
        RAISE EXCEPTION 'inventory_kit_anidado: un kit no puede ser componente de otro kit (kit %, componente %).', NEW."kitVariantId", NEW."componentVariantId"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_kit_components_sin_anidar" ON "inventory_kit_components";
CREATE CONSTRAINT TRIGGER "inventory_kit_components_sin_anidar"
    AFTER INSERT OR UPDATE OF "kitVariantId", "componentVariantId" ON "inventory_kit_components"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_kit_sin_anidar();

-- ── Las reservas que salieron de vender un kit ──────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_kit_reservations" (
    "id"                 TEXT NOT NULL,
    "companyId"          TEXT NOT NULL,
    "kitVariantId"       TEXT NOT NULL,
    "componentVariantId" TEXT NOT NULL,
    "reservationId"      TEXT NOT NULL,
    -- A qué pedido (u otra referencia) pertenece, igual que en la reserva (`ORDER` + id del pedido).
    "referenceType"      TEXT NOT NULL,
    "referenceId"        TEXT NOT NULL,
    -- Cuántos kits se vendieron y cuántas unidades del componente se apartaron por ellos (kits × cantidad de la receta de ese momento).
    "kitQuantity"        INTEGER NOT NULL,
    "quantity"           INTEGER NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_kit_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_kit_reservations_reservationId_key" ON "inventory_kit_reservations" ("reservationId");
-- Un kit vendido en una referencia aparta cada componente una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_kit_reservations_ref_kit_component_key"
  ON "inventory_kit_reservations" ("companyId", "referenceType", "referenceId", "kitVariantId", "componentVariantId");
CREATE INDEX IF NOT EXISTS "inventory_kit_reservations_companyId_ref_idx" ON "inventory_kit_reservations" ("companyId", "referenceType", "referenceId");

DO $$ BEGIN
    ALTER TABLE "inventory_kit_reservations" ADD CONSTRAINT "inventory_kit_reservations_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_kit_reservations" ADD CONSTRAINT "inventory_kit_reservations_kit_company_fkey"
      FOREIGN KEY ("kitVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_kit_reservations" ADD CONSTRAINT "inventory_kit_reservations_component_company_fkey"
      FOREIGN KEY ("componentVariantId", "companyId") REFERENCES "catalog_variants"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "inventory_kit_reservations" ADD CONSTRAINT "inventory_kit_reservations_reservation_company_fkey"
      FOREIGN KEY ("reservationId", "companyId") REFERENCES "inventory_reservations"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "inventory_kit_reservations" ADD CONSTRAINT "inventory_kit_reservations_forma"
      CHECK ("kitQuantity" BETWEEN 1 AND 1000000 AND "quantity" BETWEEN 1 AND 1000000 AND "kitVariantId" <> "componentVariantId"
         AND length("referenceType") BETWEEN 1 AND 60 AND length("referenceId") BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Es evidencia de lo que se apartó: no se edita ni se borra (la función es la de los lotes, genérica).
DROP TRIGGER IF EXISTS "inventory_kit_reservations_sin_cambios" ON "inventory_kit_reservations";
CREATE TRIGGER "inventory_kit_reservations_sin_cambios"
    BEFORE UPDATE OR DELETE ON "inventory_kit_reservations"
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_inmutable();
DROP TRIGGER IF EXISTS "inventory_kit_reservations_sin_truncate" ON "inventory_kit_reservations";
CREATE TRIGGER "inventory_kit_reservations_sin_truncate"
    BEFORE TRUNCATE ON "inventory_kit_reservations"
    FOR EACH STATEMENT EXECUTE FUNCTION inventory_lot_sin_truncate();

COMMIT;
