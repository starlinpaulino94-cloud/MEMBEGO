'use server'

import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { createAdminClient } from '@/lib/supabase/admin'
import { uniqueFileName } from '@/lib/storage'
import { rutaBanner } from '@/lib/storage-rutas'
import { detectarTipoImagen, EXTENSION_DE_IMAGEN } from '@/lib/imagen-tipo'
import { BUCKET_BANNERS } from './imagen-banner'

const MAX_MB = 5
const MAX_BYTES = MAX_MB * 1024 * 1024

/**
 * Sube la imagen de un banner del Inicio.
 *
 * Escribe con el cliente de servicio, que IGNORA las políticas de Storage: por
 * eso toda la autorización ocurre aquí, ANTES de crear nada, con la misma
 * puerta que guardar el editor (sección `personalizacion` + capacidad
 * HOME_BUILDER) y la empresa SALE DE LA SESIÓN, nunca de lo que mande el
 * navegador. El tipo lo decide la FIRMA del archivo, no `file.type`; el
 * tamaño se mide sobre los bytes leídos; nunca se sobrescribe un objeto.
 *
 * La URL devuelta solo la acepta `heroPublico` por vivir bajo
 * `<empresa>/banners/` (ver `esImagenDeBannerPropia`).
 */
export async function subirImagenBanner(
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  const user = await requireSection('personalizacion')
  if (!user) return { error: 'No autorizado.' }
  const empresa = await resolveCompanyId(user)
  if (!empresa) return { error: 'Selecciona una empresa activa.' }
  if (!(await tieneCapacidad(empresa, 'HOME_BUILDER'))) return { error: 'No autorizado.' }

  const file = formData.get('archivo')
  if (!(file instanceof File) || typeof file.arrayBuffer !== 'function') return { error: 'Archivo no válido.' }
  if (file.size > MAX_BYTES) return { error: `La imagen no puede superar ${MAX_MB} MB.` }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_BYTES) return { error: `La imagen no puede superar ${MAX_MB} MB.` }
  const tipo = detectarTipoImagen(buffer)
  if (!tipo) return { error: 'Formato no permitido. Usa JPG, PNG o WebP.' }

  const path = rutaBanner(empresa, uniqueFileName(EXTENSION_DE_IMAGEN[tipo]))
  const supabase = createAdminClient()
  const { error } = await supabase.storage.from(BUCKET_BANNERS).upload(path, buffer, { contentType: tipo, upsert: false })
  if (error) {
    console.error('[home-banner] upload:', error.message)
    return { error: 'No se pudo subir la imagen. Intenta de nuevo.' }
  }
  return { url: supabase.storage.from(BUCKET_BANNERS).getPublicUrl(path).data.publicUrl }
}
