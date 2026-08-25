'use server'

import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { uniqueFileName } from '@/lib/storage'
import { rutaExcursion } from '@/lib/storage-rutas'

const BUCKET = 'promociones'
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_MB = 5

export async function subirImagenExcursion(
  companyId: string,
  excursionId: string | null,
  file: File,
): Promise<{ url: string; path: string } | { error: string }> {
  if (!companyId) return { error: 'Selecciona una empresa activa.' }
  if (!ALLOWED.includes(file.type)) return { error: 'Formato no permitido. Usa JPG, PNG o WebP.' }
  if (file.size > MAX_MB * 1024 * 1024) return { error: `La imagen no puede superar ${MAX_MB} MB.` }

  const supabase = createAdminClient()
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = rutaExcursion(companyId, excursionId, uniqueFileName(ext))

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (error) {
    console.error('[excursion-imagen] upload:', error.message)
    return { error: 'No se pudo subir la imagen. Intenta de nuevo.' }
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}
