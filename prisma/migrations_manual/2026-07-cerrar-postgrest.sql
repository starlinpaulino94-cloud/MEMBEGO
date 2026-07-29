-- ============================================================================
-- CERRAR EL ACCESO DIRECTO A LAS TABLAS POR LA API DE SUPABASE
-- (auditoría de producción · A-01, RECLASIFICADO A CRÍTICO)
--
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- ANTES DE APLICAR, LEE "COMPROBACIÓN PREVIA" ABAJO.
-- ============================================================================
--
-- EL PROBLEMA
--
-- Supabase expone automáticamente por PostgREST todas las tablas del esquema
-- `public`, y sus privilegios por defecto conceden acceso a los roles `anon` y
-- `authenticated`. Las tablas de MembeGo las creó Prisma en `public` y NINGUNA
-- migración tocó nunca esos privilegios ni activó RLS.
--
-- La clave anónima viaja en el navegador: es pública por diseño. Si los
-- privilegios por defecto están puestos, cualquiera con esa clave puede leer
-- las tablas ENTERAS por la API REST, saltándose la aplicación, los guards y
-- todo el filtrado por `companyId`:
--
--     curl 'https://<proyecto>.supabase.co/rest/v1/clientes?select=*' \
--          -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>"
--
-- Eso son todos los clientes de todas las empresas: nombres, correos,
-- teléfonos. Y lo mismo con `memberships`, `transactions`, `visits`.
--
-- El aislamiento multiempresa de la aplicación es correcto, pero solo protege
-- lo que pasa POR la aplicación. Este camino no pasa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- COMPROBACIÓN PREVIA — hazla ANTES de aplicar nada
--
-- 1) Ejecuta el `curl` de arriba con tu clave anónima real.
--      · Si devuelve datos  → estabas expuesto. Aplica esto YA.
--      · Si devuelve 401 o una lista vacía → ya estabas protegido y esto solo
--        añade la segunda barrera. Aplícalo igual.
--
-- 2) Comprueba con qué rol se conecta Prisma:
--        SELECT current_user, rolsuper, rolbypassrls
--          FROM pg_roles WHERE rolname = current_user;
--    Debe ser el DUEÑO de las tablas (normalmente `postgres`). El dueño se
--    salta RLS mientras no se use FORCE ROW LEVEL SECURITY, así que la
--    aplicación sigue funcionando igual. Si tu DATABASE_URL usara un rol
--    distinto y sin privilegios, activar RLS SÍ rompería las escrituras: en ese
--    caso para aquí y revísalo primero.
--
-- POR QUÉ ES SEGURO PARA LA APLICACIÓN: el navegador de MembeGo nunca consulta
-- tablas por PostgREST. Solo usa Supabase para Auth y Storage, que viven en los
-- esquemas `auth` y `storage` y no se tocan aquí. Todo el acceso a datos pasa
-- por Prisma en el servidor.
-- ────────────────────────────────────────────────────────────────────────────

-- 1) Quitar los privilegios de los roles públicos sobre el esquema `public` ---
--    Esto por sí solo ya cierra PostgREST: sin privilegios no hay lectura.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke usage on schema public from anon, authenticated;

-- 2) Que las tablas FUTURAS nazcan cerradas -----------------------------------
--    Sin esto, la próxima migración de Prisma crea una tabla que vuelve a
--    heredar los privilegios por defecto y el agujero reaparece. Este es el
--    paso que se olvida.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 3) RLS como SEGUNDA barrera, sin políticas ---------------------------------
--    Los privilegios son la primera puerta; RLS es la segunda. Si alguien
--    vuelve a conceder privilegios por error (un `grant all` de rutina),
--    RLS sin políticas sigue denegando a todo el que no sea el dueño.
--
--    NO se usa FORCE: el dueño (Prisma) tiene que seguir pasando.
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename not like '\_prisma%'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ── Verificación ────────────────────────────────────────────────────────────
-- (a) Debe devolver 0 filas: ninguna tabla concede nada a los roles públicos.
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated');

-- (b) Debe devolver 0 filas: ninguna tabla se quedó sin RLS.
select tablename
  from pg_tables
 where schemaname = 'public'
   and tablename not like '\_prisma%'
   and not rowsecurity;

-- (c) Y repite el `curl` de arriba: ahora tiene que fallar.
