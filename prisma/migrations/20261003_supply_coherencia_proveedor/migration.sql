--- Membego Supply · el proveedor de una fila y el de su padre tienen que ser EL MISMO.
---
--- ────────────────────────────────────────────────────────────────────────────
--- QUÉ AGUJERO CIERRA, Y CÓMO APARECIÓ
---
--- Al escribir la prueba de aislamiento de supply (25-09-2026) se midió esto:
--- la empresa B podía INSERTAR un `supply_derechos` apuntando al lote de A.
--- La política de RLS ata el derecho por su `proveedorId`, así que si B pone
--- `proveedorId = B` la comprobación pasa — y nadie mira que el LOTE sea suyo.
---
--- El resultado es una fila incoherente: un derecho que consume el lote de A y
--- que A no puede ver. Aparecería en la contabilidad del lote (que se consulta
--- por `loteId`) siendo invisible para su dueño. En el módulo que mueve el
--- dinero de la plataforma, eso es lo peor de los dos mundos.
---
--- Y no era solo ese par. Medidos, hay SIETE pares padre-hijo donde las dos
--- tablas llevan `proveedorId` y nada garantizaba que coincidieran.
---
--- ────────────────────────────────────────────────────────────────────────────
--- POR QUÉ UNA CLAVE COMPUESTA Y NO UNA POLÍTICA MÁS
---
--- Se podría exigir en el `WITH CHECK` de RLS que el padre sea visible. Se
--- prefiere la clave foránea por tres razones:
---
---   1. Aplica SIEMPRE, no solo cuando la aplicación se conecta como
---      `membego_app`. Hoy se conecta como `postgres`, que se salta RLS: una
---      política no protegería nada todavía y esto sí.
---   2. No depende de que alguien acierte con el orden de las claves al deducir
---      las políticas — que es precisamente el fallo que empezó todo esto.
---   3. Un script manual de madrugada también la respeta.
---
--- La clave de una columna se CONSERVA: lleva el `ON DELETE` del modelo y es la
--- que Prisma conoce. La compuesta se añade encima y con el MISMO `ON DELETE`,
--- para no cambiar qué pasa al borrar: con dos claves de distinto borrado,
--- PostgreSQL aplica las dos y la más restrictiva gana en silencio.

-- ── 1. Guarda: si ya hay filas incoherentes, esto se para y las nombra ──────
--
-- Una clave foránea valida las filas existentes al crearse. Si alguna no
-- cuadra, la migración fallaría con un mensaje de PostgreSQL que dice qué
-- restricción falló y no CUÁNTAS filas ni cuáles. Mejor decirlo antes.
DO $$
DECLARE
  malas integer := 0;
  n     integer;
BEGIN
  SELECT count(*) INTO n FROM "supply_derechos" d
    JOIN "supply_lotes" l ON l.id = d."loteId" WHERE l."proveedorId" <> d."proveedorId";
  IF n > 0 THEN RAISE WARNING 'supply_derechos con proveedor distinto al de su lote: %', n; malas := malas + n; END IF;

  SELECT count(*) INTO n FROM "supply_lotes" x
    JOIN "supply_acuerdos" p ON p.id = x."acuerdoId" WHERE p."proveedorId" <> x."proveedorId";
  IF n > 0 THEN RAISE WARNING 'supply_lotes con proveedor distinto al de su acuerdo: %', n; malas := malas + n; END IF;

  SELECT count(*) INTO n FROM "supply_ordenes" x
    JOIN "supply_acuerdos" p ON p.id = x."acuerdoId" WHERE p."proveedorId" <> x."proveedorId";
  IF n > 0 THEN RAISE WARNING 'supply_ordenes incoherentes: %', n; malas := malas + n; END IF;

  SELECT count(*) INTO n FROM "supply_pagos" x
    JOIN "supply_acuerdos" p ON p.id = x."acuerdoId" WHERE p."proveedorId" <> x."proveedorId";
  IF n > 0 THEN RAISE WARNING 'supply_pagos incoherentes: %', n; malas := malas + n; END IF;

  SELECT count(*) INTO n FROM "supply_vouchers" x
    JOIN "supply_derechos" p ON p.id = x."derechoId" WHERE p."proveedorId" <> x."proveedorId";
  IF n > 0 THEN RAISE WARNING 'supply_vouchers incoherentes: %', n; malas := malas + n; END IF;

  SELECT count(*) INTO n FROM "supply_redenciones" x
    JOIN "supply_vouchers" p ON p.id = x."voucherId" WHERE p."proveedorId" <> x."proveedorId";
  IF n > 0 THEN RAISE WARNING 'supply_redenciones incoherentes: %', n; malas := malas + n; END IF;

  SELECT count(*) INTO n FROM "supply_reservas" x
    JOIN "supply_derechos" p ON p.id = x."derechoId" WHERE p."proveedorId" <> x."proveedorId";
  IF n > 0 THEN RAISE WARNING 'supply_reservas incoherentes: %', n; malas := malas + n; END IF;

  IF malas > 0 THEN
    RAISE EXCEPTION
      'Hay % fila(s) de supply cuyo proveedor no coincide con el de su padre. Los avisos de arriba dicen en qué tabla. Corrígelas antes de aplicar esta migración: la clave foránea no puede crearse sobre datos que ya la incumplen.', malas;
  END IF;
END $$;

-- ── 2. Las claves únicas que la compuesta necesita apuntar ──────────────────
-- Redundantes con la clave primaria en cuanto a unicidad —`id` ya es único—,
-- pero PostgreSQL exige un índice único EXACTAMENTE sobre las columnas a las
-- que apunta la clave foránea.
--
-- SE AÑADEN SIN BORRAR, y esa es la diferencia entre correr esto dos veces y
-- que falle: un `DROP CONSTRAINT IF EXISTS` delante parece más limpio y no lo
-- es —en la segunda pasada las claves compuestas de abajo ya dependen de estas
-- únicas, y PostgreSQL se niega a borrarlas—. Comprobado.
DO $$ BEGIN
    ALTER TABLE "supply_acuerdos" ADD CONSTRAINT "supply_acuerdos_id_proveedorId_key" UNIQUE ("id", "proveedorId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_id_proveedorId_key" UNIQUE ("id", "proveedorId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_derechos" ADD CONSTRAINT "supply_derechos_id_proveedorId_key" UNIQUE ("id", "proveedorId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_vouchers" ADD CONSTRAINT "supply_vouchers_id_proveedorId_key" UNIQUE ("id", "proveedorId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 3. Fuera las claves de UNA columna ─────────────────────────────────────
-- El esquema de Prisma declara ahora UNA relación por par, la compuesta. Dejar
-- también la simple haría que `migrate diff` viera una clave de más y el check
-- «Esquema de base de datos» marcara deriva en cada PR. Y no hace falta: la
-- compuesta incluye la misma columna, así que la integridad referencial no se
-- pierde ni un instante — se sustituye dentro de la misma transacción.
ALTER TABLE "supply_derechos"    DROP CONSTRAINT IF EXISTS "supply_derechos_loteId_fkey";
ALTER TABLE "supply_lotes"       DROP CONSTRAINT IF EXISTS "supply_lotes_acuerdoId_fkey";
ALTER TABLE "supply_ordenes"     DROP CONSTRAINT IF EXISTS "supply_ordenes_acuerdoId_fkey";
ALTER TABLE "supply_pagos"       DROP CONSTRAINT IF EXISTS "supply_pagos_acuerdoId_fkey";
ALTER TABLE "supply_vouchers"    DROP CONSTRAINT IF EXISTS "supply_vouchers_derechoId_fkey";
ALTER TABLE "supply_redenciones" DROP CONSTRAINT IF EXISTS "supply_redenciones_voucherId_fkey";
ALTER TABLE "supply_reservas"    DROP CONSTRAINT IF EXISTS "supply_reservas_derechoId_fkey";

-- ── 4. Las siete claves compuestas ─────────────────────────────────────────
-- El `ON DELETE` de cada una copia el de la clave de una columna que ya existe:
-- RESTRICT donde el modelo no quiere perder historia, CASCADE donde el hijo no
-- tiene sentido sin su padre (un voucher o una reserva sin su derecho). Con dos
-- claves de distinto borrado sobre las mismas columnas, PostgreSQL aplica las
-- dos y la más restrictiva gana en silencio: por eso se copia y no se elige.
DO $$ BEGIN
    ALTER TABLE "supply_derechos" ADD CONSTRAINT "supply_derechos_loteId_proveedorId_fkey"
      FOREIGN KEY ("loteId", "proveedorId") REFERENCES "supply_lotes"("id", "proveedorId")
      ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_lotes" ADD CONSTRAINT "supply_lotes_acuerdoId_proveedorId_fkey"
      FOREIGN KEY ("acuerdoId", "proveedorId") REFERENCES "supply_acuerdos"("id", "proveedorId")
      ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_ordenes" ADD CONSTRAINT "supply_ordenes_acuerdoId_proveedorId_fkey"
      FOREIGN KEY ("acuerdoId", "proveedorId") REFERENCES "supply_acuerdos"("id", "proveedorId")
      ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_pagos" ADD CONSTRAINT "supply_pagos_acuerdoId_proveedorId_fkey"
      FOREIGN KEY ("acuerdoId", "proveedorId") REFERENCES "supply_acuerdos"("id", "proveedorId")
      ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_vouchers" ADD CONSTRAINT "supply_vouchers_derechoId_proveedorId_fkey"
      FOREIGN KEY ("derechoId", "proveedorId") REFERENCES "supply_derechos"("id", "proveedorId")
      ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_redenciones" ADD CONSTRAINT "supply_redenciones_voucherId_proveedorId_fkey"
      FOREIGN KEY ("voucherId", "proveedorId") REFERENCES "supply_vouchers"("id", "proveedorId")
      ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "supply_reservas" ADD CONSTRAINT "supply_reservas_derechoId_proveedorId_fkey"
      FOREIGN KEY ("derechoId", "proveedorId") REFERENCES "supply_derechos"("id", "proveedorId")
      ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
