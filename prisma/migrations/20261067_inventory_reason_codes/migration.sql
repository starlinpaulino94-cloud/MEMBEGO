-- INV-4b · MOTIVOS CODIFICADOS EN EL LEDGER.
--
-- Hasta INV-4a el «por qué» de un ajuste, un daño o una baja era TEXTO LIBRE (`inventory_movements."reason"`): sirve para leer un
-- movimiento, no para sumar. «Vencido», «venció», «caducado» y «se venció el lote 12» son lo mismo para una persona y cuatro cosas
-- distintas para un informe. Para poder contar cuánto se perdió y por qué hace falta un código estable:
--
--   · `inventory_movements."reasonCode"`: el motivo del catálogo (p. ej. `EXPIRED`, `THEFT`, `COUNT_DIFFERENCE`). El texto libre se
--     conserva como DETALLE. NULL en todo lo que no es un ajuste o un daño (ventas, entradas, transferencias, reservas…) y en
--     todo lo anterior a esta migración: el ledger es inmutable y no se reescribe, así que lo histórico queda «sin motivo
--     codificado» y los informes lo dicen así.
--
-- El catálogo vive en el código (`modules/inventory/motivos.ts`), no en una tabla: añadir un motivo no exige una migración. La base
-- solo vigila lo que no puede cambiar: que el código tenga la forma de un código y que solo lo lleven los ajustes y los daños.
--
-- ADITIVA E IDEMPOTENTE. Añade UNA columna NULL sin valor por defecto: PostgreSQL no reescribe la tabla ni toca ninguna fila
-- existente (es instantáneo aunque el ledger sea enorme). Los CHECK se crean `NOT VALID` y se validan aparte, para no mantener
-- bloqueada la tabla mientras se recorre. NO crea ningún índice: el informe de mermas recorre los ajustes y daños de un rango de
-- fechas con el índice `(companyId, createdAt)` que ya existe, y un índice nuevo sobre la tabla que escribe cada venta no se
-- justifica por una consulta de reporte.
--
-- Orden de despliegue (docs/MIGRACIONES.md): ESTE SQL PRIMERO en Supabase, el código después. Con el SQL aplicado y el código
-- viejo no pasa nada (la columna se ignora); con el código nuevo y SIN el SQL, el inventario y los pedidos fallan (Prisma pide
-- todas las columnas del movimiento en cada lectura y cada venta escribe uno). Depende de 20261059 (costos): ahí nació `unitCost`.

ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "reasonCode" TEXT;

-- Un código tiene la forma de un código: mayúsculas, dígitos y guion bajo, empezando por una letra.
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_motivo_codigo"
      CHECK ("reasonCode" IS NULL OR "reasonCode" ~ '^[A-Z][A-Z0-9_]{1,39}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "inventory_movements" VALIDATE CONSTRAINT "inventory_movements_motivo_codigo";

-- Solo un ajuste o un daño se explica con un motivo del catálogo. Una venta con «motivo: robo» sería un dato que nadie sabría leer.
DO $$ BEGIN
    ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_motivo_codigo_tipo"
      CHECK ("reasonCode" IS NULL OR "type" IN ('ADJUSTMENT', 'DAMAGE')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "inventory_movements" VALIDATE CONSTRAINT "inventory_movements_motivo_codigo_tipo";
