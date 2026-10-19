-- ¿Está bien el bucket `promociones` para las imágenes del catálogo y de las promociones?
-- Pégalo entero en el SQL Editor de Supabase. Solo lee. Cada fila debe decir OK.
--
-- Qué comprueba y qué hacer si falla:
--   bucket existe        → FALTA: ejecuta scripts/supabase-20260739-promotion-purchase-engine.sql (sección Storage).
--   bucket público       → la vitrina y el panel leen por URL pública (/object/public/promociones/...).
--   límite ≥ 5 MB        → el formulario admite hasta 5 MB; un límite menor rechaza la subida.
--   admite JPG/PNG/WebP  → los tres tipos que detecta el servidor por firma.
--   lectura pública      → política SELECT para el bucket (solo importa si no es público).
SELECT 'bucket existe' AS comprobacion,
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'promociones') THEN 'OK' ELSE 'FALTA' END AS estado,
       '' AS detalle
UNION ALL
SELECT 'bucket público',
       CASE WHEN (SELECT public FROM storage.buckets WHERE id = 'promociones') THEN 'OK' ELSE 'NO: public = false' END, ''
UNION ALL
SELECT 'límite ≥ 5 MB',
       CASE WHEN coalesce((SELECT file_size_limit FROM storage.buckets WHERE id = 'promociones'), 2147483647) >= 5242880
            THEN 'OK' ELSE 'NO' END,
       coalesce((SELECT pg_size_pretty(file_size_limit) FROM storage.buckets WHERE id = 'promociones'), 'sin límite')
UNION ALL
SELECT 'admite JPG/PNG/WebP',
       CASE WHEN (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'promociones') IS NULL
                 OR (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'promociones')
                    @> ARRAY['image/jpeg','image/png','image/webp']
            THEN 'OK' ELSE 'NO' END,
       coalesce(array_to_string((SELECT allowed_mime_types FROM storage.buckets WHERE id = 'promociones'), ', '), 'cualquiera')
UNION ALL
SELECT 'lectura pública (política SELECT)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                           AND cmd = 'SELECT' AND qual LIKE '%promociones%')
            THEN 'OK' ELSE 'SIN POLÍTICA (basta si el bucket es público)' END, ''
UNION ALL
SELECT 'imágenes del catálogo ya subidas',
       'INFO',
       coalesce((SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'promociones' AND name LIKE '%/catalogo/%'), '0') || ' archivo(s)';
