-- ─────────────────────────────────────────────────────────────────────────────
-- ¿SE PUEDEN LEER LAS IMÁGENES DE PROMOCIONES SIN INICIAR SESIÓN?
--
-- NO CAMBIA NADA. Solo mira y responde.
--
-- POR QUÉ SE PREGUNTA
--
-- La vista previa al compartir no es un `<img>` a la foto: es un endpoint
-- (`/promocion/<slug>/opengraph-image`) que el SERVIDOR descarga y compone. Esa
-- descarga va SIN sesión, igual que la haría WhatsApp o Facebook al leer el
-- enlace. Si el bucket `promociones` no permite lectura anónima, la descarga
-- devuelve 400 y la foto no puede salir ni en el panel ni al compartir.
--
-- Y lo que hace sospechar: en `migrations_manual/` hay políticas de lectura
-- pública para `avatars`, `logos` y `comprobantes` —y para `promociones` solo
-- de INSERT, UPDATE y DELETE—. Nunca se escribió una de SELECT.
--
-- Eso no lo decide todo: si el bucket está marcado `public = true`, Supabase
-- sirve la ruta `/object/public/...` sin pasar por RLS y la política de SELECT
-- no hace falta. Por eso hay que MIRAR en vez de deducir.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · ¿El bucket es público? ──────────────────────────────────────────────
-- `public = true` → las URLs `/storage/v1/object/public/...` se sirven sin
-- sesión y sin RLS. Es lo que hace falta para compartir.
select id,
       public          as lectura_anonima,
       file_size_limit as limite_bytes,
       allowed_mime_types
  from storage.buckets
 where id in ('promociones', 'logos', 'avatars')
 order by id;

-- ── 2 · ¿Qué políticas de LECTURA hay, y sobre qué buckets? ─────────────────
-- Solo importa si el bucket NO es público. `qual` enseña a qué buckets alcanza
-- cada política.
select polname as politica,
       case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                   when 'w' then 'UPDATE' when 'd' then 'DELETE' else polcmd::text end as operacion,
       pg_get_expr(polqual, polrelid) as condicion
  from pg_policy
 where polrelid = 'storage.objects'::regclass
   and polcmd = 'r'
 order by polname;

-- ── 3 · ¿Hay imágenes de promoción subidas, y de qué tipo? ──────────────────
-- El formato importa aparte del permiso: la tarjeta compuesta solo rasteriza
-- PNG, JPEG y GIF. Un WEBP se sirve entero si pesa poco, pero no se puede
-- componer dentro de la tarjeta.
select split_part(name, '/', 1)          as empresa,
       metadata->>'mimetype'             as tipo,
       count(*)                          as archivos,
       pg_size_pretty(max((metadata->>'size')::bigint)) as el_mas_grande
  from storage.objects
 where bucket_id = 'promociones'
 group by 1, 2
 order by 1, 2;
