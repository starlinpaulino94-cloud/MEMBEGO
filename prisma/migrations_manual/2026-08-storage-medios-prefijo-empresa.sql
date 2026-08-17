-- ============================================================================
-- STORAGE · MEDIOS CON PREFIJO DE EMPRESA   (auditoría · C-04b, fase 2)
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
--
-- Sustituye a `2026-08-storage-ownership-medios.sql`. Aplicar DESPUÉS de él y
-- DESPUÉS de desplegar el código que construye las rutas nuevas
-- (`src/lib/storage-rutas.ts`).
-- ============================================================================
--
-- QUÉ CAMBIA RESPECTO A LA FASE ANTERIOR
--
-- La fase 1 cerró el borrado del material ya publicado, pero dejó abiertas las
-- carpetas compartidas `nueva/` y `sueltas/`: al CREAR una promoción todavía no
-- hay id, así que no había nada contra lo que comprobar propiedad y todas las
-- empresas escribían en la misma carpeta.
--
-- El código ya no hace eso. Ahora la empresa va SIEMPRE en el primer segmento:
--
--     <companyId>/<promocionId|nueva>/<archivo>
--     <companyId>/invitaciones/<campanaId|nueva>/<archivo>
--     <companyId>/<colaId|sueltas>/<archivo>
--
-- `nueva/` y `sueltas/` siguen existiendo, pero cuelgan de la empresa: dos
-- empresas ya no comparten carpeta, que era el problema entero.
--
-- La política se reduce a una comprobación que no depende de ninguna tabla de
-- negocio y no tiene ningún caso sin dueño: **el primer segmento tiene que ser
-- una de mis empresas**.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA RAMA HEREDADA, Y POR QUÉ SIGUE AQUÍ
--
-- Los archivos subidos ANTES de este cambio están en el formato viejo
-- (`<promocionId>/…`, `nueva/…`). Si la política solo aceptara el formato
-- nuevo, nadie podría reemplazar ni borrar una imagen antigua: el panel diría
-- «No se pudo subir la imagen» al cambiar la foto de una promoción vieja.
--
-- Por eso se conserva la resolución por tabla como SEGUNDA opción. Lo que NO
-- se conserva es el permiso general sobre `nueva/` y `sueltas/` sin prefijo:
-- ahí estaba el agujero, y ningún archivo nuevo va a caer ya en esas rutas.
--
-- Consecuencia consciente: los archivos que YA están en `nueva/` quedan
-- inalcanzables para los usuarios (solo `service_role` los toca). Para eso
-- está `scripts/migrar-medios-a-empresa.mjs`, que los mueve bajo su empresa.
-- Mientras no se ejecute, esas imágenes se ven (la lectura es pública) pero no
-- se pueden reemplazar desde el panel.
-- ============================================================================


-- ── 1. La comprobación ──────────────────────────────────────────────────────
--
-- `membego_mis_empresas()` viene de `2026-08-storage-ownership-medios.sql`.

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

  -- ── FORMATO NUEVO: la empresa es el primer segmento ──────────────────────
  -- Una comparación y se acabó. Sin consultar promociones, campañas ni colas.
  if segs[1] in (select public.membego_mis_empresas()) then
    return true;
  end if;

  -- ── FORMATO HEREDADO: resolver el id hasta su empresa ────────────────────
  -- Solo para lo subido antes del cambio de rutas. Ojo: aquí YA NO se permite
  -- `nueva/` ni `sueltas/` sin prefijo — era el agujero de la fase 1.
  cands := array_remove(
    array[
      split_part(segs[n], '.', 1),
      case when n >= 2 then segs[n - 1] end
    ],
    null
  );

  return exists (
    select 1 from public.promociones t
     where t.id = any(cands)
       and t."companyId" in (select public.membego_mis_empresas())
  ) or exists (
    -- `marketing_campaigns`, NO `campanas`: el formulario de marketing usa el
    -- modelo MarketingCampaign, que es el que tiene `imagenUrl`/`bannerUrl`.
    -- `campanas` (Campana) no guarda ninguna imagen, así que nunca es dueña de
    -- un archivo. La fase 1 consultaba esa tabla por error.
    select 1 from public.marketing_campaigns t
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

grant execute on function public.membego_medio_propio(text) to authenticated;


-- ── 2. Las políticas no cambian de forma ────────────────────────────────────
--
-- Siguen llamando a `membego_medio_propio`; lo que cambió es la función. Se
-- recrean igualmente para que este archivo se pueda aplicar sobre una base que
-- nunca vio la fase 1.

drop policy if exists "pase_promos_authenticated_insert" on storage.objects;
create policy "pase_promos_authenticated_insert"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'promociones' and public.membego_medio_propio(name) );

drop policy if exists "pase_promos_authenticated_update" on storage.objects;
create policy "pase_promos_authenticated_update"
  on storage.objects for update to authenticated
  using      ( bucket_id = 'promociones' and public.membego_medio_propio(name) )
  with check ( bucket_id = 'promociones' and public.membego_medio_propio(name) );

drop policy if exists "pase_promos_authenticated_delete" on storage.objects;
create policy "pase_promos_authenticated_delete"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'promociones' and public.membego_medio_propio(name) );

drop policy if exists "pase_evidencias_authenticated_insert" on storage.objects;
create policy "pase_evidencias_authenticated_insert"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'evidencias' and public.membego_medio_propio(name) );

drop policy if exists "pase_evidencias_authenticated_update" on storage.objects;
create policy "pase_evidencias_authenticated_update"
  on storage.objects for update to authenticated
  using      ( bucket_id = 'evidencias' and public.membego_medio_propio(name) )
  with check ( bucket_id = 'evidencias' and public.membego_medio_propio(name) );

drop policy if exists "pase_evidencias_authenticated_delete" on storage.objects;
create policy "pase_evidencias_authenticated_delete"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'evidencias' and public.membego_medio_propio(name) );


-- ── 3. Verificación ─────────────────────────────────────────────────────────
--
-- (a) Cuánto queda en el formato heredado. Es el trabajo pendiente del script
--     de migración; cuando dé 0, se puede borrar la rama heredada de la
--     función de arriba.
select bucket_id,
       count(*) filter (where name like '%/%' and split_part(name,'/',1) in
                        (select id from public.companies)) as con_prefijo_empresa,
       count(*) filter (where not (split_part(name,'/',1) in
                        (select id from public.companies))) as formato_heredado,
       count(*) as total
  from storage.objects
 where bucket_id in ('promociones','evidencias')
 group by bucket_id;

-- (b) Lo que de verdad hay que comprobar. Sustituye el UUID por el
--     `supabaseId` de un empleado y los ids por empresas reales:
--
--     select set_config('request.jwt.claims',
--                       json_build_object('sub','<UUID-DEL-EMPLEADO>')::text, true);
--     select public.membego_medio_propio('<SU-COMPANY-ID>/nueva/x.png');    -- true
--     select public.membego_medio_propio('<OTRA-COMPANY-ID>/nueva/x.png');  -- false
--     select public.membego_medio_propio('nueva/x.png');                    -- false  ← el agujero cerrado
--
-- (c) Marcha atrás: volver a aplicar `2026-08-storage-ownership-medios.sql`,
--     que reinstala la versión anterior de la función (con `nueva/` abierta).
--     Es reabrir el agujero pequeño; sirve si el despliegue del código nuevo
--     hay que revertir.
