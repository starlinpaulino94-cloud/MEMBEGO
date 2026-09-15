-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO · ¿qué está aplicado de verdad y qué está registrado?
--
-- No ejecuta nada ni cambia nada. Solo responde la pregunta que hay que
-- responder ANTES de tocar la base: el error «type already exists» significa
-- que la migración YA CORRIÓ y que lo que falta es anotarla, no repetirla.
--
-- Va entero, de una vez, en el SQL Editor de Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  m.nombre,
  -- ¿Existe en la base lo que esa migración crea?
  CASE
    WHEN m.aplicada THEN 'SI - ya está en la base'
    WHEN m.indeterminable THEN 'NO SE PUEDE SABER - ver la nota'
    ELSE 'NO'
  END AS aplicada_de_verdad,
  -- ¿Lo sabe Prisma?
  CASE
    WHEN p.finished_at IS NOT NULL THEN 'SI - registrada y terminada'
    WHEN p.migration_name IS NOT NULL THEN 'A MEDIAS - registrada sin terminar'
    ELSE 'NO - Prisma no la conoce'
  END AS registrada,
  CASE
    WHEN p.finished_at IS NOT NULL       THEN 'nada que hacer'
    WHEN m.aplicada                      THEN '>> REGISTRAR (no reejecutar)'
    WHEN m.indeterminable                THEN '>> EJECUTAR su migration.sql y despues REGISTRAR'
    WHEN p.migration_name IS NULL        THEN '>> EJECUTAR su migration.sql'
    ELSE '>> REVISAR A MANO: registrada pero no está en la base'
  END AS que_hacer,
  m.nota
FROM (
  VALUES
    ('20260916_plan_imagen',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'plans' AND column_name = 'imagenUrl'),
     false,
     'Anade plans."imagenUrl"'),
    ('20260917_membresia_eventos',
     EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MembresiaEventoTipo')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'membresia_eventos'),
     false,
     'Crea los enums y la tabla membresia_eventos. Si dio "type already exists", es esta'),
    -- ESTA NO SE PUEDE DIAGNOSTICAR MIRANDO LA BASE, y conviene decirlo en vez
    -- de fingir una respuesta: solo INSERTA filas, así que una base sin eventos
    -- reconstruidos puede ser una migración que no corrió O una que corrió y no
    -- encontró nada que reconstruir. Las dos se ven igual.
    --
    -- No importa: sus tres INSERT son idempotentes —no duplican si se repiten—,
    -- así que ante la duda se ejecuta y luego se registra.
    ('20260918_membresia_eventos_backfill',
     EXISTS (SELECT 1 FROM membresia_eventos WHERE reconstruido = true),
     NOT EXISTS (SELECT 1 FROM membresia_eventos WHERE reconstruido = true),
     'Solo INSERTA: sin filas reconstruidas no se distingue "no corrio" de "corrio y no habia nada". Sus INSERT son idempotentes, asi que ejecutala igual'),
    ('20260919_visitas_company_id',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'visits' AND column_name = 'companyId'),
     false,
     'Anade visits."companyId" y dos indices')
) AS m(nombre, aplicada, indeterminable, nota)
LEFT JOIN "_prisma_migrations" p ON p.migration_name = m.nombre
ORDER BY m.nombre;

-- Y el panorama: cuántas hay registradas en total. El repo tiene 143.
SELECT count(*) AS registradas,
       count(*) FILTER (WHERE finished_at IS NULL) AS sin_terminar,
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS revertidas
  FROM "_prisma_migrations";
