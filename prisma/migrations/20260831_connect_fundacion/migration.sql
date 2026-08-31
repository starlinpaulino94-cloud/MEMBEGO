-- ============================================================================
-- MEMBEGO CONNECT · Fase 1 — Foundation
-- ============================================================================
-- La capa de integraciones con servicios EXTERNOS (WhatsApp, Google Calendar…)
-- y las claves de API por empresa. No confunde con `sistemas_conectados`
-- (satélites del ecosistema): aquí MembeGo es CLIENTE de APIs ajenas.
--
--   conectores            catálogo global de conectores nativos (nace VACÍO)
--   conexiones_empresa    instancia de un conector en UNA empresa
--   credenciales_conexion secretos SELLADOS con AES-256-GCM en la aplicación
--   claves_api_empresa    clave de un tercero para llamar la API pública
--                         en nombre de UNA empresa (solo hash scrypt)
--   entitlements_empresa  features y límites concedidos a una empresa
--   registros_conector    bitácora (sin FKs: el historial sobrevive a su fuente)
--
-- Además: `automation_events` gana `traceId` — el hilo de operación que el
-- outbox de satélites ya soportaba y el bus perdía en el salto.
--
-- 100% ADITIVA. Nada existente cambia de significado. Idempotente: se puede
-- ejecutar dos veces sin daño.
-- ============================================================================

-- ── 1 · Catálogo de conectores ──────────────────────────────────────────────
-- Nace vacío A PROPÓSITO: una fila se crea cuando el conector funciona de
-- verdad (Fase 6). Un catálogo con logos de servicios que no responden es un
-- interruptor pintado.

CREATE TABLE IF NOT EXISTS "conectores" (
    "id"                TEXT NOT NULL,
    "slug"              TEXT NOT NULL,
    "nombre"            TEXT NOT NULL,
    "descripcion"       TEXT,
    "categoria"         TEXT NOT NULL,
    "icono"             TEXT,
    "docsUrl"           TEXT,
    "authTipo"          TEXT NOT NULL,
    "estado"            TEXT NOT NULL DEFAULT 'DRAFT',
    "scopesDisponibles" TEXT[],
    "config"            JSONB,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conectores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "conectores_slug_key" ON "conectores"("slug");

-- Mismo vocabulario de ciclo de vida que `sistemas_conectados`: cuatro estados
-- ya conocidos por el equipo, no un quinto vocabulario que aprender.
DO $$ BEGIN ALTER TABLE "conectores"
  ADD CONSTRAINT "conectores_estado_valido"
  CHECK ("estado" IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "conectores"
  ADD CONSTRAINT "conectores_auth_valido"
  CHECK ("authTipo" IN ('OAUTH2','API_KEY','NINGUNA'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2 · Conexiones por empresa ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "conexiones_empresa" (
    "id"            TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "conectorId"    TEXT NOT NULL,
    "estado"        TEXT NOT NULL DEFAULT 'PENDING',
    "config"        JSONB,
    "ultimoOkAt"    TIMESTAMP(3),
    "ultimoErrorAt" TIMESTAMP(3),
    "ultimoError"   TEXT,
    "creadoPor"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conexiones_empresa_pkey" PRIMARY KEY ("id")
);

-- Una conexión por conector y empresa (v1). Relajarlo después es expansivo;
-- imponerlo cuando ya haya duplicados no lo sería.
CREATE UNIQUE INDEX IF NOT EXISTS "conexiones_empresa_companyId_conectorId_key"
  ON "conexiones_empresa"("companyId","conectorId");
CREATE INDEX IF NOT EXISTS "conexiones_empresa_companyId_estado_idx"
  ON "conexiones_empresa"("companyId","estado");
CREATE INDEX IF NOT EXISTS "conexiones_empresa_conectorId_estado_idx"
  ON "conexiones_empresa"("conectorId","estado");

-- RESTRICT, no CASCADE: un conector con conexiones vivas no se borra — se pone
-- SUSPENDED/RETIRED. Borrar el catálogo jamás debe arrastrar en silencio las
-- conexiones (y credenciales) de las empresas.
DO $$ BEGIN ALTER TABLE "conexiones_empresa" ADD CONSTRAINT "conexiones_empresa_conectorId_fkey"
  FOREIGN KEY ("conectorId") REFERENCES "conectores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "conexiones_empresa"
  ADD CONSTRAINT "conexiones_empresa_estado_valido"
  CHECK ("estado" IN ('PENDING','CONNECTED','ERROR','DISCONNECTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3 · Credenciales selladas ───────────────────────────────────────────────
-- El secreto viaja SELLADO desde la aplicación (AES-256-GCM, clave maestra en
-- Vercel). Un volcado de esta tabla, sin el entorno, es ruido.

CREATE TABLE IF NOT EXISTS "credenciales_conexion" (
    "id"         TEXT NOT NULL,
    "conexionId" TEXT NOT NULL,
    "companyId"  TEXT NOT NULL,
    "tipo"       TEXT NOT NULL,
    "sellado"    TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "expiresAt"  TIMESTAMP(3),
    "rotadaAt"   TIMESTAMP(3),
    "metadata"   JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "credenciales_conexion_pkey" PRIMARY KEY ("id")
);

-- Una credencial viva por tipo: guardar de nuevo REEMPLAZA, no acumula.
CREATE UNIQUE INDEX IF NOT EXISTS "credenciales_conexion_conexionId_tipo_key"
  ON "credenciales_conexion"("conexionId","tipo");
CREATE INDEX IF NOT EXISTS "credenciales_conexion_companyId_idx"
  ON "credenciales_conexion"("companyId");
-- Para responder «¿cuántas filas siguen selladas con la clave vieja?» con un
-- WHERE durante una rotación, sin abrir ningún sello.
CREATE INDEX IF NOT EXISTS "credenciales_conexion_keyVersion_idx"
  ON "credenciales_conexion"("keyVersion");

-- CASCADE a propósito: si la conexión se borra, sus secretos no pueden quedar
-- huérfanos. (El flujo normal ni borra: desconecta.)
DO $$ BEGIN ALTER TABLE "credenciales_conexion" ADD CONSTRAINT "credenciales_conexion_conexionId_fkey"
  FOREIGN KEY ("conexionId") REFERENCES "conexiones_empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "credenciales_conexion"
  ADD CONSTRAINT "credenciales_conexion_tipo_valido"
  CHECK ("tipo" IN ('OAUTH_TOKENS','API_KEY','SECRETO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un sello vacío no protege nada: no puede entrar ni por SQL a mano.
DO $$ BEGIN ALTER TABLE "credenciales_conexion"
  ADD CONSTRAINT "credenciales_conexion_sellado_no_vacio"
  CHECK (length("sellado") > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4 · Claves de API por empresa ───────────────────────────────────────────
-- El segundo principal de /api/platform/v1 (decisión D4): terceros llamando en
-- nombre de UNA empresa. Solo el HASH scrypt del secreto, como en
-- `credenciales_sistema`.

CREATE TABLE IF NOT EXISTS "claves_api_empresa" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "nombre"      TEXT NOT NULL,
    "prefijo"     TEXT NOT NULL,
    "secretoHash" TEXT NOT NULL,
    "scopes"      TEXT[],
    "estado"      TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt"   TIMESTAMP(3),
    "lastUsedAt"  TIMESTAMP(3),
    "creadoPor"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "claves_api_empresa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "claves_api_empresa_prefijo_key"
  ON "claves_api_empresa"("prefijo");
CREATE INDEX IF NOT EXISTS "claves_api_empresa_companyId_estado_idx"
  ON "claves_api_empresa"("companyId","estado");

DO $$ BEGIN ALTER TABLE "claves_api_empresa"
  ADD CONSTRAINT "claves_api_empresa_estado_valido"
  CHECK ("estado" IN ('ACTIVE','REVOKED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "claves_api_empresa"
  ADD CONSTRAINT "claves_api_empresa_hash_no_vacio"
  CHECK (length("secretoHash") > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5 · Entitlements por empresa ────────────────────────────────────────────
-- Decisión D6: existen ANTES que el sistema de planes. Hoy los asigna el
-- superadmin; cuando exista un plan comercial, el plan escribirá estas filas
-- y nada del código que las lee cambiará.

CREATE TABLE IF NOT EXISTS "entitlements_empresa" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "feature"   TEXT NOT NULL,
    "limite"    INTEGER,
    "valor"     JSONB,
    "notas"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entitlements_empresa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "entitlements_empresa_companyId_feature_key"
  ON "entitlements_empresa"("companyId","feature");
CREATE INDEX IF NOT EXISTS "entitlements_empresa_companyId_idx"
  ON "entitlements_empresa"("companyId");

-- ── 6 · Bitácora ────────────────────────────────────────────────────────────
-- Sin claves foráneas A PROPÓSITO: el historial sobrevive a la fila que lo
-- generó. Aquí nunca entra un secreto ni un payload de cliente.

CREATE TABLE IF NOT EXISTS "registros_conector" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "origen"    TEXT NOT NULL,
    "origenId"  TEXT,
    "nivel"     TEXT NOT NULL DEFAULT 'INFO',
    "evento"    TEXT NOT NULL,
    "detalle"   JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "registros_conector_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "registros_conector_companyId_createdAt_idx"
  ON "registros_conector"("companyId","createdAt");
CREATE INDEX IF NOT EXISTS "registros_conector_origenId_createdAt_idx"
  ON "registros_conector"("origenId","createdAt");

DO $$ BEGIN ALTER TABLE "registros_conector"
  ADD CONSTRAINT "registros_conector_nivel_valido"
  CHECK ("nivel" IN ('INFO','WARN','ERROR'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "registros_conector"
  ADD CONSTRAINT "registros_conector_origen_valido"
  CHECK ("origen" IN ('CONEXION','CLAVE_API','BUS','SISTEMA'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 7 · El bus gana el hilo de operación ────────────────────────────────────
-- `eventos_salientes.traceId` ya existía; el bus lo perdía en el salto. Null
-- en filas históricas: el sobre usa entonces su propio id.

ALTER TABLE "automation_events" ADD COLUMN IF NOT EXISTS "traceId" TEXT;

-- ── 8 · Comprobación ────────────────────────────────────────────────────────

SELECT 'connect_fundacion' AS objeto,
       CASE WHEN to_regclass('public.conectores')            IS NOT NULL
             AND to_regclass('public.conexiones_empresa')    IS NOT NULL
             AND to_regclass('public.credenciales_conexion') IS NOT NULL
             AND to_regclass('public.claves_api_empresa')    IS NOT NULL
             AND to_regclass('public.entitlements_empresa')  IS NOT NULL
             AND to_regclass('public.registros_conector')    IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
