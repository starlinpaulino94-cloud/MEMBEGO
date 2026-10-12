-- ¿Están aplicadas TODAS las migraciones de prisma/migrations? (versión corta)
-- Generado con scripts/generar-verificar-migraciones.mjs en 9f2f8d82: 211 migraciones, última 20261054_growth_campaign_deal.
-- Pégalo entero en el SQL Editor de Supabase. Solo lee. Devuelve UNA fila.
--   veredicto = 'OK' → no falta ninguna y coinciden nombre y contenido.
--   Si no, el detalle de qué falta lo da scripts/verificar-migraciones.sql
--   (ejecutado con psql -f, no pegado: es largo).
-- Si el repo cambió, regenera con: node scripts/generar-verificar-migraciones.mjs
WITH base AS (
  SELECT migration_name AS n, checksum AS c
  FROM _prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
), esperado AS (
  SELECT 211 AS total, '20261054_growth_campaign_deal' AS ultima,
         '10dbe5567ef29b532a326aafd0deddc0' AS nombres,
         'e5ade3b9837cf7f52e5d3b848281c25f' AS checksums
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
            WHEN r.aplicadas > e.total THEN 'REVISAR: la base tiene ' || (r.aplicadas - e.total) || ' migración(es) que el repo no tiene'
            WHEN r.nombres <> e.nombres THEN 'REVISAR: hay migraciones distintas a las del repo'
            ELSE 'REVISAR: algún migration.sql aplicado difiere del repo' END AS veredicto
FROM real r, esperado e;
