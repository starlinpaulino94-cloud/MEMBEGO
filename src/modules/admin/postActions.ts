'use server'

import { revalidatePath } from 'next/cache'
import type { PostTipo } from '@prisma/client'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { notificarSeguidoresEmpresa } from '@/modules/notificaciones/service'

// F3.3: CRUD de publicaciones de empresa (eventos, noticias, beneficios).
// Mismo modelo de aislamiento que promocionActions: cada empresa administra
// únicamente sus publicaciones.

export interface PostState {
  error?: string
  success?: boolean
}

const TIPOS: PostTipo[] = ['EVENTO', 'NOTICIA', 'BENEFICIO']

const TIPO_NOTIF: Record<PostTipo, { titulo: string }> = {
  EVENTO: { titulo: '¡Nuevo evento!' },
  NOTICIA: { titulo: 'Novedad de la empresa' },
  BENEFICIO: { titulo: '¡Nuevo beneficio para miembros!' },
}

function parsePost(formData: FormData) {
  const tipo = String(formData.get('tipo') ?? '') as PostTipo
  const titulo = String(formData.get('titulo') ?? '').trim()
  const contenido = String(formData.get('contenido') ?? '').trim()
  const imagenUrl = String(formData.get('imagenUrl') ?? '').trim() || null
  const lugar = String(formData.get('lugar') ?? '').trim() || null
  const campanaRaw = String(formData.get('campanaId') ?? '').trim()
  const campanaId = campanaRaw && campanaRaw !== 'none' ? campanaRaw : null
  const fechaEventoRaw = String(formData.get('fechaEvento') ?? '').trim()
  const fechaEvento = fechaEventoRaw ? new Date(fechaEventoRaw) : null

  if (!TIPOS.includes(tipo)) return { error: 'Tipo de publicación inválido.' as const }
  if (!titulo || !contenido) {
    return { error: 'Título y contenido son obligatorios.' as const }
  }
  if (tipo === 'EVENTO' && !fechaEvento) {
    return { error: 'Los eventos requieren fecha.' as const }
  }

  return {
    data: {
      tipo,
      titulo,
      contenido,
      imagenUrl,
      lugar: tipo === 'EVENTO' ? lugar : null,
      fechaEvento: tipo === 'EVENTO' ? fechaEvento : null,
      campanaId,
    },
  }
}

/** Valida que la campaña exista y pertenezca a la empresa. */
async function validarCampana(
  campanaId: string | null,
  companyId: string
): Promise<string | null> {
  if (!campanaId) return null
  const campana = await conEmpresa(companyId, (tx) =>
    tx.campana.findUnique({
      where: { id: campanaId },
      select: { companyId: true },
    })
  )
  if (!campana || campana.companyId !== companyId) return 'Campaña inválida.'
  return null
}

function revalidatePosts() {
  revalidatePath('/admin/publicaciones')
  revalidatePath('/empresas', 'layout')
}

export async function crearPost(
  _prev: PostState,
  formData: FormData
): Promise<PostState> {
  const user = await requireSection('publicaciones')
  if (!user) return { error: 'No autorizado.' }

  const companyId =
    // Superadmin: companyId del form o, si no viene, la empresa ACTIVA del
    // selector del panel. Staff: siempre la de su sesión.
    (await resolveCompanyId(user, formData)) ?? ''
  if (!companyId) return { error: 'Empresa requerida.' }

  const parsed = parsePost(formData)
  if ('error' in parsed) return { error: parsed.error }

  const campanaError = await validarCampana(parsed.data.campanaId, companyId)
  if (campanaError) return { error: campanaError }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.companyPost.create({
        data: { companyId, ...parsed.data },
      })
    )

    // Solo los seguidores reciben la notificación.
    await notificarSeguidoresEmpresa(companyId, {
      tipo: 'SISTEMA',
      titulo: TIPO_NOTIF[parsed.data.tipo].titulo,
      mensaje: parsed.data.titulo,
      href: '/cliente/empresas',
    })

    revalidatePosts()
    return { success: true }
  } catch (e) {
    console.error('[post] crear', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function actualizarPost(
  _prev: PostState,
  formData: FormData
): Promise<PostState> {
  const user = await requireSection('publicaciones')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Publicación no especificada.' }

  const parsed = parsePost(formData)
  if ('error' in parsed) return { error: parsed.error }

  const activo = String(formData.get('activo') ?? 'true') === 'true'

  try {
    const post = await sinEmpresa('publicación por id sin conocer la empresa', (tx) =>
      tx.companyPost.findUnique({
        where: { id },
        select: { companyId: true },
      })
    )
    if (!post) return { error: 'Publicación no encontrada.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      post.companyId !== user.metadata.companyId
    ) {
      return { error: 'No autorizado.' }
    }

    const campanaError = await validarCampana(parsed.data.campanaId, post.companyId)
    if (campanaError) return { error: campanaError }

    await conEmpresa(post.companyId, (tx) =>
      tx.companyPost.update({
        where: { id },
        data: { ...parsed.data, activo },
      })
    )

    revalidatePosts()
    return { success: true }
  } catch (e) {
    console.error('[post] actualizar', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}

export async function eliminarPost(
  _prev: PostState,
  formData: FormData
): Promise<PostState> {
  const user = await requireSection('publicaciones')
  if (!user) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Publicación no especificada.' }

  try {
    const post = await sinEmpresa('publicación por id sin conocer la empresa', (tx) =>
      tx.companyPost.findUnique({
        where: { id },
        select: { companyId: true },
      })
    )
    if (!post) return { error: 'Publicación no encontrada.' }
    if (
      user.metadata.role !== 'SUPERADMIN' &&
      post.companyId !== user.metadata.companyId
    ) {
      return { error: 'No autorizado.' }
    }

    await conEmpresa(post.companyId, (tx) => tx.companyPost.delete({ where: { id } }))

    revalidatePosts()
    return { success: true }
  } catch (e) {
    console.error('[post] eliminar', e)
    return { error: 'Ocurrió un error. Intenta de nuevo.' }
  }
}
