-- ============================================================================
-- RLS · CAPA 1 — cerrar la puerta de PostgREST   (auditoría de producción · A-01)
-- ============================================================================
--
-- QUÉ PROBLEMA RESUELVE, Y POR QUÉ ES MÁS GRAVE DE LO QUE DECÍA LA AUDITORÍA
--
-- La auditoría clasificó A-01 como "aislamiento multi-empresa 100 % aplicativo":
-- el riesgo sería que un `where companyId` olvidado en una consulta nueva
-- filtrara datos entre empresas. Eso es cierto, y lo aborda la Capa 2.
--
-- Pero al medirlo apareció algo peor. Supabase, en cada proyecto, hace esto
-- por defecto:
--
--     grant all on all tables in schema public to anon, authenticated;
--     alter default privileges in schema public
--       grant all on tables to anon, authenticated;
--
-- Y expone PostgREST en `https://<proyecto>.supabase.co/rest/v1/`. El rol que
-- usa esa API para un visitante sin sesión es `anon`, cuya clave
-- (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) **viaja dentro del bundle del navegador**:
-- es pública por diseño.
--
-- Sumado: sin RLS, cualquiera que abra la web, copie esa clave del código
-- fuente y haga
--
--     curl 'https://<proyecto>.supabase.co/rest/v1/clientes?select=*' \
--          -H "apikey: <la clave que está en el HTML>"
--
-- se descarga la tabla `clientes` entera. Y `memberships`, y `transactions`, y
-- `comprobantes`. De todas las empresas. Sin explotar nada: usando la API tal
-- como está documentada.
--
-- Se reprodujo en un PostgreSQL 16 local con los roles y los grants por
-- defecto de Supabase, con dos empresas sembradas. `set role anon; select *
-- from clientes;` devolvió las dos filas, de las dos empresas.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ SE PUEDE CERRAR SIN ROMPER NADA
--
-- Porque MembeGo **no usa PostgREST**. Todos los datos van por Prisma con una
-- conexión de servidor. Se comprobó: no hay una sola llamada `.from('<tabla>')`
-- ni `.rpc(` en `src/`. Las únicas llamadas `.from(...)` que existen son
-- `supabase.storage.from('avatars' | 'logos' | 'comprobantes')`, que van al
-- esquema `storage`, no a `public`.
--
-- Es decir: `anon` y `authenticated` tienen permiso sobre `public` y no lo usan
-- para nada. Quitárselo no cambia ni una pantalla.
--
-- Auth (`auth.users`) y Storage (`storage.objects`) viven en OTROS esquemas y
-- no los toca esta migración. Iniciar sesión, registrarse y subir archivos
-- siguen funcionando igual.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUÉ HACE, EN ORDEN
--
--   0. ABORTA si el rol que migra no puede saltarse RLS. Ver la nota larga.
--   1. `ENABLE ROW LEVEL SECURITY` en todas las tablas de `public`.
--      Sin políticas, RLS deniega por defecto. La ausencia ES la política,
--      igual que en el bucket de comprobantes.
--   2. Retira los privilegios de `anon` y `authenticated` sobre `public`.
--   3. Corrige los privilegios POR DEFECTO, para que las tablas que cree la
--      próxima migración no nazcan otra vez abiertas.
--
-- `service_role` NO se toca: se salta RLS por atributo, su clave es solo de
-- servidor y nunca sale al navegador. Es la que firma las subidas de Storage.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ============================================================================


-- ── 0. Guarda de seguridad ──────────────────────────────────────────────────
--
-- Activar RLS sin políticas deniega a TODO rol que no se la salte. Si la
-- aplicación se conectara con un rol normal, esta migración la dejaría sin
-- acceso a su propia base: una caída total.
--
-- En Supabase el rol `postgres` —el de `DATABASE_URL` y `DIRECT_URL` de
-- MembeGo— tiene el atributo BYPASSRLS, así que no le afecta. Esta guarda lo
-- comprueba en vez de darlo por hecho, y para la migración si no se cumple.
--
-- OJO con el caso que esta guarda NO puede ver: comprueba el rol que MIGRA. Si
-- algún día el rol de la aplicación fuera distinto del rol que migra, hay que
-- comprobarlo aparte. La consulta está al final del archivo.
DO $$
DECLARE
  puede boolean;
BEGIN
  SELECT rolbypassrls OR rolsuper INTO puede
    FROM pg_roles WHERE rolname = current_user;

  IF NOT COALESCE(puede, false) THEN
    RAISE EXCEPTION
      'RLS abortado: el rol "%" no tiene BYPASSRLS ni es superusuario. '
      'Activar RLS ahora dejaría a la aplicación sin acceso a sus propias '
      'tablas. Migra con el rol `postgres` de Supabase (DIRECT_URL, puerto '
      '5432). Ver docs/RLS.md.', current_user;
  END IF;
END $$;


-- ── 1. RLS activado en todas las tablas de `public` ─────────────────────────
--
-- Se recorre `pg_tables` en vez de escribir 112 líneas: así las tablas que se
-- añadan en el futuro quedan cubiertas con solo volver a correr esto, y no hay
-- una lista que se desincronice en silencio.
--
-- Se excluye `_prisma_migrations`: es la tabla de control del propio Prisma y
-- ningún rol de la API tiene por qué verla, pero tampoco conviene que RLS se
-- meta en el camino de `migrate deploy`.
DO $$
DECLARE
  t record;
  n integer := 0;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> '_prisma_migrations'
     ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS activado en % tablas de public.', n;
END $$;


-- ── 2. `anon` y `authenticated` pierden el acceso a `public` ────────────────
--
-- Los roles se comprueban antes de nombrarlos: en la base sombra del CI y en
-- cualquier PostgreSQL que no sea Supabase no existen, y sin esta guarda la
-- migración fallaría ahí.
--
-- REVOKE es lo que de verdad cierra la puerta: PostgREST responde "permission
-- denied for table" antes siquiera de evaluar RLS. El paso 1 es la red de
-- seguridad por si alguien vuelve a conceder privilegios sin darse cuenta.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- `usage` sobre el esquema se queda: quitarlo rompe mensajes de error de
      -- PostgREST y no aporta nada una vez retirados los privilegios de tabla.
      RAISE NOTICE 'Privilegios de % sobre public retirados.', r;
    ELSE
      RAISE NOTICE 'El rol % no existe aquí (normal fuera de Supabase).', r;
    END IF;
  END LOOP;
END $$;


-- ── 3. Que las tablas nuevas no nazcan abiertas ─────────────────────────────
--
-- Sin esto, la próxima migración que haga `CREATE TABLE` recibiría otra vez
-- `GRANT ALL ... TO anon` por los privilegios por defecto de Supabase, y el
-- agujero volvería solo, en silencio, meses después.
--
-- Los privilegios por defecto van atados al rol que CREA los objetos. Se
-- corrigen para `postgres` (el que usa Prisma) y para el rol actual, por si no
-- coinciden. Va envuelto en un manejador de excepciones porque `ALTER DEFAULT
-- PRIVILEGES FOR ROLE otro` exige ser miembro de ese rol, y preferimos un
-- aviso a una migración caída.
DO $$
DECLARE
  creador text;
  destino text;
BEGIN
  FOREACH creador IN ARRAY ARRAY['postgres', current_user] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = creador) THEN CONTINUE; END IF;
    FOREACH destino IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = destino) THEN CONTINUE; END IF;
      BEGIN
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
          creador, destino);
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
          creador, destino);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING
          'No se pudieron ajustar los privilegios por defecto de % para %. '
          'Córrelo a mano como ese rol o las tablas futuras nacerán abiertas.',
          creador, destino;
      END;
    END LOOP;
  END LOOP;
END $$;


-- ============================================================================
-- VERIFICACIÓN — pégala en el SQL Editor después de desplegar.
--
--   -- (a) Debe dar 0. Es la consulta que importa.
--   select count(*) as tablas_alcanzables_por_anon
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee in ('anon','authenticated');
--
--   -- (b) Debe dar 0: ninguna tabla de public sin RLS.
--   select count(*) as tablas_sin_rls
--     from pg_tables t join pg_class c on c.relname = t.tablename
--    where t.schemaname = 'public' and t.tablename <> '_prisma_migrations'
--      and c.relnamespace = 'public'::regnamespace and not c.relrowsecurity;
--
--   -- (c) El rol de la APLICACIÓN debe salir con bypass = true. Si sale false,
--   --     la app no puede leer sus tablas: revierte con el bloque de abajo.
--   select rolname, rolbypassrls or rolsuper as bypass
--     from pg_roles where rolname in ('postgres','service_role');
--
-- ────────────────────────────────────────────────────────────────────────────
-- MARCHA ATRÁS (si algo se rompiera). Deja la base como estaba:
--
--   do $$ declare t record; begin
--     for t in select tablename from pg_tables where schemaname='public' loop
--       execute format('alter table public.%I disable row level security', t.tablename);
--     end loop;
--   end $$;
--   grant all on all tables in schema public to anon, authenticated;
--
-- Devolver el acceso a `anon` reabre el agujero: es marcha atrás de urgencia,
-- no una configuración con la que quedarse.
-- ============================================================================
