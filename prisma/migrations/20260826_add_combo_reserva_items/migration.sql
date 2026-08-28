-- Tablas combo items y reserva items
-- Faltaban en la fundación de excursiones (20260817).

CREATE TABLE IF NOT EXISTS "excursion_combo_items" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "comboId"     TEXT NOT NULL,
  "actividadId" TEXT NOT NULL,
  "varianteId"  TEXT,
  "horaSalida"  TEXT,
  "orden"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "excursion_combo_items_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "excursion_combo_items" ADD CONSTRAINT "excursion_combo_items_comboId_fkey"
    FOREIGN KEY ("comboId") REFERENCES "excursiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "excursion_combo_items" ADD CONSTRAINT "excursion_combo_items_actividadId_fkey"
    FOREIGN KEY ("actividadId") REFERENCES "excursiones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "excursion_combo_items_comboId_actividadId_key"
  ON "excursion_combo_items"("comboId","actividadId");
CREATE INDEX IF NOT EXISTS "excursion_combo_items_companyId_comboId_idx"
  ON "excursion_combo_items"("companyId","comboId");
CREATE INDEX IF NOT EXISTS "excursion_combo_items_actividadId_idx"
  ON "excursion_combo_items"("actividadId");

CREATE TABLE IF NOT EXISTS "reserva_items" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "reservaId"   TEXT NOT NULL,
  "actividadId" TEXT NOT NULL,
  "varianteId"  TEXT,
  "fecha"       TIMESTAMP(3) NOT NULL,
  "hora"        TEXT,
  "adultos"     INTEGER NOT NULL DEFAULT 0,
  "ninos"       INTEGER NOT NULL DEFAULT 0,
  "estado"      TEXT NOT NULL DEFAULT 'PENDIENTE',
  "checkinAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reserva_items_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "reserva_items" ADD CONSTRAINT "reserva_items_reservaId_fkey"
    FOREIGN KEY ("reservaId") REFERENCES "reservas_excursion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "reserva_items" ADD CONSTRAINT "reserva_items_actividadId_fkey"
    FOREIGN KEY ("actividadId") REFERENCES "excursiones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "reserva_items_companyId_actividadId_fecha_hora_idx"
  ON "reserva_items"("companyId","actividadId","fecha","hora");
CREATE INDEX IF NOT EXISTS "reserva_items_reservaId_idx"
  ON "reserva_items"("reservaId");
