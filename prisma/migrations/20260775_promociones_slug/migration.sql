-- Promociones · SLUG PÚBLICO (Fase 4)
--
-- Qué hace:
--   1. Rellena `slug` en las promociones que no lo tienen, a partir del título.
--   2. Resuelve los títulos repetidos dentro de una misma empresa con -2, -3…
--   3. Crea el índice único (companyId, slug) para que dos promociones de la
--      misma empresa no puedan compartir dirección pública.
--
-- Es IDEMPOTENTE: se puede correr varias veces sin romper nada. No toca los
-- slugs que ya existan — un enlace ya compartido por WhatsApp debe seguir
-- funcionando.
--
-- Los enlaces viejos con id siguen sirviendo: la aplicación resuelve por slug
-- O por id, y redirige del id al slug cuando la promoción ya tiene uno.

-- Paso 1 · slug base a partir del título, sin acentos ni símbolos.
WITH base AS (
  SELECT
    id,
    "companyId",
    NULLIF(
      trim(
        BOTH '-' FROM
        regexp_replace(
          lower(
            translate(
              titulo,
              'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
              'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
            )
          ),
          '[^a-z0-9]+', '-', 'g'
        )
      ),
      ''
    ) AS slug_base
  FROM promociones
  WHERE slug IS NULL OR slug = ''
),
-- Paso 2 · numerar las repeticiones dentro de cada empresa, contando también
-- las promociones que YA tienen ese slug (para no chocar con ellas).
numerado AS (
  SELECT
    b.id,
    b."companyId",
    COALESCE(left(b.slug_base, 60), 'promocion') AS slug_base,
    ROW_NUMBER() OVER (
      PARTITION BY b."companyId", COALESCE(left(b.slug_base, 60), 'promocion')
      ORDER BY b.id
    )
    + COALESCE(
        (SELECT count(*) FROM promociones p2
          WHERE p2."companyId" = b."companyId"
            AND p2.slug IS NOT NULL
            AND (p2.slug = COALESCE(left(b.slug_base, 60), 'promocion')
                 OR p2.slug LIKE COALESCE(left(b.slug_base, 60), 'promocion') || '-%')),
        0
      ) AS n
  FROM base b
)
UPDATE promociones p
SET slug = CASE
  WHEN n.n <= 1 THEN n.slug_base
  ELSE left(n.slug_base, 60 - length('-' || n.n::text)) || '-' || n.n::text
END
FROM numerado n
WHERE p.id = n.id;

-- Paso 3 · Red de seguridad: si algún título imposible dejó el slug vacío, se
-- usa el id. Feo, pero una promoción sin dirección pública no se puede abrir.
UPDATE promociones SET slug = id WHERE slug IS NULL OR slug = '';

-- Paso 4 · Unicidad por empresa. Dos empresas SÍ pueden tener
-- «lavado-premium»; la misma empresa, no.
CREATE UNIQUE INDEX IF NOT EXISTS "promociones_companyId_slug_key"
  ON promociones ("companyId", slug);

-- Comprobación (opcional, para leer el resultado):
--   SELECT count(*) FILTER (WHERE slug IS NULL) AS sin_slug,
--          count(*) AS total
--   FROM promociones;
