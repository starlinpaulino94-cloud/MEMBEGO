import 'server-only'
import { sinEmpresa } from '@/lib/tenant'
import { montoDeObjetivo, type ObjetivoPago } from '@/modules/pagos/cardnet3ds'
import type { SessionUser } from '@/types'

export type TargetInfo = {
  readonly companyId: string
  readonly clienteId: string
  readonly email: string
  readonly cardnetCustomerId: string | null
  readonly amount: number
  readonly allowRenewalConsent: boolean
  readonly membershipId?: string
  readonly compraId?: string
}

export type TargetResolution =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ineligible' }
  | { readonly kind: 'ready'; readonly target: TargetInfo }

type OwnedTargetCandidate = Omit<TargetInfo, 'amount'>

type TargetCandidate =
  | { readonly kind: 'ineligible' }
  | { readonly kind: 'owned'; readonly target: OwnedTargetCandidate }

export async function resolveTarget(
  user: SessionUser,
  input: {
    readonly membershipId?: string
    readonly compraId?: string
  }
): Promise<TargetResolution> {
  const candidate = await sinEmpresa(
    'CardNET cliente: resolver objetivo y dueño autenticado antes de reservar captura',
    async (tx): Promise<TargetCandidate | null> => {
      if (input.membershipId) {
        const membership = await tx.membership.findUnique({
          where: { id: input.membershipId },
          select: {
            id: true,
            companyId: true,
            clienteId: true,
            estado: true,
            planIdSolicitado: true,
            comprobanteUrl: true,
            cliente: {
              select: {
                supabaseId: true,
                companyId: true,
                email: true,
                cardnetCustomerId: true,
                esLocal: true,
              },
            },
          },
        })
        if (
          !membership ||
          membership.cliente.supabaseId !== user.supabaseId ||
          membership.cliente.esLocal ||
          membership.companyId !== membership.cliente.companyId
        ) return null
        return {
          kind: 'owned',
          target: {
            companyId: membership.companyId,
            clienteId: membership.clienteId,
            email: membership.cliente.email,
            cardnetCustomerId: membership.cliente.cardnetCustomerId,
            allowRenewalConsent:
              membership.comprobanteUrl === null &&
              membership.planIdSolicitado === null &&
              (membership.estado === 'PENDIENTE' || membership.estado === 'RECHAZADA'),
            membershipId: membership.id,
          },
        }
      }
      if (input.compraId) {
        const compra = await tx.productoCompra.findUnique({
          where: { id: input.compraId },
          select: {
            id: true,
            companyId: true,
            clienteId: true,
            tipo: true,
            estado: true,
            cliente: {
              select: {
                supabaseId: true,
                companyId: true,
                email: true,
                cardnetCustomerId: true,
                esLocal: true,
              },
            },
          },
        })
        if (
          !compra ||
          compra.cliente.supabaseId !== user.supabaseId ||
          compra.cliente.esLocal ||
          compra.companyId !== compra.cliente.companyId
        ) return null
        if (compra.tipo !== 'PROMOCION' || compra.estado !== 'PENDIENTE_PAGO') {
          return { kind: 'ineligible' as const }
        }
        return {
          kind: 'owned',
          target: {
            companyId: compra.companyId,
            clienteId: compra.clienteId,
            email: compra.cliente.email,
            cardnetCustomerId: compra.cliente.cardnetCustomerId,
            allowRenewalConsent: false,
            compraId: compra.id,
          },
        }
      }
      return null
    }
  ).catch(() => null)
  if (!candidate) return { kind: 'missing' }
  if (candidate.kind === 'ineligible') return candidate
  const target = candidate.target
  if (!target.email.trim()) return { kind: 'ineligible' }

  const objetivo: ObjetivoPago = {
    companyId: target.companyId,
    clienteId: target.clienteId,
    ...(target.membershipId ? { membershipId: target.membershipId } : {}),
    ...(target.compraId ? { compraId: target.compraId } : {}),
  }
  const monto = await montoDeObjetivo(objetivo).catch(() => ({ ok: false as const, motivo: 'No encontrado.' }))
  if (!monto.ok || monto.pesos <= 0 || !Number.isFinite(monto.pesos)) return { kind: 'ineligible' }
  return { kind: 'ready', target: { ...target, amount: monto.pesos } }
}
