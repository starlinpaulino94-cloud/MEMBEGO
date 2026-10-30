-- ============================================================================
-- Bucket de Storage `tutoriales` (videos cortos de «cómo se hace» del panel)
-- Ejecutar en el SQL Editor de Supabase. IDEMPOTENTE.
--
-- Los clips (MP4 de ~1 minuto, 720p) y sus carteles (JPG) son los mismos para
-- todas las empresas y se leen con <video src> desde el panel, así que el
-- bucket es público de lectura. Solo los sube el equipo de Membego con la clave
-- de servicio (`grabacion/tutoriales/subir.mts`): no hay política de escritura
-- para usuarios autenticados, a propósito.
--
-- Mismo patrón que avatars/logos/comprobantes/promociones/evidencias.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tutoriales', 'tutoriales', true, 52428800,
        ARRAY['video/mp4', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = 52428800,
      allowed_mime_types = ARRAY['video/mp4', 'image/jpeg'];

DO $$ BEGIN
  CREATE POLICY "pase_tutoriales_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'tutoriales');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Verificación ─────────────────────────────────────────────────────────────
SELECT 'bucket tutoriales' AS objeto,
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tutoriales' AND public)
            THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL SELECT 'policy lectura publica',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                           AND policyname = 'pase_tutoriales_public_read')
            THEN 'OK' ELSE 'FALTA' END;
