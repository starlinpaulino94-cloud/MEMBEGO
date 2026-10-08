import 'server-only'

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { crearNotificacion, notificarAdmins } from '@/modules/notificaciones/service'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { AUTOMATION_EVENTS } from '@/lib/automation/domain/events'
import { formatearMonto } from './formato'

/**
 * COMMERCE CORE · pedidos — AVISOS Y EVENTOS tras cada paso del pedido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE Y POR QUÉ ASÍ
 *
 * Hasta aquí solo la EMPRESA se enteraba de algo (y solo del pedido nuevo). El
 * cliente que pedía no recibía ni «recibido», ni «listo», ni «cancelado»: tenía
 * que entrar a «Mis pedidos» a mirar. Esto cierra las dos mitades con la
 * infraestructura que ya existe:
 *
 *  · `Notificacion` (campanita) para la persona, con `dedupeKey` por hecho:
 *    repetir la acción no repite el aviso.
 *  · `DomainEvent` (bus de estrategias/automatizaciones y webhooks salientes)
 *    con los eventos de Commerce Core de `AUTOMATION_EVENTS`.
 *
 * Todo es BEST-EFFORT y se llama DESPUÉS de confirmar la transacción del
 * pedido: un aviso que falla nunca deshace un pedido, y un pedido que se
 * deshizo nunca produce un aviso. Por eso estas funciones no reciben `tx`.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type PasoDelPedido = 'RECIBIDO' | 'ACEPTADO' | 'AJUSTADO' | 'LISTO' | 'COMPLETADO' | 'CANCELADO' | 'REEMBOLSADO'

const EVENTO_POR_PASO: Partial<Record<PasoDelPedido, string>> = {
  RECIBIDO: AUTOMATION_EVENTS.ORDER_PLACED,
  ACEPTADO: AUTOMATION_EVENTS.ORDER_ACCEPTED,
  LISTO: AUTOMATION_EVENTS.ORDER_READY,
  COMPLETADO: AUTOMATION_EVENTS.ORDER_COMPLETED,
  CANCELADO: AUTOMATION_EVENTS.ORDER_CANCELLED,
  REEMBOLSADO: AUTOMATION_EVENTS.ORDER_REFUNDED,
}

interface PedidoParaAviso {
  id: string
  code: string
  status: string
  origin: string
  total: string
  currency: string
  cancelReason: string | null
  empresa: string
  sucursal: string
  /** Usuario de la app del cliente, si la ficha tiene cuenta (los de mostrador no). */
  userId: string | null
  /** Variantes del pedido, para el aviso de stock bajo. */
  varianteIds: string[]
  /** Si el pedido nació de una oferta del catálogo: su reclamo. */
  reclamo: { id: string; dealId: string } | null
}

async function leerPedido(companyId: string, pedidoId: string): Promise<PedidoParaAviso | null> {
  const p = await conEmpresa(companyId, (tx) =>
    tx.membegoOrder.findFirst({
      where: { id: pedidoId, companyId },
      select: {
        id: true,
        code: true,
        status: true,
        origin: true,
        total: true,
        currency: true,
        cancelReason: true,
        company: { select: { name: true } },
        location: { select: { nombre: true } },
        customer: { select: { supabaseId: true } },
        lines: { select: { catalogVariantId: true } },
        dealClaim: { select: { id: true, dealId: true } },
      },
    })
  )
  if (!p) return null
  // Los clientes de MOSTRADOR llevan `local:` y no tienen cuenta en la app.
  const supabaseId = p.customer.supabaseId
  const user = supabaseId.startsWith('local:')
    ? null
    : await sinEmpresa('pedidos: usuario de la app del cliente (para avisarle)', (tx) => tx.user.findUnique({ where: { supabaseId }, select: { id: true } }))
  return {
    id: p.id,
    code: p.code,
    status: p.status,
    origin: p.origin,
    total: p.total.toFixed(2),
    currency: p.currency,
    cancelReason: p.cancelReason,
    empresa: p.company.name,
    sucursal: p.location.nombre,
    userId: user?.id ?? null,
    varianteIds: p.lines.map((l) => l.catalogVariantId),
    reclamo: p.dealClaim ? { id: p.dealClaim.id, dealId: p.dealClaim.dealId } : null,
  }
}

/** Texto para el CLIENTE en cada paso. `null` = en ese paso no se le avisa. */
export function textoParaElCliente(paso: PasoDelPedido, p: Pick<PedidoParaAviso, 'code' | 'empresa' | 'sucursal' | 'total' | 'currency' | 'cancelReason'>): { titulo: string; mensaje: string } | null {
  const monto = formatearMonto(p.total, p.currency)
  switch (paso) {
    case 'RECIBIDO':
      return { titulo: 'Pedido recibido', mensaje: `${p.empresa} recibió tu pedido ${p.code} por ${monto}. Te avisamos cuando lo acepte.` }
    case 'ACEPTADO':
      return { titulo: 'Pedido confirmado', mensaje: `${p.empresa} aceptó tu pedido ${p.code} y lo está preparando.` }
    case 'AJUSTADO':
      return { titulo: 'Confirma el monto de tu pedido', mensaje: `${p.empresa} ajustó el monto del pedido ${p.code}: ahora es ${monto}. Entra para confirmarlo.` }
    case 'LISTO':
      return { titulo: 'Tu pedido está listo', mensaje: `Recoge el pedido ${p.code} en ${p.sucursal} con el QR de la app.` }
    case 'COMPLETADO':
      return { titulo: 'Pedido completado', mensaje: `Gracias por tu compra en ${p.empresa}. El pedido ${p.code} quedó completado.` }
    case 'CANCELADO':
      return { titulo: 'Pedido cancelado', mensaje: `El pedido ${p.code} en ${p.empresa} se canceló${p.cancelReason ? `: ${p.cancelReason}` : '.'}` }
    case 'REEMBOLSADO':
      return { titulo: 'Pedido reembolsado', mensaje: `${p.empresa} reembolsó el pedido ${p.code} por ${monto}.` }
  }
}

/** Texto para la EMPRESA en los pasos que no provoca ella misma. `null` = no se le avisa. */
export function textoParaLaEmpresa(paso: PasoDelPedido, por: 'CLIENTE' | 'EMPRESA' | 'SISTEMA', p: Pick<PedidoParaAviso, 'code' | 'total' | 'currency' | 'cancelReason'>): { titulo: string; mensaje: string } | null {
  const monto = formatearMonto(p.total, p.currency)
  if (paso === 'RECIBIDO') return { titulo: 'Nuevo pedido Membego', mensaje: `Llegó el pedido ${p.code} por ${monto}. Acéptalo para empezar a atenderlo.` }
  if (paso === 'CANCELADO' && por === 'CLIENTE') return { titulo: 'Un cliente canceló su pedido', mensaje: `El pedido ${p.code} se canceló${p.cancelReason ? `: ${p.cancelReason}` : '.'} El stock apartado volvió a estar disponible.` }
  if (paso === 'CANCELADO' && por === 'SISTEMA') return { titulo: 'Pedido cancelado por falta de respuesta', mensaje: `El pedido ${p.code} llevaba demasiado tiempo sin aceptarse y se canceló solo.` }
  if (paso === 'COMPLETADO') return { titulo: 'Pedido entregado', mensaje: `El pedido ${p.code} por ${monto} se completó con el QR del cliente.` }
  return null
}

/**
 * Avisa a quien corresponda y emite el evento del paso. Llamar DESPUÉS de la
 * transacción. Nunca lanza.
 */
export async function avisarPasoDelPedido(companyId: string, pedidoId: string, paso: PasoDelPedido, por: 'CLIENTE' | 'EMPRESA' | 'SISTEMA'): Promise<void> {
  try {
    const p = await leerPedido(companyId, pedidoId)
    if (!p) return
    const tareas: Promise<unknown>[] = []

    const alCliente = textoParaElCliente(paso, p)
    if (alCliente && p.userId) {
      tareas.push(crearNotificacion({ userId: p.userId, tipo: 'SISTEMA', ...alCliente, href: `/cliente/pedidos/${p.id}`, dedupeKey: `pedido:${p.id}:${paso}` }))
    }
    const aLaEmpresa = textoParaLaEmpresa(paso, por, p)
    if (aLaEmpresa) {
      tareas.push(notificarAdmins(companyId, { tipo: 'SISTEMA', ...aLaEmpresa, href: `/admin/pedidos-membego/${p.id}`, dedupeKey: `pedido:${p.id}:${paso}` }))
    }
    const tipo = EVENTO_POR_PASO[paso]
    if (tipo) {
      tareas.push(
        emitirEventoEstrategia({
          companyId,
          type: tipo,
          subjectId: p.id,
          payload: { pedido: { id: p.id, code: p.code, total: p.total, moneda: p.currency, origen: p.origin, estado: p.status, por } },
        })
      )
    }
    // «Obtenida» ≠ «canjeada»: la oferta se da por canjeada SOLO cuando el pedido se completa con el QR.
    if (paso === 'COMPLETADO' && p.reclamo) {
      tareas.push(
        emitirEventoEstrategia({
          companyId,
          type: AUTOMATION_EVENTS.DEAL_REDEEMED,
          subjectId: p.reclamo.dealId,
          payload: { oferta: p.reclamo.dealId, reclamo: p.reclamo.id, pedido: p.id },
        })
      )
    }
    await Promise.allSettled(tareas)
  } catch (e) {
    console.error('[pedidos:avisos]', paso, pedidoId, e instanceof Error ? e.message : e)
  }
}

/** Las variantes de un pedido (para revisar stock bajo tras apartar o vender). Nunca lanza. */
export async function variantesDelPedido(companyId: string, pedidoId: string): Promise<string[]> {
  try {
    const p = await leerPedido(companyId, pedidoId)
    return p?.varianteIds ?? []
  } catch {
    return []
  }
}
