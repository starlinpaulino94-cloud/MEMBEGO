-- ============================================================================
-- ESTADO DE SEGURIDAD — informe de SOLO LECTURA
-- Pegar entero en el SQL Editor de Supabase. No modifica nada.
-- ============================================================================
--
-- PARA QUÉ
--
-- En este proyecto las migraciones de seguridad se aplican A MANO. Que un
-- archivo exista en `prisma/migrations_manual/` no dice NADA sobre si alguien
-- lo ejecutó: son dos cosas distintas y se confunden constantemente. La
-- auditoría de agosto de 2026 dio por abiertos cuatro hallazgos que el
-- repositorio ya tenía escritos —y no había forma de saber, sin mirar la base,
-- cuáles estaban de verdad puestos.
--
-- Esto responde a esa pregunta y solo a esa. Cada fila dice OK o REVISAR.
--
-- Lo que NO cubre: el desfase de esquema (tablas y columnas). Para eso ya está
-- `npm run db:doctor:sql`, que emite su propio SQL para pegar aquí.
-- ============================================================================

with

-- ── C-01 · ¿Sigue PostgREST alcanzando las tablas de la aplicación? ─────────
-- La clave anónima viaja dentro del bundle del navegador. Si `anon` o
-- `authenticated` conservan permisos sobre `public`, cualquiera se descarga
-- las tablas con un curl. Lo cierra 20260771_rls_barrera_publica.
grants_publicos as (
  select count(distinct table_name) as n
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
),

-- ── C-02 · ¿Cuántas tablas de public siguen sin RLS? ────────────────────────
-- Con la Capa 1 puesta esto es defensa en profundidad; con la Capa 2 puesta
-- es LA defensa. Debe ser 0.
tablas_sin_rls as (
  select count(*) as n
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relkind  = 'r'
     and c.relname <> '_prisma_migrations'
     and not c.relrowsecurity
),

-- ── C-02b · ¿Está encendida la Capa 2 (rol de aplicación sin BYPASSRLS)? ────
-- Si `membego_app` no existe, la Capa 2 no se ha montado y la aplicación
-- sigue conectándose como `postgres`, que se salta RLS por completo.
rol_app as (
  select count(*) as n
    from pg_roles
   where rolname = 'membego_app'
     and not rolbypassrls
),

-- ── C-04a · ¿El bucket de comprobantes es privado? ──────────────────────────
-- Público = cualquiera con la URL ve el comprobante bancario de un cliente.
-- Lo cierra 2026-07-comprobantes-privado.sql.
comprobantes_publico as (
  select count(*) as n
    from storage.buckets
   where id = 'comprobantes'
     and public
),

-- ── C-04b · ¿Queda alguna política tocando comprobantes? ────────────────────
-- Debe ser 0: la ausencia de política ES la política. Solo pasa service_role.
politicas_comprobantes as (
  select count(*) as n
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and coalesce(qual::text, '') || coalesce(with_check::text, '') like '%comprobantes%'
),

-- ── C-04c · ¿Las políticas de escritura de avatars/logos miran al dueño? ────
-- Las tres (insert/update/delete) deben invocar membego_ruta_propia. Si el
-- número es menor que 3, quedó la versión que solo miraba el bucket y
-- cualquier usuario autenticado puede borrar el logo de cualquier empresa.
-- Lo pone 2026-08-storage-ownership.sql.
politicas_con_dueno as (
  select count(*) as n
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE')
     and coalesce(qual::text, '') || coalesce(with_check::text, '')
         like '%membego_ruta_propia%'
),

-- ── C-04d · ¿Existe la función de propiedad? ────────────────────────────────
funcion_dueno as (
  select count(*) as n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname  = 'membego_ruta_propia'
)

select * from (
  select 1 as orden,
         'C-01  PostgREST: tablas de public alcanzables por anon/authenticated' as comprobacion,
         n::text as valor,
         case when n = 0 then 'OK' else 'REVISAR — aplicar 20260771_rls_barrera_publica' end as estado
    from grants_publicos

  union all
  select 2,
         'C-02  Tablas de public sin RLS',
         n::text,
         case when n = 0 then 'OK' else 'REVISAR — aplicar 2026-07-rls-capa2-aislamiento.sql' end
    from tablas_sin_rls

  union all
  select 3,
         'C-02b Capa 2 encendida (rol membego_app, NOBYPASSRLS)',
         case when n > 0 then 'si' else 'no' end,
         case when n > 0 then 'OK'
              else 'REVISAR — capa 2 montada pero apagada; el gate npm run rls:cobertura ya sale limpio' end
    from rol_app

  union all
  select 4,
         'C-04a Bucket comprobantes en privado',
         case when n = 0 then 'si' else 'NO' end,
         case when n = 0 then 'OK' else 'REVISAR — aplicar 2026-07-comprobantes-privado.sql' end
    from comprobantes_publico

  union all
  select 5,
         'C-04b Politicas que tocan comprobantes (debe ser 0)',
         n::text,
         case when n = 0 then 'OK' else 'REVISAR — alguien anadio una regla permisiva' end
    from politicas_comprobantes

  union all
  select 6,
         'C-04c Politicas de escritura en avatars/logos que comprueban dueno (debe ser 3)',
         n::text,
         case when n >= 3 then 'OK' else 'REVISAR — aplicar 2026-08-storage-ownership.sql' end
    from politicas_con_dueno

  union all
  select 7,
         'C-04d Funcion public.membego_ruta_propia instalada',
         case when n > 0 then 'si' else 'no' end,
         case when n > 0 then 'OK' else 'REVISAR — aplicar 2026-08-storage-ownership.sql' end
    from funcion_dueno
) informe
order by orden;


-- ── Detalle: qué políticas hay hoy sobre storage.objects ────────────────────
-- Útil cuando alguna fila de arriba sale REVISAR y hay que ver qué quedó.
select policyname,
       cmd,
       roles::text as roles,
       coalesce(qual::text, '')       as using_expr,
       coalesce(with_check::text, '') as check_expr
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
 order by policyname;
