-- VERIFICACIÓN DE IDENTIDAD DE LA PERSONA (Fase 1 · backend y modelos).
--
-- Diseño: docs/identidad/AUDITORIA-VERIFICACION-IDENTIDAD.md (aprobado el 22-10-2026).
--
-- Cuatro tablas de la PERSONA (cuelgan de `users`, como `geo_consents`), una proyección en
-- `clientes` y el interruptor. Nada de esto guarda imágenes, vídeo, plantillas biométricas, número
-- de cédula en claro, nombre legal ni tokens del proveedor: el proveedor conserva los documentos
-- bajo contrato y Membego guarda el RESULTADO, una referencia sellada y el rastro.
--
-- Idempotente (CREATE ... IF NOT EXISTS, FKs y CHECKs en DO $$): se puede volver a correr, por
-- ejemplo pegada en el SQL Editor de Supabase, sin duplicar nada. Aditiva: solo añade.
--
-- RLS: se ACTIVA aquí (sin política = denegado para todo rol que no la bypasee; la aplicación se
-- conecta como `postgres`, que sí). La política por `app.user_id` va en
-- prisma/migrations_manual/2026-10-rls-identidad.sql, como las demás tablas de la persona.

-- ─── 1. El resultado global ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "identidad_verificaciones" (
    "id"                         TEXT         NOT NULL,
    "userId"                     TEXT         NOT NULL,
    "estado"                     TEXT         NOT NULL DEFAULT 'no_verificada',
    "nivel"                      TEXT,
    "viaVerificacion"            TEXT,
    "proveedor"                  TEXT,
    "referenciaProveedorSellada" TEXT,
    "claveVersion"               INTEGER,
    "hashDedupe"                 TEXT,
    "verificadaEn"               TIMESTAMP(3),
    "expiraEn"                   TIMESTAMP(3),
    "revocadaEn"                 TIMESTAMP(3),
    "motivoRevocacion"           TEXT,
    "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identidad_verificaciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "identidad_verificaciones_userId_key"
  ON "identidad_verificaciones" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "identidad_verificaciones_hashDedupe_key"
  ON "identidad_verificaciones" ("hashDedupe");
CREATE INDEX IF NOT EXISTS "identidad_verificaciones_estado_expiraEn_idx"
  ON "identidad_verificaciones" ("estado", "expiraEn");

-- ─── 2. El historial de intentos ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "identidad_intentos" (
    "id"                         TEXT         NOT NULL,
    "userId"                     TEXT         NOT NULL,
    "verificacionId"             TEXT,
    "estado"                     TEXT         NOT NULL DEFAULT 'creada',
    "tipoRechazo"                TEXT,
    "codigoRazon"                TEXT,
    "canal"                      TEXT         NOT NULL,
    "origen"                     TEXT         NOT NULL DEFAULT 'cliente',
    "actorUserId"                TEXT,
    "nonce"                      TEXT,
    "referenciaProveedorSellada" TEXT,
    "claveVersion"               INTEGER,
    "consentimientoBiometriaId"  TEXT,
    "creadoAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoAt"                 TIMESTAMP(3),
    "enviadoAt"                  TIMESTAMP(3),
    "resueltoAt"                 TIMESTAMP(3),
    "venceAt"                    TIMESTAMP(3),
    "updatedAt"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identidad_intentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "identidad_intentos_userId_creadoAt_idx"
  ON "identidad_intentos" ("userId", "creadoAt");
CREATE INDEX IF NOT EXISTS "identidad_intentos_estado_venceAt_idx"
  ON "identidad_intentos" ("estado", "venceAt");

-- ─── 3. El registro de consentimientos ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "identidad_consentimientos" (
    "id"           TEXT         NOT NULL,
    "userId"       TEXT         NOT NULL,
    "tipo"         TEXT         NOT NULL,
    "textoVersion" TEXT         NOT NULL,
    "canal"        TEXT         NOT NULL,
    "otorgadoAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocadoAt"   TIMESTAMP(3),
    "ipAddress"    TEXT,
    "userAgent"    TEXT,

    CONSTRAINT "identidad_consentimientos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "identidad_consentimientos_userId_tipo_revocadoAt_idx"
  ON "identidad_consentimientos" ("userId", "tipo", "revocadoAt");

-- ─── 4. El interruptor ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "identidad_interruptores" (
    "clave"       TEXT         NOT NULL,
    "enabled"     BOOLEAN      NOT NULL DEFAULT false,
    "reason"      TEXT,
    "changedById" TEXT,
    "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identidad_interruptores_pkey" PRIMARY KEY ("clave")
);

-- Nace APAGADO. Sin esta fila la verificación tampoco funciona (falta el interruptor = apagado),
-- pero la fila deja dicho desde cuándo y por qué.
INSERT INTO "identidad_interruptores" ("clave", "enabled", "reason")
VALUES ('VERIFICACION_IDENTIDAD', false, 'Nace apagada: hace falta el dictamen legal, el DPA con el proveedor y la configuración del entorno.')
ON CONFLICT ("clave") DO NOTHING;

-- ─── 5. Proyección sobre la ficha del cliente ───────────────────────────────
--
-- Lo único que una EMPRESA ve de la identidad de la persona. NULL = «no consta»; una empresa no
-- puede inferir un rechazo de este campo.

ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "identidadEstado"       TEXT;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "identidadNivel"        TEXT;
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "identidadVerificadaEn" TIMESTAMP(3);

-- ─── 6. Claves foráneas ─────────────────────────────────────────────────────
--
-- Todas desde `users`: si la persona elimina su cuenta, su rastro de identidad desaparece con ella
-- (el borrado en el proveedor lo hace el flujo de supresión ANTES de `deleteUser`).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_verificaciones_userId_fkey') THEN
    ALTER TABLE "identidad_verificaciones"
      ADD CONSTRAINT "identidad_verificaciones_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_intentos_userId_fkey') THEN
    ALTER TABLE "identidad_intentos"
      ADD CONSTRAINT "identidad_intentos_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_intentos_verificacionId_fkey') THEN
    ALTER TABLE "identidad_intentos"
      ADD CONSTRAINT "identidad_intentos_verificacionId_fkey"
      FOREIGN KEY ("verificacionId") REFERENCES "identidad_verificaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_consentimientos_userId_fkey') THEN
    ALTER TABLE "identidad_consentimientos"
      ADD CONSTRAINT "identidad_consentimientos_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_interruptores_changedById_fkey') THEN
    ALTER TABLE "identidad_interruptores"
      ADD CONSTRAINT "identidad_interruptores_changedById_fkey"
      FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── 7. Valores válidos (la segunda barrera; el código los valida también) ──
--
-- Prisma no sabe de CHECK, así que no genera deriva. Son la red por si alguien escribe por fuera
-- del servicio: un estado inventado no entra.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_verificaciones_estado_chk') THEN
    ALTER TABLE "identidad_verificaciones" ADD CONSTRAINT "identidad_verificaciones_estado_chk"
      CHECK ("estado" IN ('no_verificada', 'verificada', 'expirada', 'revocada', 'requiere_revalidacion'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_verificaciones_nivel_chk') THEN
    ALTER TABLE "identidad_verificaciones" ADD CONSTRAINT "identidad_verificaciones_nivel_chk"
      CHECK ("nivel" IS NULL OR "nivel" IN ('contacto', 'documento_selfie', 'jce_oficial'));
  END IF;
  -- Verificada ⇒ con nivel, fecha y expiración: una fila «verificada» sin esos datos no vale.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_verificaciones_verificada_completa_chk') THEN
    ALTER TABLE "identidad_verificaciones" ADD CONSTRAINT "identidad_verificaciones_verificada_completa_chk"
      CHECK ("estado" <> 'verificada'
             OR ("nivel" IS NOT NULL AND "verificadaEn" IS NOT NULL AND "expiraEn" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_intentos_estado_chk') THEN
    ALTER TABLE "identidad_intentos" ADD CONSTRAINT "identidad_intentos_estado_chk"
      CHECK ("estado" IN ('creada', 'iniciada', 'enviada', 'en_proceso', 'aprobada',
                          'rechazada_reintentable', 'rechazada_definitiva', 'reenvio_requerido',
                          'en_revision', 'expirada', 'abandonada', 'cancelada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_intentos_tipo_rechazo_chk') THEN
    ALTER TABLE "identidad_intentos" ADD CONSTRAINT "identidad_intentos_tipo_rechazo_chk"
      CHECK ("tipoRechazo" IS NULL OR "tipoRechazo" IN ('reintentable', 'definitivo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_intentos_canal_chk') THEN
    ALTER TABLE "identidad_intentos" ADD CONSTRAINT "identidad_intentos_canal_chk"
      CHECK ("canal" IN ('web', 'movil_hospedado', 'movil_nativo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_intentos_origen_chk') THEN
    ALTER TABLE "identidad_intentos" ADD CONSTRAINT "identidad_intentos_origen_chk"
      CHECK ("origen" IN ('cliente', 'staff', 'sistema'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_consentimientos_tipo_chk') THEN
    ALTER TABLE "identidad_consentimientos" ADD CONSTRAINT "identidad_consentimientos_tipo_chk"
      CHECK ("tipo" IN ('IDENTIDAD_BIOMETRIA', 'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', 'IDENTIDAD_DIVULGACION_EMPRESAS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identidad_consentimientos_canal_chk') THEN
    ALTER TABLE "identidad_consentimientos" ADD CONSTRAINT "identidad_consentimientos_canal_chk"
      CHECK ("canal" IN ('web', 'movil', 'soporte'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clientes_identidad_estado_chk') THEN
    ALTER TABLE "clientes" ADD CONSTRAINT "clientes_identidad_estado_chk"
      CHECK ("identidadEstado" IS NULL OR "identidadEstado" = 'verificada');
  END IF;
END $$;

-- ─── 8. Índices únicos parciales ────────────────────────────────────────────
--
-- Prisma no expresa índices parciales: viven solo aquí.

-- UN solo intento abierto por persona. Dos pestañas, dos dispositivos o un doble clic no pueden
-- abrir dos sesiones con el proveedor (y cobrar dos veces) ni dejar dos intentos compitiendo por
-- el mismo resultado.
CREATE UNIQUE INDEX IF NOT EXISTS "identidad_intentos_uno_abierto_uk"
  ON "identidad_intentos" ("userId")
  WHERE "estado" IN ('creada', 'iniciada', 'enviada', 'en_proceso', 'reenvio_requerido', 'en_revision');

-- Un consentimiento VIGENTE por persona y tipo.
CREATE UNIQUE INDEX IF NOT EXISTS "identidad_consentimientos_vigente_uk"
  ON "identidad_consentimientos" ("userId", "tipo")
  WHERE "revocadoAt" IS NULL;

-- ─── 9. RLS ─────────────────────────────────────────────────────────────────
--
-- Sin política, RLS deniega a todo rol que no la bypasee. La aplicación se conecta como
-- `postgres` (BYPASSRLS), así que hoy no cambia nada; la política por `app.user_id` va en
-- prisma/migrations_manual/2026-10-rls-identidad.sql. Ver docs/RLS.md.

ALTER TABLE "identidad_verificaciones"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identidad_intentos"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identidad_consentimientos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identidad_interruptores"   ENABLE ROW LEVEL SECURITY;
