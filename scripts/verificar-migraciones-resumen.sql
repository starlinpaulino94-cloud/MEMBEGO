-- ¿Están aplicadas TODAS las migraciones de prisma/migrations? (versión corta)
-- Generado desde main (2f57b6ac): 209 migraciones, última 20261052_supply_v2_derechos_por_linea.
-- Pégalo entero en el SQL Editor de Supabase. Solo lee. Devuelve UNA fila.
--   veredicto = 'OK' → no falta ninguna y coinciden nombre y contenido.
--   Si no, el detalle de qué falta lo da scripts/verificar-migraciones.sql
--   (ejecutado con psql -f, no pegado: son 257 líneas).
WITH base AS (
  SELECT migration_name AS n, checksum AS c
  FROM _prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
), esperado AS (
  SELECT 209 AS total, '20261052_supply_v2_derechos_por_linea' AS ultima,
         '48a5ceac0eace81bc08e22b9293808b7' AS nombres,
         '5427c70ba94146964885263e26b7544b' AS checksums
), real AS (
  SELECT count(*) AS aplicadas,
         max(n COLLATE "C") AS ultima,
         md5(string_agg(n, ',' ORDER BY n COLLATE "C")) AS nombres,
         md5(string_agg(n || ':' || c, ',' ORDER BY n COLLATE "C")) AS checksums,
         (SELECT count(*) FROM _prisma_migrations
          WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS incompletas
  FROM base
)
SELECT r.aplicadas, e.total AS esperadas, r.ultima AS ultima_aplicada, e.ultima AS ultima_del_repo,
       r.nombres = e.nombres AS nombres_ok, r.checksums = e.checksums AS checksums_ok, r.incompletas,
       CASE WHEN r.nombres = e.nombres AND r.checksums = e.checksums AND r.incompletas = 0 THEN 'OK'
            WHEN r.incompletas > 0 THEN 'REVISAR: hay migraciones a medias o revertidas'
            WHEN r.aplicadas < e.total THEN 'REVISAR: faltan ' || (e.total - r.aplicadas) || ' migración(es)'
            WHEN r.nombres <> e.nombres THEN 'REVISAR: hay migraciones distintas a las del repo'
            ELSE 'REVISAR: algún migration.sql aplicado difiere del repo' END AS veredicto
FROM real r, esperado e;
