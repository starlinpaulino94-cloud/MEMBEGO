import type { NotifTipo } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { FULL_ADMIN_ROLES } from '@/types'
import type { EfectoAEntregar, EjecutorDeEfecto, ResultadoDeEfecto } from '@/modules/supply-v2/operations/worker'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · efectos del outbox de las visitas (§50–§51, §57–§58).
 *
 * Los eventos de dominio salen del outbox transaccional de Supply (misma
 * transacción que la operación). Aquí está QUÉ hace cada uno al entregarse:
 * un aviso al cliente, un aviso al proveedor, o nada más que quedar
 * registrado (los eventos de integración). Sin ejecutor, el outbox lo manda a
 * la cola de difuntos: por eso TODOS los tipos emitidos tienen el suyo.
 *
 * Los avisos usan `Notificacion` con `dedupeKey` = la clave del efecto: un
 * reintento no duplica el aviso (P2002 = ya estaba).
 */

const dinero = (n: unknown, moneda: unknown) => `${moneda === 'DOP' || !moneda ? 'RD$' : `${String(moneda)} `}${Number(n ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 0 })}`

function payloadDe(e: EfectoAEntregar): Record<string, unknown> {
  return e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : {}
}

async function avisar(userId: string, aviso: { tipo: NotifTipo; titulo: string; mensaje: string; href: string }, dedupeKey: string): Promise<ResultadoDeEfecto> {
  try {
    await sinEmpresa('Visitas Membego: aviso al usuario', (tx) => tx.notificacion.create({ data: { userId, tipo: aviso.tipo, titulo: aviso.titulo, mensaje: aviso.mensaje, href: aviso.href, dedupeKey } }))
    return { detalle: `aviso ${aviso.tipo} a ${userId}` }
  } catch (e) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code?: string }).code === 'P2002') return { detalle: 'el aviso ya estaba' }
    throw e
  }
}

export async function avisarAdminsDeEmpresa(companyId: string, aviso: { tipo: NotifTipo; titulo: string; mensaje: string; href: string }, dedupeKey: string): Promise<ResultadoDeEfecto> {
  const admins = await sinEmpresa('Visitas Membego: administradores del proveedor a avisar', (tx) =>
    tx.user.findMany({ where: { companyId, role: { in: FULL_ADMIN_ROLES } }, select: { id: true } })
  )
  let n = 0
  for (const a of admins) {
    const r = await avisar(a.id, aviso, `${dedupeKey}:${a.id}`)
    if (!r.detalle.includes('ya estaba')) n++
  }
  return { detalle: `${n} aviso(s) a la empresa ${companyId}` }
}

const registrado = async (): Promise<ResultadoDeEfecto> => ({ detalle: 'evento de dominio registrado' })

export const EFECTOS_DE_VISITA: Record<string, EjecutorDeEfecto> = {
  // Integración/analítica: quedan en el outbox como historia; no avisan a nadie.
  'visit.opened': registrado,
  'commission.created': registrado,
  'ancillary_sale.confirmed': registrado,
  'visit.dispute_resolved': async (e) => {
    const p = payloadDe(e)
    const userId = String(p.customerUserId ?? '')
    if (!userId) return registrado()
    const favorable = p.resolucion === 'RESOLVED_CUSTOMER'
    return avisar(userId, {
      tipo: 'VISITA_DISPUTA',
      titulo: favorable ? 'Resolvimos tu reporte a tu favor' : 'Revisamos tu reporte',
      mensaje: favorable ? 'Ajustamos lo reportado por el negocio según lo que nos contaste.' : 'Revisamos tu reporte con el negocio. Si tienes más información, escríbenos.',
      href: `/cliente/visitas/${String(p.visitId ?? e.aggregateId)}`,
    }, e.idempotencyKey)
  },

  // El cliente: «Tu visita fue completada. ¿Es correcto?» (§33, §51).
  'visit.closed': async (e) => {
    const p = payloadDe(e)
    const userId = String(p.customerUserId ?? '')
    if (!userId) return registrado()
    const total = Number(p.ancillaryTotal ?? 0)
    if (total <= 0) {
      return avisar(userId, { tipo: 'SUPPLY_ENTREGA_COMPLETADA', titulo: 'Canje realizado', mensaje: `Tu beneficio de Membego fue entregado (visita ${String(p.number ?? '')}).`, href: `/cliente/visitas/${e.aggregateId}` }, e.idempotencyKey)
    }
    return avisar(userId, {
      tipo: 'VISITA_CONFIRMA_CONSUMO',
      titulo: 'Confirma tu consumo',
      mensaje: `Tu visita fue completada. El negocio reportó compras adicionales por ${dinero(p.ancillaryTotal, p.currency)}. ¿Es correcto?`,
      href: `/cliente/visitas/${e.aggregateId}`,
    }, e.idempotencyKey)
  },

  'ancillary_sale.recorded': async (e) => {
    const p = payloadDe(e)
    const userId = String(p.customerUserId ?? '')
    if (!userId) return registrado()
    return avisar(userId, {
      tipo: 'VISITA_COMPRA_ADICIONAL',
      titulo: 'Compra adicional registrada',
      mensaje: `El negocio registró una compra adicional por ${dinero(p.subtotal, 'DOP')} en tu visita. Podrás confirmarla al cerrar la visita.`,
      href: `/cliente/visitas/${String(p.visitId ?? '')}`,
    }, e.idempotencyKey)
  },

  'ancillary_sale.reversed': async (e) => {
    const p = payloadDe(e)
    const userId = String(p.customerUserId ?? '')
    if (!userId) return registrado()
    return avisar(userId, { tipo: 'VISITA_COMPRA_ADICIONAL', titulo: 'Compra adicional anulada', mensaje: `Se anuló una compra adicional por ${dinero(p.subtotal, 'DOP')} de tu visita.`, href: `/cliente/visitas/${String(p.visitId ?? '')}` }, e.idempotencyKey)
  },

  // El proveedor: una disputa del cliente (§50).
  'visit.disputed': async (e) => {
    const p = payloadDe(e)
    const companyId = String(p.companyId ?? '')
    if (!companyId) return registrado()
    return avisarAdminsDeEmpresa(companyId, {
      tipo: 'VISITA_DISPUTA',
      titulo: 'Un cliente reportó un problema con una visita',
      mensaje: `El cliente no reconoce las compras adicionales reportadas en la visita ${String(p.number ?? '')} (${dinero(p.reportedTotal, 'DOP')}). Membego la revisará.`,
      href: '/admin/supply/ventas-adicionales',
    }, e.idempotencyKey)
  },
}
