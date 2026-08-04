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
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { companyFilter } from '@/modules/admin/queries'
import { getAppUrl } from '@/lib/site'
import { crearGrowthLink } from './links'
import { DURACION_HORAS_VALIDAS } from './config'
import type { GrowthTrigger, GrowthRewardTipo, GrowthBeneficiario } from '@prisma/client'

const TRIGGERS: GrowthTrigger[] = [
  'LINK_ABIERTO', 'REGISTRO', 'VERIFICADO', 'MEMBRESIA', 'COMPRA', 'PRIMER_USO', 'N_REFERIDOS',
]
const TIPOS: GrowthRewardTipo[] = [
  'PUNTOS', 'CREDITOS', 'BENEFICIO', 'LAVADOS_GRATIS', 'DESCUENTO_PORCENTAJE', 'DESCUENTO_MONTO',
]
const BENEFICIARIOS: GrowthBeneficiario[] = ['REFERENTE', 'REFERIDO', 'AMBOS']

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
    const promo = await conEmpresa(companyId, (tx) =>
      tx.promocion.findFirst({
        where: { id: promocionId, companyId },
        select: { id: true },
      })
    )
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

  await conEmpresa(companyId, (tx) =>
    tx.growthConfig.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    })
  )
  revalidatePath('/admin/crecimiento')
}

// ── Admin: reglas de recompensa configurables ─────────────────────────────────

export async function crearGrowthRuleAction(formData: FormData): Promise<void> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user) ?? String(formData.get('companyId') ?? '')
  if (!companyId) return

  const nombre = String(formData.get('nombre') ?? '').trim()
  const trigger = String(formData.get('trigger') ?? '') as GrowthTrigger
  const recompensaTipo = String(formData.get('recompensaTipo') ?? '') as GrowthRewardTipo
  const beneficiario = String(formData.get('beneficiario') ?? 'REFERENTE') as GrowthBeneficiario
  const recompensaValor = Number(formData.get('recompensaValor') ?? 0)
  const valorCondicion = Math.max(1, Number(formData.get('valorCondicion') ?? 1))
  const recompensaPromocionId = String(formData.get('recompensaPromocionId') ?? '').trim() || null
  const planId = String(formData.get('planId') ?? '').trim() || null

  if (!nombre || !TRIGGERS.includes(trigger) || !TIPOS.includes(recompensaTipo)) return
  if (!BENEFICIARIOS.includes(beneficiario)) return

  // Si la recompensa es un Beneficio Digital, valida que la promo sea de la empresa.
  if (recompensaTipo === 'BENEFICIO' && recompensaPromocionId) {
    const promo = await conEmpresa(companyId, (tx) =>
      tx.promocion.findFirst({
        where: { id: recompensaPromocionId, companyId },
        select: { id: true },
      })
    )
    if (!promo) return
  }

  await conEmpresa(companyId, (tx) =>
    tx.growthRule.create({
      data: {
        companyId,
        nombre,
        trigger,
        valorCondicion,
        planId,
        beneficiario,
        recompensaTipo,
        recompensaValor,
        recompensaPromocionId: recompensaTipo === 'BENEFICIO' ? recompensaPromocionId : null,
      },
    })
  )
  revalidatePath('/admin/crecimiento')
}

export async function toggleGrowthRuleAction(formData: FormData): Promise<void> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const rule = await sinEmpresa('growth: buscar regla por id (permiso de empresa se valida tras el lookup)', (tx) =>
    tx.growthRule.findUnique({ where: { id }, select: { companyId: true, activo: true } })
  )
  if (!rule) return
  if (companyId && rule.companyId !== companyId) return
  await conEmpresa(rule.companyId, (tx) =>
    tx.growthRule.update({ where: { id }, data: { activo: !rule.activo } })
  )
  revalidatePath('/admin/crecimiento')
}

export async function eliminarGrowthRuleAction(formData: FormData): Promise<void> {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const rule = await sinEmpresa('growth: buscar regla por id (permiso de empresa se valida tras el lookup)', (tx) =>
    tx.growthRule.findUnique({ where: { id }, select: { companyId: true } })
  )
  if (!rule) return
  if (companyId && rule.companyId !== companyId) return
  await conEmpresa(rule.companyId, (tx) => tx.growthRule.delete({ where: { id } }))
  revalidatePath('/admin/crecimiento')
}
