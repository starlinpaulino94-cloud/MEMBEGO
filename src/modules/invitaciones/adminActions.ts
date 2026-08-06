'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { ADMIN_ROLES } from '@/types'
import {
  INVITA_COMPARTIR_CAMPOS,
  INVITA_CONTENIDO_CAMPOS,
  INVITA_CONTENIDO_DEFAULT,
} from '@/lib/invitaContenido'

export interface CampanaState {
  error?: string
  success?: boolean
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

async function uniqueSlug(base: string): Promise<string> {
  const slug = slugify(base)
  let attempt = 0
  while (true) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt}`
    const exists = await sinEmpresa('invitaciones: verificar slug de campaña único global', (tx) =>
      tx.campanaInvitacion.findUnique({
        where: { slug: candidate },
        select: { id: true },
      })
    )
    if (!exists) return candidate
    attempt++
    if (attempt > 20) return `${slug}-${Date.now()}`
  }
}

/**
 * Recoge los textos editables del módulo del cliente desde el formulario.
 * Solo guarda los que difieren del texto por defecto (para no persistir ruido);
 * si ninguno cambia devuelve null y se usan los valores por defecto.
 */
function parseContenido(fd: FormData): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const { key } of [...INVITA_CONTENIDO_CAMPOS, ...INVITA_COMPARTIR_CAMPOS]) {
    const v = String(fd.get(`contenido_${key}`) ?? '').trim()
    if (v && v !== INVITA_CONTENIDO_DEFAULT[key]) out[key] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

function parseBeneficio(fd: FormData, prefix: string): object {
  // promocionId vincula la recompensa al Motor de Beneficios Digitales (E8):
  // al entregarla se crea un ProductoCompra con QR canjeable en el escáner y
  // visible en la wallet del cliente. Sin él, se registra como BenefitGrant.
  const promocionId = String(fd.get(`${prefix}PromocionId`) ?? '').trim()
  return {
    tipo: String(fd.get(`${prefix}Tipo`) ?? 'SERVICIO_GRATIS'),
    valor: String(fd.get(`${prefix}Valor`) ?? ''),
    descripcion: String(fd.get(`${prefix}Descripcion`) ?? ''),
    vigenciaDias: Number(fd.get(`${prefix}VigenciaDias`) ?? 30),
    ...(promocionId && promocionId !== 'none' ? { promocionId } : {}),
  }
}

export async function crearCampanaInvitacion(
  _prev: CampanaState,
  formData: FormData
): Promise<CampanaState> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await resolveCompanyId(user, formData)
  if (!companyId) return { error: 'Empresa no encontrada.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  const titulo = String(formData.get('titulo') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const textoLanding = String(formData.get('textoLanding') ?? '').trim() || null
  const imagenUrl = String(formData.get('imagenUrl') ?? '').trim() || null
  const bannerUrl = String(formData.get('bannerUrl') ?? '').trim() || null
  const metaRegistros = Number(formData.get('metaRegistros') ?? 10)
  const fechaInicio = String(formData.get('fechaInicio') ?? '')
  const fechaFin = String(formData.get('fechaFin') ?? '')
  const maxPremiosRaw = String(formData.get('maxPremios') ?? '').trim()
  const maxPremios = maxPremiosRaw ? Number(maxPremiosRaw) : null
  const colorPrimario = String(formData.get('colorPrimario') ?? '').trim() || null
  const colorSecundario = String(formData.get('colorSecundario') ?? '').trim() || null
  const usarBanner = formData.get('usarBanner') === 'on'

  if (!nombre || !titulo || !descripcion) {
    return { error: 'Nombre, título y descripción son obligatorios.' }
  }
  if (!metaRegistros || metaRegistros < 1) {
    return { error: 'La meta de registros debe ser al menos 1.' }
  }
  if (!fechaInicio || !fechaFin) {
    return { error: 'Las fechas de inicio y fin son obligatorias.' }
  }
  if (new Date(fechaFin) <= new Date(fechaInicio)) {
    return { error: 'La fecha de fin debe ser posterior al inicio.' }
  }

  const beneficioInvitante = parseBeneficio(formData, 'beneficioInvitante')
  const beneficioInvitado = parseBeneficio(formData, 'beneficioInvitado')
  const contenido = parseContenido(formData)
  const slug = await uniqueSlug(nombre)

  try {
    await conEmpresa(companyId, (tx) =>
      tx.campanaInvitacion.create({
        data: {
          companyId,
          slug,
          nombre,
          titulo,
          descripcion,
          textoLanding,
          imagenUrl,
          bannerUrl,
          metaRegistros,
          beneficioInvitante: beneficioInvitante as object,
          beneficioInvitado: beneficioInvitado as object,
          fechaInicio: new Date(fechaInicio),
          fechaFin: new Date(fechaFin),
          maxPremios,
          colorPrimario,
          colorSecundario,
          usarBanner,
          contenido: contenido ?? undefined,
          estado: 'BORRADOR',
        },
      })
    )

    revalidatePath('/admin/invitaciones')
    return { success: true }
  } catch (e) {
    console.error('[invitaciones] crear error:', e)
    return { error: 'No se pudo crear la campaña.' }
  }
}

export async function actualizarCampanaInvitacion(
  _prev: CampanaState,
  formData: FormData
): Promise<CampanaState> {
  await requireRole(ADMIN_ROLES)
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'ID de campaña requerido.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  const titulo = String(formData.get('titulo') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const textoLanding = String(formData.get('textoLanding') ?? '').trim() || null
  const imagenUrl = String(formData.get('imagenUrl') ?? '').trim() || null
  const bannerUrl = String(formData.get('bannerUrl') ?? '').trim() || null
  const metaRegistros = Number(formData.get('metaRegistros') ?? 10)
  const fechaInicio = String(formData.get('fechaInicio') ?? '')
  const fechaFin = String(formData.get('fechaFin') ?? '')
  const maxPremiosRaw = String(formData.get('maxPremios') ?? '').trim()
  const maxPremios = maxPremiosRaw ? Number(maxPremiosRaw) : null
  const colorPrimario = String(formData.get('colorPrimario') ?? '').trim() || null
  const colorSecundario = String(formData.get('colorSecundario') ?? '').trim() || null
  const usarBanner = formData.get('usarBanner') === 'on'

  if (!nombre || !titulo || !descripcion) {
    return { error: 'Nombre, título y descripción son obligatorios.' }
  }

  const beneficioInvitante = parseBeneficio(formData, 'beneficioInvitante')
  const beneficioInvitado = parseBeneficio(formData, 'beneficioInvitado')
  const contenido = parseContenido(formData)

  try {
    const campana = await sinEmpresa('invitaciones: buscar campaña por id (empresa desconocida)', (tx) =>
      tx.campanaInvitacion.findUnique({ where: { id }, select: { companyId: true } })
    )
    if (!campana) return { error: 'Campaña no encontrada.' }
    await conEmpresa(campana.companyId, (tx) =>
      tx.campanaInvitacion.update({
        where: { id },
        data: {
          nombre,
          titulo,
          descripcion,
          textoLanding,
          imagenUrl,
          bannerUrl,
          metaRegistros,
          beneficioInvitante: beneficioInvitante as object,
          beneficioInvitado: beneficioInvitado as object,
          fechaInicio: new Date(fechaInicio),
          fechaFin: new Date(fechaFin),
          maxPremios,
          colorPrimario,
          colorSecundario,
          usarBanner,
          // null limpia los textos personalizados → vuelve a los valores por defecto.
          contenido: contenido ?? (Prisma.DbNull as never),
        },
      })
    )

    revalidatePath('/admin/invitaciones')
    return { success: true }
  } catch (e) {
    console.error('[invitaciones] actualizar error:', e)
    return { error: 'No se pudo actualizar la campaña.' }
  }
}

export async function cambiarEstadoCampana(
  id: string,
  estado: 'ACTIVA' | 'PAUSADA' | 'FINALIZADA'
): Promise<CampanaState> {
  await requireRole(ADMIN_ROLES)

  try {
    const campana = await sinEmpresa('invitaciones: buscar campaña por id (empresa desconocida)', (tx) =>
      tx.campanaInvitacion.findUnique({ where: { id }, select: { companyId: true } })
    )
    if (!campana) return { error: 'Campaña no encontrada.' }
    await conEmpresa(campana.companyId, (tx) =>
      tx.campanaInvitacion.update({
        where: { id },
        data: { estado },
      })
    )
    revalidatePath('/admin/invitaciones')
    return { success: true }
  } catch (e) {
    console.error('[invitaciones] cambiarEstado error:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

export async function eliminarCampana(id: string): Promise<CampanaState> {
  await requireRole(ADMIN_ROLES)

  try {
    const campana = await sinEmpresa('invitaciones: buscar campaña por id (empresa desconocida)', (tx) =>
      tx.campanaInvitacion.findUnique({ where: { id }, select: { companyId: true } })
    )
    if (!campana) return { error: 'Campaña no encontrada.' }
    await conEmpresa(campana.companyId, (tx) => tx.campanaInvitacion.delete({ where: { id } }))
    revalidatePath('/admin/invitaciones')
    return { success: true }
  } catch (e) {
    console.error('[invitaciones] eliminar error:', e)
    return { error: 'No se pudo eliminar la campaña.' }
  }
}
