-- ============================================================================
-- E5 · Bucket de Storage `evidencias` (fotos antes/después del vehículo)
-- Ejecutar en el SQL Editor de Supabase. IDEMPOTENTE.
--
-- POR QUÉ HACE FALTA: crear el bucket desde la interfaz NO alcanza. Las fotos
-- se suben desde el NAVEGADOR con la sesión del empleado (rol `authenticated`),
-- y las políticas RLS de `storage.objects` del proyecto están escritas por
-- nombre de bucket. Sin una política de INSERT que nombre a `evidencias`, la
-- subida falla con un error de permisos aunque el bucket exista y sea público.
--
-- Mismo patrón que los buckets avatars/logos/comprobantes/promociones.
-- ============================================================================

-- 1) Asegurar el bucket: público (lectura anónima para <img src>), 8 MB,
--    solo imágenes. Si ya lo creaste a mano, esto solo ajusta los límites
--    para que coincidan con los del formulario.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('evidencias', 'evidencias', true, 8388608,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = 8388608,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 2) Políticas RLS del bucket.
DO $$ BEGIN
  CREATE POLICY "pase_evidencias_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'evidencias');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pase_evidencias_authenticated_insert" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'evidencias');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pase_evidencias_authenticated_update" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'evidencias');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pase_evidencias_authenticated_delete" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'evidencias');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Verificación: las 9 filas deben decir OK ────────────────────────────────
SELECT 'bucket evidencias' AS objeto,
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'evidencias' AND public)
            THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL SELECT 'policy lectura publica',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                         AND policyname = 'pase_evidencias_public_read')
            THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'policy subida (insert)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                         AND policyname = 'pase_evidencias_authenticated_insert')
            THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'policy sobrescritura (update)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                         AND policyname = 'pase_evidencias_authenticated_update')
            THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'policy borrado (delete)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                         AND policyname = 'pase_evidencias_authenticated_delete')
            THEN 'OK' ELSE 'FALTA' END
-- Tablas de la migración 20260759 (confirma que corrió completa).
UNION ALL SELECT 'tabla cola_vehiculos',
       CASE WHEN to_regclass('public.cola_vehiculos') IS NOT NULL THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'tabla productos_inventario',
       CASE WHEN to_regclass('public.productos_inventario') IS NOT NULL THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'tabla movimientos_inventario',
       CASE WHEN to_regclass('public.movimientos_inventario') IS NOT NULL THEN 'OK' ELSE 'FALTA' END
UNION ALL SELECT 'tabla evidencias_foto',
       CASE WHEN to_regclass('public.evidencias_foto') IS NOT NULL THEN 'OK' ELSE 'FALTA' END;
