/**
 * Growth Engine 3.0 · Consultas para paneles (admin y cliente).
 * Server-internal (SIN 'use server').
 */

import { conEmpresa } from '@/lib/tenant'
import { getGrowthConfig, type GrowthConfigResuelta } from './config'

export interface GrowthRuleView {
  id: string
  nombre: string
  trigger: string
  valorCondicion: number
  planId: string | null
  beneficiario: string
  recompensaTipo: string
  recompensaValor: number
  recompensaPromocion: string | null
  activo: boolean
}

export interface GrowthAdminData {
  config: GrowthConfigResuelta
  rules: GrowthRuleView[]
  promos: { id: string; titulo: string }[]
  plans: { id: string; nombre: string }[]
}

/** Datos para el panel de configuración del programa de crecimiento. */
export async function getGrowthAdminData(companyId: string): Promise<GrowthAdminData> {
  const config = await getGrowthConfig(companyId)
  const [rulesRaw, promos, plans] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.growthRule.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        include: { recompensaPromocion: { select: { titulo: true } } },
      }),
      tx.promocion.findMany({
        where: { companyId, activo: true, archivada: false },
        select: { id: true, titulo: true },
        orderBy: { titulo: 'asc' },
      }),
      tx.plan.findMany({
        where: { companyId, activo: true },
        select: { id: true, nombre: true },
        orderBy: { precio: 'asc' },
      }),
    ])
  )

  const rules: GrowthRuleView[] = rulesRaw.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    trigger: r.trigger,
    valorCondicion: r.valorCondicion,
    planId: r.planId,
    beneficiario: r.beneficiario,
    recompensaTipo: r.recompensaTipo,
    recompensaValor: Number(r.recompensaValor),
    recompensaPromocion: r.recompensaPromocion?.titulo ?? null,
    activo: r.activo,
  }))

  return { config, rules, promos, plans }
}

/** Una regla concreta para editarla, ya con la barrera de empresa aplicada. */
export async function getGrowthRule(
  companyId: string,
  id: string
): Promise<{
  id: string
  nombre: string
  trigger: string
  valorCondicion: number
  planId: string | null
  beneficiario: string
  recompensaTipo: string
  recompensaValor: number
  recompensaPromocionId: string | null
} | null> {
  const r = await conEmpresa(companyId, (tx) =>
    tx.growthRule.findFirst({ where: { id, companyId } })
  )
  if (!r) return null
  return {
    id: r.id,
    nombre: r.nombre,
    trigger: r.trigger,
    valorCondicion: r.valorCondicion,
    planId: r.planId,
    beneficiario: r.beneficiario,
    recompensaTipo: r.recompensaTipo,
    recompensaValor: Number(r.recompensaValor),
    recompensaPromocionId: r.recompensaPromocionId,
  }
}

/** Promociones (Beneficios Digitales) que un cliente puede ofrecer al invitar. */
export async function getPromosParaInvitar(
  companyId: string
): Promise<{ id: string; titulo: string }[]> {
  const now = new Date()
  return conEmpresa(companyId, (tx) =>
    tx.promocion.findMany({
      where: {
        companyId,
        activo: true,
        archivada: false,
        OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
      },
      select: { id: true, titulo: true },
      orderBy: { titulo: 'asc' },
      take: 50,
    })
  ).catch(() => [])
}

export interface GrowthWalletView {
  puntos: number
  creditos: number
}

/** Saldo de puntos/créditos del cliente en el programa de la empresa. */
export async function getGrowthWallet(
  companyId: string,
  clienteId: string
): Promise<GrowthWalletView> {
  const w = await conEmpresa(companyId, (tx) =>
    tx.growthWallet.findUnique({ where: { companyId_clienteId: { companyId, clienteId } } })
  ).catch(() => null)
  return { puntos: w?.puntos ?? 0, creditos: Number(w?.creditos ?? 0) }
}

export interface GrowthFunnelView {
  clicks: number
  landing: number
  registros: number
  compras: number
}

/**
 * Embudo real de los enlaces de un referente (Growth Engine), calculado desde
 * los eventos atribuidos a sus GrowthLink.
 */
export async function getGrowthFunnel(
  companyId: string,
  clienteId: string
): Promise<GrowthFunnelView> {
  try {
    const grupos = await conEmpresa(companyId, (tx) =>
      tx.referralEvent.groupBy({
        by: ['tipo'],
        where: { clienteId, companyId, growthLinkId: { not: null } },
        _count: { _all: true },
      })
    )
    const n = (t: string) => grupos.find((g) => g.tipo === t)?._count._all ?? 0
    return {
      clicks: n('CLICK'),
      landing: n('LANDING_VIEW'),
      registros: n('REGISTRO'),
      compras: n('COMPRA') + n('MEMBRESIA'),
    }
  } catch {
    return { clicks: 0, landing: 0, registros: 0, compras: 0 }
  }
}
