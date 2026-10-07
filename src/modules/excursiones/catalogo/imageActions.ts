'use server'

import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { uniqueFileName } from '@/lib/storage'
import { rutaExcursion } from '@/lib/storage-rutas'
import { detectarTipoImagen, EXTENSION_DE_IMAGEN } from '@/lib/imagen-tipo'

const BUCKET = 'promociones'
const MAX_MB = 5
const MAX_BYTES = MAX_MB * 1024 * 1024

/**
 * Sube una imagen de excursión al bucket `promociones`.
 *
 * Esta acción escribe con el cliente de servicio (`createAdminClient`), que
 * IGNORA las políticas de Storage: por eso toda la autorización ocurre aquí,
 * ANTES de crearlo, y no se confía en nada que mande el navegador.
 *
 *  - Sesión y permiso: la misma sección y función que crear/editar una
 *    excursión (`catalogo_crear` sin excursión, `catalogo_editar` con ella).
 *    Un cliente, un anónimo o un empleado sin ese permiso no pasan.
 *  - Empresa: sale de la sesión. El `companyId` recibido solo se acepta si
 *    coincide con el de la sesión (o, para el superadmin, si existe).
 *  - Excursión: si viene, debe ser de esa empresa.
 *  - Archivo: el tipo y la extensión los decide la FIRMA del archivo, no
 *    `file.type` ni `file.name`; el tamaño se mide sobre los bytes leídos.
 *  - Nunca se sobrescribe un objeto existente (`upsert: false`).
 */
export async function subirImagenExcursion(
  companyId: string,
  excursionId: string | null,
  file: File,
): Promise<{ url: string; path: string } | { error: string }> {
  const user = await requireSection('excursiones', excursionId ? 'catalogo_editar' : 'catalogo_crear')
  if (!user) return { error: 'No autorizado.' }

  if (!companyId) return { error: 'Selecciona una empresa activa.' }
  const pedida = new FormData()
  pedida.set('companyId', companyId)
  const empresa = await resolveCompanyId(user, pedida)
  if (!empresa) return { error: 'Selecciona una empresa activa.' }
  if (empresa !== companyId) return { error: 'No autorizado.' }

  if (excursionId) {
    const existe = await conEmpresa(empresa, (tx) =>
      tx.excursion.findFirst({ where: { id: excursionId, companyId: empresa }, select: { id: true } })
    )
    if (!existe) return { error: 'Excursión no encontrada.' }
  }

  if (!file || typeof file.arrayBuffer !== 'function') return { error: 'Archivo no válido.' }
  if (file.size > MAX_BYTES) return { error: `La imagen no puede superar ${MAX_MB} MB.` }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_BYTES) return { error: `La imagen no puede superar ${MAX_MB} MB.` }
  const tipo = detectarTipoImagen(buffer)
  if (!tipo) return { error: 'Formato no permitido. Usa JPG, PNG o WebP.' }

  const path = rutaExcursion(empresa, excursionId, uniqueFileName(EXTENSION_DE_IMAGEN[tipo]))

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: tipo, upsert: false })

  if (error) {
    console.error('[excursion-imagen] upload:', error.message)
    return { error: 'No se pudo subir la imagen. Intenta de nuevo.' }
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}
