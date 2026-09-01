-- ============================================================================
-- MEMBEGO CONNECT · Fase 5 — Estados de un flujo OAuth en curso
-- ============================================================================
-- La fila ES el permiso de canjear el código: se borra al canjear, dentro de
-- la misma transacción, y por eso el canje es de un solo uso sin ventana entre
-- comprobar y marcar (mismo patrón que `tokens_sso_usados`).
--
-- Guarda también el `code_verifier` de PKCE, que por definición no puede
-- viajar por el navegador.
--
-- 100% ADITIVA. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "estados_oauth" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "conexionId"   TEXT NOT NULL,
    "conectorSlug" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "iniciadoPor"  TEXT,
    "volverA"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "estados_oauth_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "estados_oauth_companyId_idx" ON "estados_oauth"("companyId");
-- Para que la purga del cron sea un recorrido por índice y no una lectura de
-- toda la tabla.
CREATE INDEX IF NOT EXISTS "estados_oauth_expiraAt_idx" ON "estados_oauth"("expiraAt");

-- Un verificador vacío haría que PKCE no protegiera de nada, y el fallo sería
-- invisible: el flujo seguiría funcionando.
DO $$ BEGIN ALTER TABLE "estados_oauth"
  ADD CONSTRAINT "estados_oauth_verifier_no_vacio"
  CHECK (length("codeVerifier") >= 43);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'connect_oauth' AS objeto,
       CASE WHEN to_regclass('public.estados_oauth') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado;
