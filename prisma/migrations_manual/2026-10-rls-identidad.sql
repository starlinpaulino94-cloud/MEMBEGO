-- ============================================================================
-- RLS · IDENTIDAD — aislamiento de la verificación de identidad
-- (docs/identidad/AUDITORIA-VERIFICACION-IDENTIDAD.md, sección «RLS y tenancy»)
-- ============================================================================
--
-- Complementa `2026-07-rls-capa2-aislamiento.sql` (Capa 2) y sigue el molde de
-- `2026-08-rls-geo.sql`. Se aplica DESPUÉS de la Capa 2 y de la migración
-- `20261079_identidad_verificacion`. Idempotente.
--
-- ESTO NO SE APLICA SOLO. Léelo entero antes de correrlo, y lee docs/RLS.md.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUÉ POLÍTICA LLEVA CADA TABLA (y por qué no basta la deducción genérica)
--
--   · TABLAS DE LA PERSONA (identidad_verificaciones, identidad_intentos,
--     identidad_consentimientos): SOLO SU DUEÑO o el superadmin (omnisciente).
--     La identidad de una persona NO es un dato de empresa: ninguna empresa lee
--     estas tablas. Una empresa ve, como mucho, la proyección binaria que el
--     worker escribe en `clientes` (identidadEstado/Nivel/VerificadaEn) y solo
--     si la persona consintió la divulgación. Por eso se pone una política de
--     dueño que usa `app.user_id` (lo fija `conUsuario()` en src/lib/tenant.ts).
--
--   · INTERRUPTOR (identidad_interruptores): lo lee y lo escribe solo el
--     superadmin (omnisciente). Es configuración de la plataforma.
--
-- ⚠️ ORDEN DE APLICACIÓN: si algún día se vuelve a correr la Capa 2, esa
--    rederiva `membego_inquilino` sobre TODAS las tablas con companyId; estas
--    no lo tienen, así que no las toca, pero conviene volver a correr ESTE
--    archivo después por si cambia el criterio. Se deja documentado aquí
--    porque es el tipo de paso que se olvida.
-- ============================================================================

-- ── 0. Requisitos ───────────────────────────────────────────────────────────
DO $requisitos$
BEGIN
  IF to_regclass('public.identidad_verificaciones') IS NULL THEN
    RAISE EXCEPTION
      'Falta la migración 20261079_identidad_verificacion. Aplícala primero y vuelve a correr este archivo.';
  END IF;
  IF to_regclass('public.identidad_eventos_externos') IS NULL THEN
    RAISE EXCEPTION
      'Falta la migración 20261081_identidad_proveedor. Aplícala primero y vuelve a correr este archivo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'membego_app') THEN
    RAISE EXCEPTION
      'No existe el rol membego_app: la Capa 2 de RLS no está instalada en esta base. Este archivo no aplica todavía; aplica antes prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql.';
  END IF;
END $requisitos$;

-- ── 1. Tablas de la persona: política de DUEÑO (app.user_id) ────────────────
DROP POLICY IF EXISTS membego_dueno ON "identidad_verificaciones";
CREATE POLICY membego_dueno ON "identidad_verificaciones" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR "userId" = current_setting('app.user_id', true));

DROP POLICY IF EXISTS membego_dueno ON "identidad_intentos";
CREATE POLICY membego_dueno ON "identidad_intentos" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR "userId" = current_setting('app.user_id', true));

DROP POLICY IF EXISTS membego_dueno ON "identidad_consentimientos";
CREATE POLICY membego_dueno ON "identidad_consentimientos" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR "userId" = current_setting('app.user_id', true));

-- ── 2. Interruptor: solo omnisciente ────────────────────────────────────────
DROP POLICY IF EXISTS membego_plataforma ON "identidad_interruptores";
CREATE POLICY membego_plataforma ON "identidad_interruptores" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on')
  WITH CHECK (current_setting('app.omnisciente', true) = 'on');

-- ── 2b. Bandeja de avisos del proveedor (Fase 2): solo omnisciente ──────────
-- Es de la plataforma, no de una persona ni de una empresa: solo la lee y escribe el worker
-- (`sinEmpresa`, que fija app.omnisciente). Requiere la migración 20261081_identidad_proveedor.
DROP POLICY IF EXISTS membego_plataforma ON "identidad_eventos_externos";
CREATE POLICY membego_plataforma ON "identidad_eventos_externos" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on')
  WITH CHECK (current_setting('app.omnisciente', true) = 'on');

-- ── 3. Verificación ─────────────────────────────────────────────────────────
--   -- Con el usuario u1 puesto, no debe verse la verificación de u2.
--   set role membego_app;
--   set local app.user_id = 'u1';
--   select count(*) from identidad_verificaciones;   -- solo la de u1
--   select count(*) from identidad_interruptores;    -- 0 (no es omnisciente)
--   reset role;
--
-- MARCHA ATRÁS:
--   drop policy if exists membego_dueno on identidad_verificaciones;
--   drop policy if exists membego_dueno on identidad_intentos;
--   drop policy if exists membego_dueno on identidad_consentimientos;
--   drop policy if exists membego_plataforma on identidad_interruptores;
--   drop policy if exists membego_plataforma on identidad_eventos_externos;
