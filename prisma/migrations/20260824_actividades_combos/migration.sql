-- ─────────────────────────────────────────────────────────────────────────────
-- ACTIVIDADES, COMBOS Y METAS POR ÁMBITO — el SQL que la #403 no trajo
--
-- La #403 (combos y pases de día, metas por tipo de vendedor, precios de
-- residente) declaró en el esquema Prisma dos TABLAS nuevas y seis columnas, y
-- se mezcló SIN la migración que las crea. Es el mismo fallo que la #391 — el
-- que esta vez sí llegó a producción.
--
-- Lo que se rompió, y encaja con lo reportado:
--
--   · `vendedor_metas.excursionId` — la pantalla de METAS lo lee en cada meta.
--     Sin la columna, Postgres responde 42703 y la pantalla entera cae con
--     «No se pudo cargar esta sección».
--   · `excursiones.tipoItem` y las tablas de combos — el CATÁLOGO.
--
-- No falla al desplegar: falla la primera vez que alguien abre la pantalla.
--
-- Todo aditivo e idempotente: `IF NOT EXISTS` en tablas, columnas e índices, y
-- las claves foráneas envueltas para que repetir la migración no reviente.
--
-- ⚠️ `vendedor_metas.vendedorId` pasa a admitir NULL. Es lo que permite una
-- meta de TIPO de vendedor o de categoría, que no apunta a nadie en concreto.
-- Aflojar una restricción NO toca ninguna fila existente: las que ya hay
-- siguen con su vendedor.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "excursion_variantes" ADD COLUMN IF NOT EXISTS "precioNinoResidente" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "preciosDinamicos" JSONB;

-- AlterTable
ALTER TABLE "excursiones" ADD COLUMN IF NOT EXISTS "tipoItem" TEXT NOT NULL DEFAULT 'ACTIVIDAD';

-- AlterTable
ALTER TABLE "vendedor_metas" ADD COLUMN IF NOT EXISTS "categoria" TEXT,
ADD COLUMN IF NOT EXISTS "excursionId" TEXT,
ADD COLUMN IF NOT EXISTS "tipoVendedor" TEXT,
ALTER COLUMN "vendedorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "excursion_combo_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "actividadId" TEXT NOT NULL,
    "varianteId" TEXT,
    "horaSalida" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excursion_combo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reserva_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "actividadId" TEXT NOT NULL,
    "varianteId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "hora" TEXT,
    "adultos" INTEGER NOT NULL DEFAULT 0,
    "ninos" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "checkinAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reserva_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "excursion_combo_items_companyId_comboId_idx" ON "excursion_combo_items"("companyId", "comboId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "excursion_combo_items_actividadId_idx" ON "excursion_combo_items"("actividadId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "excursion_combo_items_comboId_actividadId_key" ON "excursion_combo_items"("comboId", "actividadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reserva_items_companyId_actividadId_fecha_hora_idx" ON "reserva_items"("companyId", "actividadId", "fecha", "hora");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reserva_items_reservaId_idx" ON "reserva_items"("reservaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendedor_metas_companyId_activa_idx" ON "vendedor_metas"("companyId", "activa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendedor_metas_tipoVendedor_activa_idx" ON "vendedor_metas"("tipoVendedor", "activa");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "excursion_combo_items" ADD CONSTRAINT "excursion_combo_items_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "excursiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "excursion_combo_items" ADD CONSTRAINT "excursion_combo_items_actividadId_fkey" FOREIGN KEY ("actividadId") REFERENCES "excursiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reserva_items" ADD CONSTRAINT "reserva_items_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "reservas_excursion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reserva_items" ADD CONSTRAINT "reserva_items_actividadId_fkey" FOREIGN KEY ("actividadId") REFERENCES "excursiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
