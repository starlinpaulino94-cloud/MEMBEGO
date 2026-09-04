-- ============================================================================
-- CRM · Meta · Fase 6 — prospectos y seguimientos
-- ============================================================================
-- QUÉ AÑADE
--
--   prospectos               uno por contacto de mensajería (UNIQUE contactoId);
--                            nace de la primera conversación entrante de quien
--                            todavía no es cliente, con su canal de origen
--   seguimientos_prospecto   llamadas, correos, visitas… programados o hechos
--
-- 100% ADITIVA: dos tablas nuevas. Idempotente. Las dos llevan companyId:
-- tras aplicarla, reaplicar el SQL manual de RLS capa 2 (deduce las políticas
-- del esquema).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "prospectos" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "contactoId"        TEXT NOT NULL,
  "conversacionId"    TEXT,
  "canal"             TEXT NOT NULL,
  "etapa"             TEXT NOT NULL DEFAULT 'nuevo',
  "etapaCambiadaAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nombre"            TEXT,
  "telefono"          TEXT,
  "notas"             TEXT,
  "clienteId"         TEXT,
  "asignadoAId"       TEXT,
  "primerMensajeAt"   TIMESTAMP(3) NOT NULL,
  "ultimaActividadAt" TIMESTAMP(3) NOT NULL,
  "cerradoAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prospectos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "prospectos_contactoId_key" ON "prospectos"("contactoId");
CREATE INDEX IF NOT EXISTS "prospectos_companyId_etapa_idx" ON "prospectos"("companyId", "etapa");
CREATE INDEX IF NOT EXISTS "prospectos_companyId_ultimaActividadAt_idx"
  ON "prospectos"("companyId", "ultimaActividadAt");
ALTER TABLE "prospectos"
  ADD CONSTRAINT "prospectos_contactoId_fkey"
  FOREIGN KEY ("contactoId") REFERENCES "contactos_mensajeria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "seguimientos_prospecto" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "prospectoId"  TEXT NOT NULL,
  "tipo"         TEXT NOT NULL,
  "nota"         TEXT NOT NULL,
  "programadoAt" TIMESTAMP(3),
  "hechoAt"      TIMESTAMP(3),
  "creadoPorId"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seguimientos_prospecto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "seguimientos_prospecto_companyId_hechoAt_programadoAt_idx"
  ON "seguimientos_prospecto"("companyId", "hechoAt", "programadoAt");
CREATE INDEX IF NOT EXISTS "seguimientos_prospecto_prospectoId_createdAt_idx"
  ON "seguimientos_prospecto"("prospectoId", "createdAt");
ALTER TABLE "seguimientos_prospecto"
  ADD CONSTRAINT "seguimientos_prospecto_prospectoId_fkey"
  FOREIGN KEY ("prospectoId") REFERENCES "prospectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prospectos"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seguimientos_prospecto" ENABLE ROW LEVEL SECURITY;
