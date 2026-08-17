-- ============================================================================
-- STORAGE · PROPIEDAD EN `promociones` Y `evidencias`   (auditoría · C-04b)
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
--
-- Aplicar DESPUÉS de `2026-08-storage-ownership.sql`: reutiliza
-- `public.membego_es_superadmin()`, que se crea allí.
-- ============================================================================
--
-- QUÉ ARREGLA
--
-- Estos dos buckets nunca los gobernó un archivo del repositorio: se
-- configuraron a mano en el panel. Al inventariar `pg_policies` aparecieron
-- con la misma forma que ya se corrigió en `avatars`/`logos`:
--
--     create policy "pase_promos_authenticated_delete"
--       on storage.objects for delete to authenticated
--       using ( bucket_id = 'promociones' );
--
-- Solo miran el bucket, no el dueño. Con una sesión de cliente cualquiera
-- —basta registrarse— se puede sobrescribir o BORRAR cualquier imagen de
-- promoción de cualquier empresa, y cualquier foto de evidencia de lavado.
--
-- Las evidencias son las que más pesan: son la prueba del estado en que entró
-- un vehículo. Que un tercero pueda sustituirlas cambia quién gana una
-- disputa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO SIRVE `membego_ruta_propia`
--
-- La función de `avatars`/`logos` comprueba ids de EMPRESA y de CLIENTE. Aquí
-- el id que aparece en la ruta es de otra cosa:
--
--     promociones:  <promocionId>/<archivo>
--                   invitaciones/<campanaId>/<archivo>
--                   invitaciones/<campanaInvitacionId>/<archivo>
--     evidencias:   <colaId>/<archivo>
--
-- Reutilizarla habría denegado el 100 % de las subidas, y el síntoma habría
-- sido «No se pudo subir la imagen» —no un error de permisos—, que es la peor
-- forma de romper algo. Por eso hay una función aparte que resuelve cada id
-- hasta su empresa.
--
-- ────────────────────────────────────────────────────────────────────────────
-- EL HUECO QUE ESTO **NO** CIERRA, Y HAY QUE DECIRLO
--
-- Los formularios suben con `folder={existing?.id ?? 'nueva'}`
-- (`PromocionForm.tsx:223`, `MarketingCampaignForm.tsx:301`,
-- `CampanaInvitacionForm.tsx:266`). Al CREAR, la entidad todavía no existe, así
-- que el archivo va a la carpeta literal `nueva/`, compartida por todas las
-- empresas. Lo mismo con `sueltas/` en evidencias (`EvidenciaForm.tsx:64`).
--
-- En ese momento no hay ningún id contra el que comprobar propiedad, así que
-- estas políticas DEJAN `nueva/` y `sueltas/` ABIERTAS a cualquier usuario
-- autenticado. No es un descuido: es el límite de lo que se puede hacer sin
-- tocar código.
--
-- Queda cerrado el daño grande —borrar o sustituir el material YA PUBLICADO de
-- otra empresa— y queda abierto el pequeño: pisarse archivos recién subidos y
-- aún sin entidad. El arreglo completo pide cambiar la ruta a
-- `<companyId>/nueva/…`, o emitir una URL de subida firmada desde el servidor
-- como ya hace `comprobantes`.
-- ============================================================================


-- ── 1. Las empresas del que llama ───────────────────────────────────────────
--
-- Aquí SÍ se materializa el conjunto, al revés que en `membego_ruta_propia`:
-- una persona pertenece a una empresa y tiene acceso a unas pocas más. Son
-- unidades de filas, no las cien mil que tendría el conjunto de clientes.

create or replace function public.membego_mis_empresas()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u."companyId"
    from public.users u
   where u."supabaseId" = auth.uid()::text
     and u."companyId" is not null
  union
  select a."companyId"
    from public.user_company_access a
    join public.users u on u.id = a."userId"
   where u."supabaseId" = auth.uid()::text
$$;


-- ── 2. ¿Este archivo es de una de mis empresas? ─────────────────────────────

create or replace function public.membego_medio_propio(ruta text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  segs  text[] := string_to_array(ruta, '/');
  n     int    := array_length(segs, 1);
  cands text[];
begin
  if n is null or n = 0 then
    return false;
  end if;

  if public.membego_es_superadmin() then
    return true;
  end if;

  -- Los dos sitios donde puede estar el id: el nombre del archivo sin
  -- extensión y la carpeta que lo contiene. En estos buckets el nombre del
  -- archivo es aleatorio, así que en la práctica siempre acierta la carpeta;
  -- se miran los dos por el mismo motivo que en `membego_ruta_propia`.
  cands := array_remove(
    array[
      split_part(segs[n], '.', 1),
      case when n >= 2 then segs[n - 1] end
    ],
    null
  );

  -- Carpetas compartidas: la entidad aún no existe, no hay dueño que
  -- comprobar. Ver la nota de la cabecera — esto queda abierto a propósito.
  if 'nueva' = any(cands) or 'sueltas' = any(cands) then
    return true;
  end if;

  -- Cada id se resuelve hasta su empresa. Todas las búsquedas caen sobre la
  -- clave primaria de su tabla.
  return exists (
    select 1 from public.promociones t
     where t.id = any(cands)
       and t."companyId" in (select public.membego_mis_empresas())
  ) or exists (
    select 1 from public.campanas t
     where t.id = any(cands)
       and t."companyId" in (select public.membego_mis_empresas())
  ) or exists (
    select 1 from public.campanas_invitacion t
     where t.id = any(cands)
       and t."companyId" in (select public.membego_mis_empresas())
  ) or exists (
    select 1 from public.cola_vehiculos t
     where t.id = any(cands)
       and t."companyId" in (select public.membego_mis_empresas())
  );
end;
$$;

grant execute on function public.membego_mis_empresas()      to authenticated;
grant execute on function public.membego_medio_propio(text)  to authenticated;


-- ── 3. Las políticas ────────────────────────────────────────────────────────
--
-- La LECTURA no cambia: las dos siguen públicas. Son imágenes que la app sirve
-- con `getPublicUrl`, y cerrarlas exigiría firmar cada URL. Se cierra la
-- ESCRITURA, que es donde está el daño.
--
-- Los nombres `pase_*` se conservan: son los que ya existen en la base, y
-- renombrarlos dejaría los viejos vivos junto a los nuevos.

drop policy if exists "pase_promos_authenticated_insert" on storage.objects;
create policy "pase_promos_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check ( bucket_id = 'promociones' and public.membego_medio_propio(name) );

drop policy if exists "pase_promos_authenticated_update" on storage.objects;
create policy "pase_promos_authenticated_update"
  on storage.objects for update
  to authenticated
  -- Las dos cláusulas: `using` decide qué puedo tocar, `with check` en qué se
  -- puede convertir. Sin la segunda, un update podría mover mi archivo a la
  -- carpeta de otra empresa.
  using      ( bucket_id = 'promociones' and public.membego_medio_propio(name) )
  with check ( bucket_id = 'promociones' and public.membego_medio_propio(name) );

drop policy if exists "pase_promos_authenticated_delete" on storage.objects;
create policy "pase_promos_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using ( bucket_id = 'promociones' and public.membego_medio_propio(name) );

drop policy if exists "pase_evidencias_authenticated_insert" on storage.objects;
create policy "pase_evidencias_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check ( bucket_id = 'evidencias' and public.membego_medio_propio(name) );

drop policy if exists "pase_evidencias_authenticated_update" on storage.objects;
create policy "pase_evidencias_authenticated_update"
  on storage.objects for update
  to authenticated
  using      ( bucket_id = 'evidencias' and public.membego_medio_propio(name) )
  with check ( bucket_id = 'evidencias' and public.membego_medio_propio(name) );

drop policy if exists "pase_evidencias_authenticated_delete" on storage.objects;
create policy "pase_evidencias_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using ( bucket_id = 'evidencias' and public.membego_medio_propio(name) );


-- ── 4. Verificación ─────────────────────────────────────────────────────────
--
-- (a) Las seis políticas de escritura deben comprobar el dueño.
--     `(no aplica)` es correcto: una política de INSERT no puede llevar
--     `USING`, y una de DELETE no puede llevar `WITH CHECK`. En `pg_policies`
--     la columna que no aplica sale NULL, no `false`.
select policyname,
       cmd,
       case
         when cmd = 'INSERT' then '(no aplica)'
         when qual::text like '%membego_medio_propio%' then 'OK'
         else 'REVISAR'
       end as using_dueno,
       case
         when cmd = 'DELETE' then '(no aplica)'
         when with_check::text like '%membego_medio_propio%' then 'OK'
         else 'REVISAR'
       end as check_dueno
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and policyname like 'pase_%_authenticated_%'
 order by policyname;

-- (b) La prueba que de verdad importa. Sustituye el UUID por el `supabaseId`
--     de un empleado y los ids por promociones reales de dos empresas
--     distintas. La primera debe dar true y la segunda false:
--
--     select set_config('request.jwt.claims',
--                       json_build_object('sub','<UUID-DEL-EMPLEADO>')::text, true);
--     select public.membego_medio_propio('<PROMOCION-DE-SU-EMPRESA>/x.png');  -- true
--     select public.membego_medio_propio('<PROMOCION-DE-OTRA-EMPRESA>/x.png');-- false
--     select public.membego_medio_propio('nueva/x.png');                      -- true (hueco conocido)
--
-- (c) Marcha atrás, si rompe alguna subida en producción: volver a las
--     políticas abiertas. Es reabrir el hueco; hazlo solo mientras diagnosticas.
--
--     drop policy if exists "pase_promos_authenticated_insert" on storage.objects;
--     create policy "pase_promos_authenticated_insert" on storage.objects
--       for insert to authenticated with check ( bucket_id = 'promociones' );
--     -- …y equivalente para update/delete y para 'evidencias'.
