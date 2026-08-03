'use server'

/**
 * Growth Engine 3.0 · Server Actions.
 *
 * Cliente: generar su enlace de invitación (con beneficio y duración).
 * Admin: configurar el programa (GrowthConfig) y las reglas de recompensa
 * (GrowthRule) — 100% configurables por empresa (req #9, #12).
 */

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { companyFilter } from '@/modules/admin/queries'
import { getAppUrl } from '@/lib/site'
import { crearGrowthLink } from './links'
import { DURACION_HORAS_VALIDAS } from './config'
import { leerRegla } from './reglas'

// ── Cliente: generar enlace de invitación ────────────────────────────────────

export interface GenerarLinkState {
  ok?: boolean
  url?: string
  error?: string
}

export async function generarGrowthLinkAction(
  _prev: GenerarLinkState,
  formData: FormData
): Promise<GenerarLinkState> {
  const user = await requireRole('CLIENTE')
  const clienteId = user.metadata.clienteId
  const companyId = user.metadata.companyId
  if (!clienteId || !companyId) return { error: 'Tu cuenta no está lista para invitar.' }

  const promocionId = String(formData.get('promocionId') ?? '').trim() || null
  const canal = String(formData.get('canal') ?? '').trim() || null
  const duracionRaw = Number(formData.get('duracionHoras') ?? 0)
  const duracionHoras = DURACION_HORAS_VALIDAS.includes(duracionRaw) ? duracionRaw : undefined

  // Verifica que la promoción (si se eligió) sea de la empresa del cliente.
  if (promocionId) {
    const promo = await prisma.promocion.findFirst({
      where: { id: promocionId, companyId },
      select: { id: true },
    })
    if (!promo) return { error: 'La promoción seleccionada no es válida.' }
  }

  try {
    const link = await crearGrowthLink({ clienteId, companyId, promocionId, canal, duracionHoras })
    return { ok: true, url: `${getAppUrl()}/r/${link.code}` }
  } catch (e) {
    console.error('[growth] generarGrowthLinkAction', e)
    return { error: 'No se pudo generar tu enlace. Intenta de nuevo.' }
  }
}

// ── Admin: configuración del programa por empresa ─────────────────────────────

function boolFrom(formData: FormData, name: string): boolean {
  // Campo con hidden "off" + checkbox "on": gana el último valor.
  return formData.getAll(name).at(-1) === 'on'
}

export async function guardarGrowthConfigAction(formData: FormData): Promise<void> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user) ?? String(formData.get('companyId') ?? '')
  if (!companyId) return

  const data = {
    landingActiva: boolFrom(formData, 'landingActiva'),
    duracionHorasDefault: (() => {
      const v = Number(formData.get('duracionHorasDefault') ?? 24)
      return DURACION_HORAS_VALIDAS.includes(v) ? v : 24
    })(),
    premiaClic: boolFrom(formData, 'premiaClic'),
    premiaRegistro: boolFrom(formData, 'premiaRegistro'),
    premiaMembresia: boolFrom(formData, 'premiaMembresia'),
    premiaCompra: boolFrom(formData, 'premiaCompra'),
    premiaRenovacion: boolFrom(formData, 'premiaRenovacion'),
  }

  await prisma.growthConfig.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  })
  revalidatePath('/admin/crecimiento')
}

// ── Admin: reglas de recompensa configurables ─────────────────────────────────

export interface ReglaState {
  error?: string
  ok?: boolean
}

/**
 * Dueño de la regla + validación de que la promoción elegida es de la misma
 * empresa. Se comparte entre crear y editar para que la barrera multiempresa
 * sea una sola y no dos que puedan divergir.
 */
async function promocionAjena(
  companyId: string,
  promocionId: string | null
): Promise<boolean> {
  if (!promocionId) return false
  const promo = await prisma.promocion.findFirst({
    where: { id: promocionId, companyId },
    select: { id: true },
  })
  return !promo
}

export async function crearGrowthRuleAction(
  _prev: ReglaState,
  formData: FormData
): Promise<ReglaState> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user) ?? String(formData.get('companyId') ?? '')
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

  const lectura = leerRegla(formData)
  if (!lectura.ok) return { error: lectura.error }

  if (await promocionAjena(companyId, lectura.datos.recompensaPromocionId)) {
    return { error: 'El beneficio elegido no pertenece a tu empresa.' }
  }

  try {
    await prisma.growthRule.create({ data: { companyId, ...lectura.datos } })
  } catch (e) {
    console.error('[growth] crearGrowthRuleAction', e)
    return { error: 'No se pudo guardar la regla. Intenta de nuevo.' }
  }

  revalidatePath('/admin/crecimiento')
  revalidatePath('/admin/crecimiento/recompensas')
  return { ok: true }
}

export async function actualizarGrowthRuleAction(
  _prev: ReglaState,
  formData: FormData
): Promise<ReglaState> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Falta la regla a editar.' }

  const regla = await prisma.growthRule.findUnique({
    where: { id },
    select: { companyId: true },
  })
  if (!regla) return { error: 'Esa regla ya no existe.' }
  if (companyId && regla.companyId !== companyId) return { error: 'No autorizado.' }

  const lectura = leerRegla(formData)
  if (!lectura.ok) return { error: lectura.error }

  if (await promocionAjena(regla.companyId, lectura.datos.recompensaPromocionId)) {
    return { error: 'El beneficio elegido no pertenece a tu empresa.' }
  }

  try {
    await prisma.growthRule.update({ where: { id }, data: lectura.datos })
  } catch (e) {
    console.error('[growth] actualizarGrowthRuleAction', e)
    return { error: 'No se pudo guardar la regla. Intenta de nuevo.' }
  }

  revalidatePath('/admin/crecimiento')
  revalidatePath('/admin/crecimiento/recompensas')
  return { ok: true }
}

export async function toggleGrowthRuleAction(formData: FormData): Promise<void> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const rule = await prisma.growthRule.findUnique({ where: { id }, select: { companyId: true, activo: true } })
  if (!rule) return
  if (companyId && rule.companyId !== companyId) return
  await prisma.growthRule.update({ where: { id }, data: { activo: !rule.activo } })
  revalidatePath('/admin/crecimiento')
  revalidatePath('/admin/crecimiento/recompensas')
}

export async function eliminarGrowthRuleAction(formData: FormData): Promise<void> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const rule = await prisma.growthRule.findUnique({ where: { id }, select: { companyId: true } })
  if (!rule) return
  if (companyId && rule.companyId !== companyId) return
  await prisma.growthRule.delete({ where: { id } })
  revalidatePath('/admin/crecimiento')
  revalidatePath('/admin/crecimiento/recompensas')
}
