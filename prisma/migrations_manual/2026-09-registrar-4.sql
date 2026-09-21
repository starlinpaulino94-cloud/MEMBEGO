-- ─────────────────────────────────────────────────────────────────────────────
-- REGISTRAR LAS MIGRACIONES QUE YA SE APLICARON A MANO
--
-- QUÉ PROBLEMA RESUELVE
--
-- Cuando el SQL de una migración se ejecuta a mano en el editor de Supabase, la
-- base queda bien pero `_prisma_migrations` no se entera. A partir de ahí Prisma
-- cree que esa migración está pendiente y, al intentarla, choca contra lo que ya
-- existe: `ERROR: 42710: type "MembresiaEventoTipo" already exists`.
--
-- La solución NO es reejecutar el SQL —ya está aplicado— ni borrar los objetos.
-- Es anotar en el registro lo que de verdad pasó.
--
-- ⚠ EJECUTA PRIMERO `2026-09-diagnostico-registro.sql`. Registrar una migración
--   que en realidad NO se aplicó es peor que el problema original: Prisma la
--   daría por hecha y nunca la correría, y faltaría para siempre una tabla o una
--   columna que nadie sabría que falta. Solo registra las que el diagnóstico
--   marque «>> REGISTRAR».
--
-- DE DÓNDE SALEN LOS `checksum`
--
-- Prisma guarda el SHA-256 del archivo `migration.sql`, tal cual, sin
-- normalizar. Se comprobó empíricamente antes de escribir esto. Las sumas de
-- abajo son las de los archivos de esta rama —las mismas que sella
-- `prisma/migrations/SUMAS.txt`—, así que si el archivo cambiara habría que
-- rehacerlas.
--
-- ES IDEMPOTENTE: el `WHERE NOT EXISTS` deja la fila que ya esté como está, así
-- que ejecutarlo dos veces no duplica nada.
--
-- Va entero, de una vez, en el SQL Editor de Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT
  gen_random_uuid()::text,
  v.checksum,
  now(),
  v.nombre,
  'Aplicada a mano en el editor SQL y registrada despues (ver prisma/migrations_manual/2026-09-registrar-4.sql)',
  NULL,
  now(),
  1
FROM (
  VALUES
    ('20260916_plan_imagen',                 'd1cafde252998bf40673662b2c1440318ca25e23a4ad45b9e097b679384494c9'),
    ('20260917_membresia_eventos',           '6528d5aeaa5d6406cb42105d778e1141b340c82b54371d8f3e1ab803e927ec47'),
    ('20260918_membresia_eventos_backfill',  '5b725af0e45088a4bd4826740f894c2632402b9afae715022587c0389e9a6b64'),
    ('20260919_visitas_company_id',          '61e912ca8cf01b723dd7a8f8ef4931da2bef058ab824a8d7bedc06fc74abd62c')
) AS v(nombre, checksum)
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" p WHERE p.migration_name = v.nombre
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- `registradas` tiene que dar 143, que son las que hay en el repo, y las otras
-- dos columnas 0. Con eso, el siguiente `migrate deploy` no tiene nada que
-- hacer y deja de fallar.
SELECT count(*) AS registradas,
       count(*) FILTER (WHERE finished_at IS NULL) AS sin_terminar,
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS revertidas
  FROM "_prisma_migrations";
