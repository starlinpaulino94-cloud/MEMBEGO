-- ============================================================================
-- RLS · CAPA 2 — verificación. SOLO LEE: no cambia nada.
-- ============================================================================
--
-- Para qué existe: el editor SQL de Supabase NO enseña los `RAISE NOTICE`. El
-- script de la Capa 2 termina diciendo «Success. No rows returned» y todo su
-- resumen —cuántas tablas encendió, cuáles quedaron sin política— se pierde.
-- Quien lo ejecuta se queda sin saber si funcionó.
--
-- Esto devuelve FILAS, que es lo único que ese editor enseña.
--
-- Lo que tiene que salir después de aplicar la Capa 2:
--
--   1  Rol membego_app                 OK: existe, NOBYPASSRLS, puede conectarse
--   2  Tablas con RLS encendido        OK: 137 de 137
--   3  Políticas membego_*             137
--   4  Tablas SIN RLS (deben ser 0)    ninguna ✔
--   5  Sin política (solo omnisciente) geo_cities, geo_countries, geo_regions,
--                                      geo_sectors, location_search_events
--
-- La fila 5 no es un fallo: son catálogos geográficos y búsquedas de ubicación,
-- sin datos de ninguna empresa concreta. Si ahí aparece una tabla CON datos de
-- una empresa, esa sí necesita política y hay que dársela a mano.
--
-- Comprobado que sabe detectar el estado malo, no solo decir OK: contra una
-- base con las 137 políticas y RLS apagado, la fila 2 dice
-- «MAL: 137 tablas sin RLS de 137» y la 4 las lista.
-- ============================================================================

SELECT * FROM (
  SELECT 1 AS orden, 'Rol membego_app' AS comprobacion,
         COALESCE((SELECT CASE WHEN rolbypassrls THEN 'MAL: tiene BYPASSRLS'
                               WHEN NOT rolcanlogin THEN 'MAL: no puede conectarse'
                               ELSE 'OK: existe, NOBYPASSRLS, puede conectarse' END
                     FROM pg_roles WHERE rolname = 'membego_app'),
                  'MAL: no existe') AS resultado
  UNION ALL
  SELECT 2, 'Tablas con RLS encendido',
         CASE WHEN sin_rls = 0 THEN 'OK: ' || con_rls || ' de ' || con_rls
              ELSE 'MAL: ' || sin_rls || ' tablas sin RLS de ' || (con_rls + sin_rls) END
    FROM (SELECT count(*) FILTER (WHERE c.relrowsecurity)     AS con_rls,
                 count(*) FILTER (WHERE NOT c.relrowsecurity) AS sin_rls
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND c.relname <> '_prisma_migrations') x
  UNION ALL
  SELECT 3, 'Políticas membego_*',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND policyname LIKE 'membego\_%')
  UNION ALL
  SELECT 4, 'Tablas SIN RLS (deben ser 0)',
         COALESCE((SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind = 'r'
                      AND c.relname <> '_prisma_migrations'
                      AND NOT c.relrowsecurity), 'ninguna ✔')
  UNION ALL
  SELECT 5, 'Sin política (solo omnisciente)',
         COALESCE((SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relkind = 'r'
                      AND c.relname <> '_prisma_migrations'
                      AND NOT EXISTS (SELECT 1 FROM pg_policies p
                                       WHERE p.schemaname = 'public'
                                         AND p.tablename = c.relname
                                         AND p.policyname LIKE 'membego\_%')), 'ninguna')
) t ORDER BY orden;
