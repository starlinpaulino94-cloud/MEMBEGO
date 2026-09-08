-- ============================================================================
-- MENSAJERÍA · Meta · Fase 2 — contactos, conversaciones, mensajes, plantillas
-- ============================================================================
-- QUÉ AÑADE
--
-- Lo que una empresa habla con sus clientes por WhatsApp (y después Messenger
-- e Instagram), en un solo sitio del que leen la bandeja, el CRM y las
-- automatizaciones:
--
--   contactos_mensajeria   la persona al otro lado, por empresa y canal
--                          (UNIQUE companyId+canal+idExterno)
--   conversaciones         un hilo activo↔contacto (UNIQUE companyId+activo+contacto)
--   mensajes               entrantes y salientes; UNIQUE canal+idExterno hace
--                          inofensivo un reintento del webhook
--   plantillas_whatsapp    lo que Meta devuelve de GET /{WABA}/message_templates
--
-- 100% ADITIVA: cuatro tablas nuevas. Idempotente. Todas llevan companyId:
-- tras aplicarla, reaplicar el SQL manual de RLS capa 2 (deduce las políticas
-- del esquema).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "contactos_mensajeria" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "canal"     TEXT NOT NULL,
  "idExterno" TEXT NOT NULL,
  "nombre"    TEXT,
  "telefono"  TEXT,
  "clienteId" TEXT,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contactos_mensajeria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "contactos_mensajeria_companyId_canal_idExterno_key"
  ON "contactos_mensajeria"("companyId", "canal", "idExterno");
CREATE INDEX IF NOT EXISTS "contactos_mensajeria_companyId_clienteId_idx"
  ON "contactos_mensajeria"("companyId", "clienteId");

CREATE TABLE IF NOT EXISTS "conversaciones" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "canal"            TEXT NOT NULL,
  "activoId"         TEXT NOT NULL,
  "contactoId"       TEXT NOT NULL,
  "estado"           TEXT NOT NULL DEFAULT 'ABIERTA',
  "asignadoAId"      TEXT,
  "ultimoEntranteAt" TIMESTAMP(3),
  "ultimoMensajeAt"  TIMESTAMP(3),
  "ultimoTexto"      TEXT,
  "noLeidos"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversaciones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversaciones_companyId_activoId_contactoId_key"
  ON "conversaciones"("companyId", "activoId", "contactoId");
CREATE INDEX IF NOT EXISTS "conversaciones_companyId_ultimoMensajeAt_idx"
  ON "conversaciones"("companyId", "ultimoMensajeAt");
ALTER TABLE "conversaciones"
  ADD CONSTRAINT "conversaciones_activoId_fkey"
  FOREIGN KEY ("activoId") REFERENCES "activos_meta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversaciones"
  ADD CONSTRAINT "conversaciones_contactoId_fkey"
  FOREIGN KEY ("contactoId") REFERENCES "contactos_mensajeria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "mensajes" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "conversacionId"    TEXT NOT NULL,
  "canal"             TEXT NOT NULL,
  "direccion"         TEXT NOT NULL,
  "idExterno"         TEXT,
  "tipo"              TEXT NOT NULL,
  "texto"             TEXT,
  "adjuntos"          JSONB,
  "plantilla"         JSONB,
  "estado"            TEXT NOT NULL DEFAULT 'RECIBIDO',
  "errorCodigo"       INTEGER,
  "errorDetalle"      TEXT,
  "enviadoPorId"      TEXT,
  "origen"            TEXT,
  "contextoIdExterno" TEXT,
  "timestamp"         TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mensajes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "mensajes_canal_idExterno_key" ON "mensajes"("canal", "idExterno");
CREATE INDEX IF NOT EXISTS "mensajes_conversacionId_timestamp_idx" ON "mensajes"("conversacionId", "timestamp");
CREATE INDEX IF NOT EXISTS "mensajes_companyId_timestamp_idx" ON "mensajes"("companyId", "timestamp");
ALTER TABLE "mensajes"
  ADD CONSTRAINT "mensajes_conversacionId_fkey"
  FOREIGN KEY ("conversacionId") REFERENCES "conversaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "plantillas_whatsapp" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "activoId"       TEXT NOT NULL,
  "idExterno"      TEXT NOT NULL,
  "nombre"         TEXT NOT NULL,
  "idioma"         TEXT NOT NULL,
  "categoria"      TEXT NOT NULL,
  "estado"         TEXT NOT NULL,
  "componentes"    JSONB NOT NULL,
  "variables"      INTEGER NOT NULL DEFAULT 0,
  "sincronizadoAt" TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plantillas_whatsapp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "plantillas_whatsapp_activoId_idExterno_key"
  ON "plantillas_whatsapp"("activoId", "idExterno");
CREATE INDEX IF NOT EXISTS "plantillas_whatsapp_companyId_estado_idx"
  ON "plantillas_whatsapp"("companyId", "estado");

ALTER TABLE "contactos_mensajeria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversaciones"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mensajes"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plantillas_whatsapp"  ENABLE ROW LEVEL SECURITY;
