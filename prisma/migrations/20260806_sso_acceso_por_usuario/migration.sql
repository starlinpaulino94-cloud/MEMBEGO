-- ============================================================================
-- PLATAFORMA · Fase 5 — Acceso por usuario y SSO de un solo uso
-- ============================================================================
-- Ver docs/platform/sso.md y docs/PLATFORM_ARCHITECTURE_REPORT.md §13, §50.
--
-- Dos cosas:
--
--   1. `usuarios_sistemas` — el nivel que faltaba. `empresas_sistemas` dice que
--      el restaurante tiene contratado el sistema; esto dice que María es
--      camarera y Juan es cocina.
--
--      `systemRole` es una CADENA LIBRE a propósito. Un enum obligaría a
--      desplegar el Core cada vez que un vertical inventara un puesto, que es
--      exactamente la dependencia que esta arquitectura existe para eliminar.
--
--   2. `tokens_sso_usados` — el uso único. Hoy un token SSO vale las veces que
--      quieras durante sus 90 segundos: quien capture la URL del historial del
--      navegador entra. Con esta tabla, el primer canje gana y el segundo
--      choca contra la clave primaria.
--
--      Es una tabla y no un campo `usado` porque así no hay lectura previa, y
--      por tanto no hay ventana entre comprobar y marcar — que es justo donde
--      dos peticiones simultáneas conseguirían canjear las dos.
--
-- 100% ADITIVA y compatible: `accesoPorUsuario` nace en FALSE, así que ningún
-- empleado pierde el acceso que tiene hoy. Idempotente.
-- ============================================================================

-- ── 1 · ¿Hace falta acceso explícito por persona? ───────────────────────────
--
-- FALSE por defecto, y por el mismo motivo que `autoHabilitar` en la Fase 1b:
-- hoy cualquier miembro del equipo abre el satélite de su empresa, y exigir de
-- golpe una fila por persona dejaría a toda la plantilla fuera el día del
-- despliegue.
ALTER TABLE "sistemas_conectados"
  ADD COLUMN IF NOT EXISTS "accesoPorUsuario" BOOLEAN NOT NULL DEFAULT false;

-- ── 2 · Acceso de una persona a un sistema ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "usuarios_sistemas" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "companyId"  TEXT NOT NULL,
    "sistemaId"  TEXT NOT NULL,
    "systemRole" TEXT NOT NULL,
    "estado"     TEXT NOT NULL DEFAULT 'ACTIVE',
    "permisos"   JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "usuarios_sistemas_pkey" PRIMARY KEY ("id")
);

-- Una persona, un sistema, una empresa: un solo rol. La misma persona SÍ puede
-- tener roles distintos en dos empresas, y por eso `companyId` está en la clave.
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_sistemas_userId_sistemaId_companyId_key"
  ON "usuarios_sistemas"("userId","sistemaId","companyId");
CREATE INDEX IF NOT EXISTS "usuarios_sistemas_companyId_sistemaId_estado_idx"
  ON "usuarios_sistemas"("companyId","sistemaId","estado");

DO $$ BEGIN ALTER TABLE "usuarios_sistemas" ADD CONSTRAINT "usuarios_sistemas_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "usuarios_sistemas" ADD CONSTRAINT "usuarios_sistemas_sistemaId_fkey"
  FOREIGN KEY ("sistemaId") REFERENCES "sistemas_conectados"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "usuarios_sistemas"
  ADD CONSTRAINT "usuarios_sistemas_estado_valido"
  CHECK ("estado" IN ('ACTIVE','SUSPENDED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un rol vacío no es un rol: viajaría en el token y el satélite tendría que
-- adivinar qué hacer con él.
DO $$ BEGIN ALTER TABLE "usuarios_sistemas"
  ADD CONSTRAINT "usuarios_sistemas_rol_no_vacio"
  CHECK (length(trim("systemRole")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3 · Tokens SSO ya canjeados ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tokens_sso_usados" (
    "jti"       TEXT NOT NULL,
    "sistemaId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "usadoAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tokens_sso_usados_pkey" PRIMARY KEY ("jti")
);
CREATE INDEX IF NOT EXISTS "tokens_sso_usados_expiraAt_idx"
  ON "tokens_sso_usados"("expiraAt");

DO $$ BEGIN ALTER TABLE "tokens_sso_usados"
  ADD CONSTRAINT "tokens_sso_usados_direccion_valida"
  CHECK ("direccion" IN ('SALIENTE','ENTRANTE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'sso_acceso_por_usuario' AS objeto,
       CASE WHEN to_regclass('public.usuarios_sistemas') IS NOT NULL
             AND to_regclass('public.tokens_sso_usados') IS NOT NULL
            THEN 'OK' ELSE 'FALTA' END AS estado,
       (SELECT count(*) FROM "sistemas_conectados" WHERE "accesoPorUsuario") AS sistemas_estrictos;
