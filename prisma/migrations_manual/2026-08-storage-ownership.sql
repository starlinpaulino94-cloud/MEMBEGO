-- ============================================================================
-- STORAGE · PROPIEDAD DE LOS ARCHIVOS  (auditoría · C-04)
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- ============================================================================
--
-- QUÉ ARREGLA
--
-- `2026-07-comprobantes-privado.sql` cerró el bucket de comprobantes, que era
-- el grave. Pero dejó `avatars` y `logos` con esta forma:
--
--     create policy "membego_auth_update_imagenes"
--       on storage.objects for update to authenticated
--       using ( bucket_id in ('avatars','logos') );
--
-- El `using` solo mira EN QUÉ BUCKET está el archivo. No mira de quién es. Con
-- una sesión de cliente cualquiera —la más barata de conseguir: registrarse—
-- se puede sobrescribir o BORRAR el logo de cualquier empresa de la
-- plataforma, y la foto de cualquier cliente. No es fuga de datos: es que un
-- competidor puede dejar en blanco el escaparate de otro.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ LA COMPROBACIÓN MIRA DOS POSICIONES DE LA RUTA
--
-- El código sube con cuatro convenciones distintas, y el id del dueño no cae
-- siempre en el mismo sitio:
--
--     avatars/<clienteId>.<ext>              components/cliente/AvatarUpload
--     logos/<companyId>.<ext>                components/superadmin/LogoUpload
--     banners/<companyId>.<ext>              components/admin/MediaUpload
--     gallery/<companyId>/<epoch>.<ext>      components/admin/GalleryManager
--
-- En las tres primeras el id es el NOMBRE DEL ARCHIVO sin extensión; en la
-- cuarta es la CARPETA que lo contiene. Por eso `membego_ruta_propia` acepta
-- que el id aparezca en cualquiera de esas dos posiciones, en vez de fijar una
-- sola y romper la mitad de las subidas.
--
-- Esto tiene una consecuencia que conviene decir en voz alta: la política
-- depende de que el nombre del archivo lleve el id. Una convención NUEVA que
-- no lo lleve quedará denegada —falla cerrada, que es el lado correcto por el
-- que fallar, pero se manifiesta como "no se pudo subir la imagen" y no como
-- un error de permisos. Si aparece ese síntoma tras añadir un componente de
-- subida, mirar aquí primero.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LO QUE ESTO NO CUBRE
--
-- Los buckets `promociones` y `evidencias` los usa el código
-- (`PromoImagenUpload`, `CampanaImagenUpload`, `EvidenciaForm`,
-- `modules/solicitudes/actions.ts`) pero NO los crea ni los gobierna ningún
-- SQL de este repositorio. Sea cual sea su configuración hoy, se puso a mano
-- en el panel y nadie puede revisarla leyendo el código. Se deja fuera a
-- propósito: escribir aquí una política para un bucket cuya visibilidad
-- pretendida no consta sería inventarse la regla. Hay que decidirlo aparte.
-- ============================================================================


-- ── 1. ¿Quién soy? ──────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque `authenticated` no tiene permiso sobre `public`
-- desde la Capa 1 (`20260771_rls_barrera_publica`) — y no se le va a devolver.
-- La función corre como su dueño, lee lo justo, y devuelve un booleano.
--
-- `set search_path` fijo: sin él, quien pueda crear objetos en un esquema del
-- search_path podría suplantar `users` o `clientes` dentro de una función que
-- corre con privilegios elevados.

create or replace function public.membego_es_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.users u
     where u."supabaseId" = auth.uid()::text
       and u.role = 'SUPERADMIN'
  )
$$;


-- ── 2. ¿Esta ruta es mía? ───────────────────────────────────────────────────
--
-- POR QUÉ NO HAY UNA FUNCIÓN «DAME TODOS MIS IDS»
--
-- La forma obvia sería devolver el conjunto de ids que me pertenecen y
-- preguntar si el de la ruta está dentro. Pero ese conjunto incluye TODAS las
-- fichas de cliente de mi empresa: en una empresa con cien mil clientes,
-- subir un archivo obligaría a materializar cien mil filas para comprobar una.
-- Y esto corre dentro de una política, o sea en cada operación de storage.
--
-- Se le da la vuelta: en vez de traer el conjunto y buscar dentro, se toman
-- los uno o dos candidatos de la ruta y se pregunta por ellos directamente.
-- Todas las consultas de abajo caen sobre clave primaria o índice único.

create or replace function public.membego_ruta_propia(ruta text)
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

  -- El superadmin administra los logos de todas las empresas desde su panel.
  if public.membego_es_superadmin() then
    return true;
  end if;

  -- Los dos sitios donde puede estar el id del dueño (ver cabecera):
  --   'gallery/abc/17.png' -> base '17', padre 'abc'
  --   'logos/abc.png'      -> base 'abc', padre 'logos'
  cands := array_remove(
    array[
      split_part(segs[n], '.', 1),
      case when n >= 2 then segs[n - 1] end
    ],
    null
  );

  -- ¿Alguno es la empresa a la que pertenezco?
  if exists (
    select 1
      from public.users u
     where u."supabaseId" = auth.uid()::text
       and u."companyId" = any(cands)
  ) then
    return true;
  end if;

  -- ¿O una de las empresas a las que tengo acceso explícito?
  if exists (
    select 1
      from public.user_company_access a
      join public.users u on u.id = a."userId"
     where u."supabaseId" = auth.uid()::text
       and a."companyId" = any(cands)
  ) then
    return true;
  end if;

  -- ¿O una ficha de cliente mía? (la misma persona puede ser cliente de
  -- varias empresas, así que se comprueba por supabaseId, no por unicidad)
  if exists (
    select 1
      from public.clientes c
     where c.id = any(cands)
       and c."supabaseId" = auth.uid()::text
  ) then
    return true;
  end if;

  -- ¿O una ficha de cliente de mi empresa? (un admin corrige la foto de un
  -- cliente de mostrador desde su ficha)
  if exists (
    select 1
      from public.clientes c
      join public.users u on u."supabaseId" = auth.uid()::text
     where c.id = any(cands)
       and (
         c."companyId" = u."companyId"
         or exists (
           select 1
             from public.user_company_access a
            where a."userId" = u.id
              and a."companyId" = c."companyId"
         )
       )
  ) then
    return true;
  end if;

  return false;
end;
$$;

grant execute on function public.membego_es_superadmin()    to authenticated;
grant execute on function public.membego_ruta_propia(text)  to authenticated;

-- Por si quedó de un intento anterior: en la primera versión de este archivo
-- existía una función que devolvía el conjunto entero de ids. Se retiró por lo
-- explicado arriba; se borra aquí para no dejarla suelta con permiso de
-- ejecución concedido.
drop function if exists public.membego_ids_propios();


-- ── 3. Las políticas ────────────────────────────────────────────────────────
--
-- La LECTURA no cambia: `avatars` y `logos` son imágenes de escaparate y el
-- código las sirve con `getPublicUrl`. Lo que se cierra es la escritura.

drop policy if exists "membego_auth_insert_imagenes" on storage.objects;
create policy "membego_auth_insert_imagenes"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('avatars','logos')
    and public.membego_ruta_propia(name)
  );

drop policy if exists "membego_auth_update_imagenes" on storage.objects;
create policy "membego_auth_update_imagenes"
  on storage.objects for update
  to authenticated
  -- `using` decide qué filas puedo tocar; `with check`, en qué se pueden
  -- convertir. Hacen falta las dos: sin `with check`, un update podría
  -- renombrar mi archivo a la ruta de otro.
  using (
    bucket_id in ('avatars','logos')
    and public.membego_ruta_propia(name)
  )
  with check (
    bucket_id in ('avatars','logos')
    and public.membego_ruta_propia(name)
  );

drop policy if exists "membego_auth_delete_imagenes" on storage.objects;
create policy "membego_auth_delete_imagenes"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('avatars','logos')
    and public.membego_ruta_propia(name)
  );


-- ── 4. Verificación ─────────────────────────────────────────────────────────
--
-- (a) Las tres políticas de escritura deben mencionar `membego_ruta_propia`.
--     Si alguna sale sin ella, quedó la versión vieja y el hueco sigue abierto.
select policyname,
       cmd,
       qual::text        like '%membego_ruta_propia%' as using_comprueba_dueno,
       with_check::text  like '%membego_ruta_propia%' as check_comprueba_dueno
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and policyname like 'membego_auth_%_imagenes'
 order by policyname;

-- (b) Prueba con un usuario real. Sustituye el UUID por el de una cuenta de
--     cliente y comprueba que la primera da true y la segunda false:
--
--     select set_config('request.jwt.claims',
--                       json_build_object('sub','<UUID-DEL-CLIENTE>')::text, true);
--     select public.membego_ruta_propia('avatars/<SU-CLIENTE-ID>.png');   -- true
--     select public.membego_ruta_propia('avatars/<OTRO-CLIENTE-ID>.png'); -- false
--
-- (c) Marcha atrás, si algo se rompe en producción y hace falta ganar tiempo:
--     vuelve a las políticas abiertas de `2026-07-comprobantes-privado.sql`
--     § 3. Es volver a dejar el hueco: hazlo solo mientras se diagnostica.
