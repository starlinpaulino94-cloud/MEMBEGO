-- ============================================================================
-- PLATAFORMA · Fase 2 — Credenciales de la API entrante
-- ============================================================================
-- Ver docs/platform/api-v1.md y docs/PLATFORM_ARCHITECTURE_REPORT.md §8, §20, §26.
--
-- Hasta hoy MembeGo tenía CERO endpoints de entrada: los satélites recibían
-- webhooks y podían abrir sesión por SSO, pero no podían preguntar nada. Un
-- restaurante no tenía forma de saber si el cliente que está en la mesa puede
-- canjear su beneficio.
--
-- Esta tabla es la credencial con la que un sistema llama a `/api/platform/v1`.
-- Es la dirección CONTRARIA a `sistemas_conectados.secreto`, y por eso es otra
-- tabla y otro mecanismo:
--
--   salida   MembeGo → satélite   webhook firmado con el secreto compartido
--   entrada  satélite → MembeGo   OAuth2 client credentials, solo el HASH
--
-- DEL SECRETO SOLO SE GUARDA UN HASH CON SAL (scrypt). Un volcado de esta
-- tabla no permite autenticarse. No es una precaución genérica: este secreto
-- abre datos de clientes de todas las empresas que el sistema atiende.
--
-- 100% ADITIVA. Nada existente cambia. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "credenciales_sistema" (
    "id"               TEXT NOT NULL,
    "sistemaId"        TEXT NOT NULL,
    "clientId"         TEXT NOT NULL,
    "clientSecretHash" TEXT NOT NULL,
    "scopes"           TEXT[],
    "estado"           TEXT NOT NULL DEFAULT 'ACTIVE',
    "descripcion"      TEXT,
    "expiresAt"        TIMESTAMP(3),
    "lastUsedAt"       TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "credenciales_sistema_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credenciales_sistema_clientId_key"
  ON "credenciales_sistema"("clientId");
CREATE INDEX IF NOT EXISTS "credenciales_sistema_sistemaId_estado_idx"
  ON "credenciales_sistema"("sistemaId","estado");

DO $$ BEGIN ALTER TABLE "credenciales_sistema" ADD CONSTRAINT "credenciales_sistema_sistemaId_fkey"
  FOREIGN KEY ("sistemaId") REFERENCES "sistemas_conectados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "credenciales_sistema"
  ADD CONSTRAINT "credenciales_sistema_estado_valido"
  CHECK ("estado" IN ('ACTIVE','REVOKED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un hash vacío autenticaría a cualquiera con el secreto vacío. No puede
-- entrar una fila así ni por SQL a mano.
DO $$ BEGIN ALTER TABLE "credenciales_sistema"
  ADD CONSTRAINT "credenciales_sistema_hash_no_vacio"
  CHECK (length("clientSecretHash") > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'platform_api_credenciales' AS objeto,
       CASE WHEN to_regclass('public.credenciales_sistema') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
