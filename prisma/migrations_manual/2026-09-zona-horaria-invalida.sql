-- ─────────────────────────────────────────────────────────────────────────────
-- ZONA HORARIA INVÁLIDA · por qué Reportes deja de cargar entero.
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL FALLO
--
-- `companies.zonaHoraria` se escribe desde una caja de TEXTO LIBRE del perfil
-- de la empresa. `America/Santo_Domingo` era solo el marcador de posición: lo
-- que se guardaba era lo que alguien tecleara.
--
-- `Intl.DateTimeFormat` no tolera un valor que no reconozca — LANZA:
--
--     RangeError: Invalid time zone specified: GMT-4
--
-- Reportes es el único módulo que mete esa cadena directamente en `Intl` (para
-- cortar el día en la hora del negocio) y en un `AT TIME ZONE` de SQL. Los
-- demás formatean por `lib/format.ts`, que desde siempre degrada a la zona de
-- plataforma cuando la de la empresa no vale. Por eso el síntoma era «Reportes
-- no funciona» y no «el panel no funciona».
--
-- Resultado: «No se pudo cargar esta sección» y un código de error, en las
-- trece pantallas del módulo, en cada carga, para siempre — porque el valor
-- malo sigue en la fila.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ESTO SIGUE HACIENDO FALTA AUNQUE EL CÓDIGO YA ESTÉ ARREGLADO
--
-- El arreglo de código hace dos cosas: `zonaSegura` degrada al leer, así que
-- Reportes vuelve a abrir; y el perfil rechaza al guardar, así que no entran
-- valores nuevos. Ninguna de las dos CORRIGE la fila que ya está mal.
--
-- Mientras siga ahí, los reportes de esa empresa cortan el día en la zona de
-- plataforma en vez de en la suya. Si la empresa opera en otro huso, los
-- cobros de la noche caen en el día siguiente. Eso no se ve, y es peor que un
-- error que sí se ve.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CÓMO SE CORRE
--
-- El bloque 1 no cambia nada: enseña qué hay. Léelo, decide el valor bueno de
-- cada empresa, edita el bloque 2 y córrelo. El 3 confirma.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · Qué zona tiene cada empresa (no modifica nada) ──────────────────────
--
-- `valida` compara contra `pg_timezone_names`, el catálogo del propio
-- PostgreSQL. No es EXACTAMENTE el mismo conjunto que acepta el `Intl` de
-- Node —PostgreSQL admite además formas POSIX como `GMT-4`, que Node
-- rechaza—, así que esta columna señala lo que seguro está mal. Mira también
-- la columna `zonaHoraria` entera: cualquier cosa que no tenga la forma
-- `Region/Ciudad` es sospechosa aunque salga `true`.

SELECT c.id,
       c.slug,
       c.name,
       c."zonaHoraria",
       EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = c."zonaHoraria") AS valida,
       c."zonaHoraria" ~ '^[A-Za-z]+/[A-Za-z0-9_+-]+$' OR c."zonaHoraria" = 'UTC' AS forma_iana
  FROM "companies" c
 ORDER BY valida, c.name;

-- Resumen: los valores distintos que hay en la tabla, con cuántas empresas los
-- usan. En una base sana esto son dos o tres filas, todas con `valida = true`.
SELECT c."zonaHoraria",
       count(*) AS empresas,
       EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = c."zonaHoraria") AS valida
  FROM "companies" c
 GROUP BY 1
 ORDER BY valida, count(*) DESC;

-- ── 2 · La corrección ───────────────────────────────────────────────────────
--
-- EDITA la lista: una fila por empresa a corregir, con el `slug` que salió
-- arriba y la zona IANA buena. Ejemplos de la región:
--
--     America/Santo_Domingo   República Dominicana
--     America/Puerto_Rico     Puerto Rico
--     America/New_York        costa este de EE. UU.
--     America/Bogota          Colombia · Panamá (America/Panama)
--
-- El `WHERE` exige que la zona actual sea DISTINTA de la nueva: correrlo dos
-- veces no vuelve a escribir nada, y `updatedAt` no se mueve sin motivo.

UPDATE "companies" c
   SET "zonaHoraria" = v.zona,
       "updatedAt"   = now()
  FROM (VALUES
    -- ('slug-de-la-empresa', 'America/Santo_Domingo')
    ('PON-AQUI-EL-SLUG', 'America/Santo_Domingo')
  ) AS v(slug, zona)
 WHERE c.slug = v.slug
   AND c."zonaHoraria" IS DISTINCT FROM v.zona
   AND EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = v.zona);

-- ── 3 · Confirmar ───────────────────────────────────────────────────────────
-- Todas las filas tienen que salir con `valida = true`.

SELECT c.slug,
       c.name,
       c."zonaHoraria",
       EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = c."zonaHoraria") AS valida
  FROM "companies" c
 ORDER BY valida, c.name;
