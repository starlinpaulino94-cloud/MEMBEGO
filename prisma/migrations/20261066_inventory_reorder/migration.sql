-- INV-3c · REPOSICIÓN: «LLENAR HASTA» POR PRODUCTO Y SUCURSAL.
--
-- Hasta INV-3b el inventario sabía AVISAR (el umbral de stock bajo) pero no PROPONER: la alerta es una lista de problemas. Para
-- que la pantalla «Reposición» (qué comprar) pueda sugerir una cantidad hace falta un número más por producto y sucursal:
--
--   · `inventory_levels."targetStock"` («llenar hasta»): hasta cuánto se quiere tener en esa sucursal. 0 = sin objetivo
--     (ese producto no aparece en Reposición). Junto al umbral que ya existía hace el esquema de siempre «mínimo / máximo»:
--     cuando lo disponible + lo pedido + lo que va en camino baja al umbral, se sugiere pedir hasta llegar al objetivo.
--
-- ADITIVA E IDEMPOTENTE. Añade UNA columna a `inventory_levels` con valor por defecto constante (0): PostgreSQL 11 o superior
-- no reescribe la tabla ni toca ninguna fila existente. El CHECK se crea `NOT VALID` y se valida aparte, para no mantener
-- bloqueada la tabla mientras se recorre. El índice es PARCIAL (solo los saldos con objetivo): casi todos los saldos están
-- fuera de él, así que las ventas no pagan nada por él.
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el código después. Con el SQL aplicado y el código
-- viejo no pasa nada (la columna se ignora); con el código nuevo y SIN el SQL, el inventario y los pedidos fallan (Prisma pide
-- todas las columnas del saldo en cada lectura). Depende además de 20261060 (órdenes de compra), de donde sale lo ya pedido.

ALTER TABLE "inventory_levels" ADD COLUMN IF NOT EXISTS "targetStock" INTEGER NOT NULL DEFAULT 0;

-- «Llenar hasta» va de 0 (sin objetivo) a un millón: el mismo tope que cualquier cantidad de inventario.
DO $$ BEGIN
    ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_objetivo"
      CHECK ("targetStock" >= 0 AND "targetStock" <= 1000000) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "inventory_levels" VALIDATE CONSTRAINT "inventory_levels_objetivo";

-- Reposición lee «los saldos de la empresa que tienen objetivo»: el índice parcial los encuentra sin recorrer los demás.
CREATE INDEX IF NOT EXISTS "inventory_levels_objetivo_idx" ON "inventory_levels" ("companyId") WHERE "targetStock" > 0;
