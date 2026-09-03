-- BUSCAR SIN ACENTOS · clientes, empleados y vendedores.
--
-- EL PROBLEMA
--
-- `ILIKE` ignora mayúsculas pero no acentos: para PostgreSQL «José» y «Jose»
-- son palabras distintas. Quien buscaba «jose» no encontraba a José Manuel
-- López, y no había nada en pantalla que explicara por qué.
--
-- POR QUÉ UNA COLUMNA Y NO UN ÍNDICE DE EXPRESIÓN
--
-- Un índice sobre `unaccent(nombre)` obliga a escribir la búsqueda en SQL
-- crudo, y en este proyecto todas las consultas pasan por Prisma dentro de
-- `conEmpresa()` — que es lo que garantiza el aislamiento por empresa. Sacar
-- 95 buscadores de ahí para ganar acentos sería cambiar una molestia por un
-- riesgo. Con una columna normal, Prisma la consulta como cualquier otra y el
-- aislamiento no se toca.
--
-- POR QUÉ UN DISPARADOR Y NO CÓDIGO DE APLICACIÓN
--
-- El nombre se escribe desde el alta del cliente, el panel, la importación,
-- la API de plataforma y el registro público. Encomendar a los cinco que se
-- acuerden de actualizar la copia es garantizar que uno se olvide, y el fallo
-- sería invisible: el cliente simplemente deja de aparecer. El disparador no
-- se puede olvidar.
--
-- Todo es ADITIVO: columnas nuevas que admiten NULL, nada se borra ni cambia
-- de tipo. Revertirlo es soltar las columnas.

-- ── 1. Extensiones ──────────────────────────────────────────────────────────
-- `unaccent` quita los acentos. `pg_trgm` es lo que hace que una búsqueda
-- «contiene» (con comodín por delante) pueda usar índice; sin él, PostgreSQL
-- recorre la tabla entera en cada tecla.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. Envoltura inmutable ──────────────────────────────────────────────────
-- `unaccent()` se declara STABLE porque su diccionario puede recargarse, y
-- PostgreSQL no permite indexar ni generar columnas con funciones que no sean
-- IMMUTABLE. Fijar el diccionario por nombre la vuelve determinista, que es la
-- forma estándar de resolverlo.
CREATE OR REPLACE FUNCTION public.membego_normalizar(texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(lower(public.unaccent('public.unaccent', COALESCE(texto, ''))))
$$;

-- ── 3. Las columnas ─────────────────────────────────────────────────────────
-- Las tablas se llaman en plural y en minúsculas porque los modelos llevan
-- `@@map`: el nombre del modelo en Prisma no es el nombre en la base.
ALTER TABLE clientes  ADD COLUMN IF NOT EXISTS "nombreBusqueda" text;
ALTER TABLE users     ADD COLUMN IF NOT EXISTS "nombreBusqueda" text;
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS "nombreBusqueda" text;

-- ── 4. Quien las mantiene ───────────────────────────────────────────────────
-- Una función por nombre de campo: Cliente y Vendedor guardan «nombre», User
-- guarda «name».
CREATE OR REPLACE FUNCTION public.membego_sync_nombre_busqueda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."nombreBusqueda" := public.membego_normalizar(NEW."nombre");
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.membego_sync_name_busqueda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."nombreBusqueda" := public.membego_normalizar(NEW."name");
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clientes_nombre_busqueda ON clientes;
CREATE TRIGGER clientes_nombre_busqueda
  BEFORE INSERT OR UPDATE OF "nombre" ON clientes
  FOR EACH ROW EXECUTE FUNCTION public.membego_sync_nombre_busqueda();

DROP TRIGGER IF EXISTS vendedores_nombre_busqueda ON vendedores;
CREATE TRIGGER vendedores_nombre_busqueda
  BEFORE INSERT OR UPDATE OF "nombre" ON vendedores
  FOR EACH ROW EXECUTE FUNCTION public.membego_sync_nombre_busqueda();

DROP TRIGGER IF EXISTS users_nombre_busqueda ON users;
CREATE TRIGGER users_nombre_busqueda
  BEFORE INSERT OR UPDATE OF "name" ON users
  FOR EACH ROW EXECUTE FUNCTION public.membego_sync_name_busqueda();

-- ── 5. Las filas que ya existen ─────────────────────────────────────────────
-- Sin esto, la búsqueda solo encontraría a quien se registre de hoy en
-- adelante — que es peor que no hacer nada, porque parecería funcionar.
UPDATE clientes  SET "nombreBusqueda" = public.membego_normalizar("nombre") WHERE "nombreBusqueda" IS NULL;
UPDATE vendedores SET "nombreBusqueda" = public.membego_normalizar("nombre") WHERE "nombreBusqueda" IS NULL;
UPDATE users     SET "nombreBusqueda" = public.membego_normalizar("name")   WHERE "nombreBusqueda" IS NULL;

-- ── 6. Los índices ──────────────────────────────────────────────────────────
-- GIN con trigramas: es el que sirve para `LIKE '%texto%'`. Un btree normal no
-- se usaría, porque el comodín va delante.
--
-- Sin CONCURRENTLY a propósito: CONCURRENTLY no puede correr dentro de una
-- transacción, y el editor SQL de Supabase envuelve todo en una. Se creó ese
-- problema una vez y no se repite: estas tres tablas se bloquean unos
-- segundos durante la creación, que es asumible.
CREATE INDEX IF NOT EXISTS clientes_nombre_busqueda_trgm  ON clientes  USING gin ("nombreBusqueda" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vendedores_nombre_busqueda_trgm ON vendedores USING gin ("nombreBusqueda" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_nombre_busqueda_trgm     ON users     USING gin ("nombreBusqueda" gin_trgm_ops);
