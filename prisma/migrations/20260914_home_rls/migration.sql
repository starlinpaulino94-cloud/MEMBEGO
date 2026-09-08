BEGIN;

ALTER TABLE "home_revisiones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_revisiones" FORCE ROW LEVEL SECURITY;
ALTER TABLE "home_bloques" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_bloques" FORCE ROW LEVEL SECURITY;
ALTER TABLE "busqueda_sinonimos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "busqueda_sinonimos" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON "home_revisiones", "home_bloques", "busqueda_sinonimos" FROM PUBLIC;
DO $$
DECLARE rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE ALL ON home_revisiones, home_bloques, busqueda_sinonimos FROM %I', rol);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'membego_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "home_revisiones", "home_bloques", "busqueda_sinonimos" TO membego_app;
  END IF;
END $$;

CREATE POLICY membego_inquilino ON "home_revisiones" FOR ALL
USING (current_setting('app.omnisciente', true) = 'on' OR "companyId" = current_setting('app.company_id', true))
WITH CHECK (current_setting('app.omnisciente', true) = 'on' OR "companyId" = current_setting('app.company_id', true));

CREATE POLICY membego_inquilino ON "home_bloques" FOR ALL
USING (EXISTS (SELECT 1 FROM home_revisiones r WHERE r.id = "revisionId"))
WITH CHECK (EXISTS (SELECT 1 FROM home_revisiones r WHERE r.id = "revisionId"));

CREATE POLICY membego_inquilino ON "busqueda_sinonimos" FOR ALL
USING (current_setting('app.omnisciente', true) = 'on' OR "companyId" = current_setting('app.company_id', true))
WITH CHECK (current_setting('app.omnisciente', true) = 'on' OR "companyId" = current_setting('app.company_id', true));

CREATE UNIQUE INDEX "busqueda_sinonimos_global_idioma_termino_key"
ON "busqueda_sinonimos" ("idioma", "termino") WHERE "companyId" IS NULL;

COMMIT;
