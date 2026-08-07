-- ============================================================================
-- RLS · GEO — aislamiento del dominio de geolocalización
-- (docs/GEOLOCALIZACION.md §7.4, §7.7 y §11 Fase A)
-- ============================================================================
--
-- Complementa `2026-07-rls-capa2-aislamiento.sql` (Capa 2). Se aplica DESPUÉS
-- de la Capa 2 y de la migración `20260801_geo_fundaciones`. Idempotente.
--
-- ESTO NO SE APLICA SOLO. Léelo entero antes de correrlo, y lee docs/RLS.md.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUÉ POLÍTICA LLEVA CADA TABLA (y por qué no basta la deducción genérica)
--
--   · TABLAS DE EMPRESA (saved_segments, campanas_dirigidas, snapshots,
--     entregas): política de inquilino por companyId (directa o por FK).
--     La Capa 2 las cubriría sola al recorrer el esquema; aquí se crean con
--     nombre propio para que la migración geo sea autocontenida.
--
--   · TABLAS DE LA PERSONA (customer_locations, geo_consents,
--     location_search_events): SOLO SU DUEÑO o el superadmin (omnisciente).
--     La deducción genérica de la Capa 2 las dejaría accesibles a la EMPRESA
--     del usuario (la ubicación de una persona NO es un dato de empresa,
--     G-1). Por eso se borra la política de inquilino que pudiera haber
--     dejado la Capa 2 y se pone una política de dueño que usa
--     `app.user_id` (lo fija `conUsuario()` en src/lib/tenant.ts).
--
--   · CATÁLOGOS GEO (geo_countries, geo_regions, geo_cities, geo_sectors):
--     lectura abierta para cualquier inquilino; escritura solo omnisciente
--     (como business_categories en la Capa 2).
--
-- ⚠️ ORDEN DE APLICACIÓN: si algún día se vuelve a correr la Capa 2, esa
--    rederiva `membego_inquilino` sobre TODAS las tablas, incluidas las de la
--    persona. Después de re-correr la Capa 2 hay que volver a correr ESTE
--    archivo. Se deja documentado aquí porque es el tipo de paso que se olvida.
-- ============================================================================

-- ── 1. Tablas de empresa: política de inquilino (companyId directa) ─────────
DROP POLICY IF EXISTS membego_inquilino ON "saved_segments";
CREATE POLICY membego_inquilino ON "saved_segments" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR "companyId" = current_setting('app.company_id', true))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR "companyId" = current_setting('app.company_id', true));

DROP POLICY IF EXISTS membego_inquilino ON "campanas_dirigidas";
CREATE POLICY membego_inquilino ON "campanas_dirigidas" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR "companyId" = current_setting('app.company_id', true))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR "companyId" = current_setting('app.company_id', true));

-- Snapshot y entregas no llevan companyId: se llega por la FK a campanas_dirigidas.
DROP POLICY IF EXISTS membego_inquilino ON "campana_audiencia_snapshots";
CREATE POLICY membego_inquilino ON "campana_audiencia_snapshots" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR EXISTS (
           SELECT 1 FROM public.campanas_dirigidas c
            WHERE c.id = "campana_audiencia_snapshots"."campanaId"
              AND c."companyId" = current_setting('app.company_id', true)))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR EXISTS (
                SELECT 1 FROM public.campanas_dirigidas c
                 WHERE c.id = "campana_audiencia_snapshots"."campanaId"
                   AND c."companyId" = current_setting('app.company_id', true)));

DROP POLICY IF EXISTS membego_inquilino ON "campana_entregas";
CREATE POLICY membego_inquilino ON "campana_entregas" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR EXISTS (
           SELECT 1 FROM public.campanas_dirigidas c
            WHERE c.id = "campana_entregas"."campanaId"
              AND c."companyId" = current_setting('app.company_id', true)))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR EXISTS (
                SELECT 1 FROM public.campanas_dirigidas c
                 WHERE c.id = "campana_entregas"."campanaId"
                   AND c."companyId" = current_setting('app.company_id', true)));

-- ── 2. Tablas de la persona: política de DUEÑO (app.user_id) ────────────────
-- Se borra primero la de inquilino por si la Capa 2 la dejó puesta.
DROP POLICY IF EXISTS membego_inquilino ON "customer_locations";
DROP POLICY IF EXISTS membego_dueno ON "customer_locations";
CREATE POLICY membego_dueno ON "customer_locations" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR "userId" = current_setting('app.user_id', true));

DROP POLICY IF EXISTS membego_inquilino ON "geo_consents";
DROP POLICY IF EXISTS membego_dueno ON "geo_consents";
CREATE POLICY membego_dueno ON "geo_consents" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR "userId" = current_setting('app.user_id', true));

-- Analítica agregada: el dueño ve la suya; el superadmin (omnisciente) las ve
-- todas para los dashboards. Los eventos anónimos (userId NULL) solo los ve
-- el superadmin.
DROP POLICY IF EXISTS membego_inquilino ON "location_search_events";
DROP POLICY IF EXISTS membego_dueno ON "location_search_events";
CREATE POLICY membego_dueno ON "location_search_events" FOR ALL TO membego_app
  USING (current_setting('app.omnisciente', true) = 'on'
         OR ("userId" IS NOT NULL AND "userId" = current_setting('app.user_id', true)))
  WITH CHECK (current_setting('app.omnisciente', true) = 'on'
              OR ("userId" IS NOT NULL AND "userId" = current_setting('app.user_id', true)));

-- ── 3. Catálogos geo: lectura abierta, escritura solo omnisciente ───────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['geo_countries', 'geo_regions', 'geo_cities', 'geo_sectors'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS membego_catalogo_lee ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS membego_catalogo_escribe ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY membego_catalogo_lee ON public.%I FOR SELECT TO membego_app USING (true)', t);
    EXECUTE format(
      'CREATE POLICY membego_catalogo_escribe ON public.%I FOR ALL TO membego_app '
      || 'USING (current_setting(''app.omnisciente'', true) = ''on'') '
      || 'WITH CHECK (current_setting(''app.omnisciente'', true) = ''on'')', t);
  END LOOP;
END $$;

-- ── 4. Verificación ─────────────────────────────────────────────────────────
--   -- Con el usuario u1 puesto, no debe verse una ubicación de u2.
--   set role membego_app;
--   set local app.user_id = 'u1';
--   select count(*) from customer_locations;   -- solo las de u1
--   reset role;
--
-- MARCHA ATRÁS:
--   do $$ declare t record; begin
--     for t in select tablename from pg_tables
--               where schemaname='public' and tablename in
--                 ('customer_locations','geo_consents','location_search_events',
--                  'saved_segments','campanas_dirigidas','campana_audiencia_snapshots',
--                  'campana_entregas','geo_countries','geo_regions','geo_cities','geo_sectors') loop
--       execute format('drop policy if exists membego_dueno on public.%I', t.tablename);
--       execute format('drop policy if exists membego_catalogo_lee on public.%I', t.tablename);
--       execute format('drop policy if exists membego_catalogo_escribe on public.%I', t.tablename);
--       execute format('drop policy if exists membego_inquilino on public.%I', t.tablename);
--     end loop;
--   end $$;
-- ============================================================================
