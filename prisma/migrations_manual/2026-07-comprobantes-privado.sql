-- ============================================================================
-- CIERRE DEL BUCKET DE COMPROBANTES  (auditoría de producción · C-01)
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
--
-- QUÉ ARREGLA
--
-- El bucket `comprobantes` era PÚBLICO: cualquiera con la URL veía el
-- comprobante bancario de un cliente (su nombre, su banco, su número de cuenta
-- y cuánto pagó). Y como las políticas permitían INSERT/UPDATE a cualquier
-- usuario autenticado sobre cualquier ruta, un cliente podía además
-- SOBRESCRIBIR el comprobante de otro y destruir la prueba de un pago real.
--
-- Después de correr esto:
--   · nadie lee del bucket sin una URL firmada por el servidor,
--   · nadie escribe en él salvo con un token de subida que el servidor emite
--     para UNA ruta concreta (`createSignedUploadUrl`),
--   · `avatars` y `logos` siguen públicos: son imágenes de escaparate, no
--     documentos personales, y el código las sirve con `getPublicUrl`.
--
-- Los archivos YA SUBIDOS no se mueven ni se pierden: el código sabe extraer
-- la ruta de las URL públicas antiguas y firmarlas (ver `rutaDesdeValor` en
-- src/modules/storage/comprobantes.ts).
-- ============================================================================

-- 1) El bucket pasa a PRIVADO y con límites propios ---------------------------
--    El límite de tamaño y los tipos permitidos dejan de depender solo de la
--    validación del navegador, que es del atacante.
update storage.buckets
   set public             = false,
       file_size_limit    = 10485760,  -- 10 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'comprobantes';

-- 2) Quitar las políticas antiguas de este bucket -----------------------------
--    Las de `avatars` y `logos` se recrean abajo sin `comprobantes`.
drop policy if exists "pase_public_read" on storage.objects;
drop policy if exists "pase_authenticated_insert" on storage.objects;
drop policy if exists "pase_authenticated_update" on storage.objects;
drop policy if exists "pase_authenticated_delete" on storage.objects;

-- 3) Imágenes de escaparate: lectura pública, escritura autenticada -----------
create policy "membego_public_read_imagenes"
  on storage.objects for select
  to public
  using ( bucket_id in ('avatars','logos') );

create policy "membego_auth_insert_imagenes"
  on storage.objects for insert
  to authenticated
  with check ( bucket_id in ('avatars','logos') );

create policy "membego_auth_update_imagenes"
  on storage.objects for update
  to authenticated
  using ( bucket_id in ('avatars','logos') )
  with check ( bucket_id in ('avatars','logos') );

create policy "membego_auth_delete_imagenes"
  on storage.objects for delete
  to authenticated
  using ( bucket_id in ('avatars','logos') );

-- 4) Comprobantes: NINGUNA política ------------------------------------------
--    Sin política, RLS deniega a `anon` y a `authenticated`. El único que pasa
--    es `service_role`, que ignora RLS — y es justo el que usa el servidor para
--    firmar subidas y lecturas después de comprobar quién pregunta.
--
--    No hace falta escribir nada aquí: la ausencia ES la política. Se deja el
--    comentario para que nadie "arregle" el hueco añadiendo una regla
--    permisiva.

-- ── Verificación ────────────────────────────────────────────────────────────
-- La primera fila debe decir false (bucket privado).
-- La segunda debe dar 0: ninguna política toca ya el bucket de comprobantes.
select 'comprobantes.public' as objeto, public::text as valor
  from storage.buckets where id = 'comprobantes'
union all
select 'politicas sobre comprobantes', count(*)::text
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and qual::text like '%comprobantes%';
