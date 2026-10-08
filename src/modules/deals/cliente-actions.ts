'use server'

/**
 * COMMERCE CORE · ofertas — acción del CLIENTE: «Obtener oferta» (Fase 5).
 *
 * Sesión de cliente obligatoria. Lo que cruza al servicio sale SIEMPRE de la sesión y de la
 * base, nunca del navegador:
 *
 *  · la EMPRESA se deduce de la oferta (no se acepta un `companyId`);
 *  · la FICHA de cliente es la de esa persona en esa empresa (se crea si no la tiene: reclamar
 *    es la señal de interés, igual que pedir);
 *  · el PRECIO, el descuento, la cuota y los cupos los pone el servicio desde la base.
 *
 * Reclamar una oferta que ya se tiene NO es un error para la persona: se le lleva a su pedido.
 * Devuelven un resultado, no lanzan.
 */

import { revalidatePath, revalidateTag } from 'next/cache'
import { after } from 'next/server'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { asegurarClienteEnEmpresa } from '@/modules/cliente/afiliacion'
import { NAV_CLIENTE_TAG } from '@/modules/cliente/cacheTags'
import { notificarAdmins } from '@/modules/notificaciones/service'
import { InventarioError } from '@/modules/inventory/errores'
import { PedidoError } from '@/modules/orders/errores'
import { OfertaError } from './errores'
import { refrescarVitrinasDeOfertas } from './vitrinas'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { AUTOMATION_EVENTS } from '@/lib/automation/domain/events'
import { crearNotificacion } from '@/modules/notificaciones/service'
import { empresaOfreceOfertas } from './publico'
import { motivoNoReclamarEnTx, reclamarOfertaEnTx } from './service'

export type ResultadoReclamo =
  | { ok: true; pedidoId: string; code: string | null; repetido: boolean; ahorro: string | null }
  | { ok: false; error: string; sinSesion?: boolean }

function aError(e: unknown): { ok: false; error: string } {
  if (e instanceof OfertaError || e instanceof PedidoError || e instanceof InventarioError) return { ok: false, error: e.message }
  console.error('[deals-cliente]', e instanceof Error ? e.message : e)
  return { ok: false, error: 'No se pudo reclamar la oferta. Intenta de nuevo.' }
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')

/** «Obtener oferta»: reserva la parte del presupuesto y un cupo, y crea el pedido (con su QR) de la oferta. */
export async function reclamarOferta(entrada: { dealId: string; sucursalId: string }): Promise<ResultadoReclamo> {
  try {
    const user = await getUser()
    if (!user) return { ok: false, error: 'Inicia sesión para obtener la oferta.', sinSesion: true }
    if (user.metadata.role !== 'CLIENTE') return { ok: false, error: 'Las ofertas se obtienen con una cuenta de cliente.' }
    if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'Datos no válidos.' }
    if (!(await formSubmitLimiter(user.metadata.dbUserId ?? user.supabaseId))) return { ok: false, error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }

    const dealId = texto(entrada.dealId)
    const sucursalId = texto(entrada.sucursalId)
    if (!dealId) return { ok: false, error: 'La oferta no existe.' }
    if (!sucursalId) return { ok: false, error: 'Elige la sucursal donde la vas a canjear.' }

    // La empresa sale de la oferta, no del navegador.
    const oferta = await sinEmpresa('ofertas: empresa de la oferta reclamada', (tx) =>
      tx.deal.findUnique({ where: { id: dealId }, select: { companyId: true, company: { select: { isPublished: true, isActive: true, esDemo: true } } } })
    )
    const empresa = oferta?.company
    // «No existe» y «no se puede reclamar» se ven igual desde fuera.
    if (!oferta || !empresa || !empresa.isPublished || !empresa.isActive || empresa.esDemo || !(await empresaOfreceOfertas(oferta.companyId))) {
      return { ok: false, error: 'Esta oferta no está disponible.' }
    }
    const companyId = oferta.companyId

    // Afiliar (ficha, seguimiento, regalo de bienvenida) es un efecto: no se hace por una oferta que ni siquiera se puede
    // reclamar. Quien ya es cliente de ese negocio sigue su camino (su ficha ya existe y puede tener ya el cupón).
    const previa = await conEmpresa(companyId, async (tx) => ({
      tieneFicha: (await tx.cliente.findFirst({ where: { companyId, supabaseId: user.supabaseId }, select: { id: true } })) !== null,
      motivo: await motivoNoReclamarEnTx(tx, companyId, dealId),
    }))
    if (!previa.tieneFicha && previa.motivo) return { ok: false, error: previa.motivo.mensaje }

    const ficha = await asegurarClienteEnEmpresa(user.supabaseId, user.email, companyId)
    if ('error' in ficha) return { ok: false, error: ficha.error }

    try {
      const r = await conEmpresa(companyId, (tx) => reclamarOfertaEnTx(tx, companyId, { dealId, customerId: ficha.clienteId, locationId: sucursalId }))
      revalidatePath('/cliente/pedidos', 'layout')
      revalidatePath('/admin/deals', 'layout')
      revalidatePath('/admin/pedidos-membego', 'layout')
      refrescarVitrinasDeOfertas()
      revalidateTag(NAV_CLIENTE_TAG, 'max')
      // Best-effort y DESPUÉS de responder (`after`): un aviso no puede tumbar el reclamo ni perderse al terminar la respuesta.
      after(async () => {
        try {
          await Promise.allSettled([
            notificarAdmins(companyId, {
              tipo: 'SISTEMA',
              titulo: 'Alguien obtuvo una oferta',
              mensaje: `El cupón ${r.orderCode} está listo para canjearse con su QR.`,
              href: `/admin/pedidos-membego/${r.orderId}`,
              dedupeKey: `oferta-reclamada:${r.claimId}`,
            }),
            // Al cliente: su cupón con QR ya existe (es un pedido LISTO).
            user.metadata.dbUserId
              ? crearNotificacion({
                  userId: user.metadata.dbUserId,
                  tipo: 'SISTEMA',
                  titulo: 'Tu oferta está lista',
                  mensaje: `Obtuviste la oferta: el cupón ${r.orderCode} se canjea en el negocio con el QR de tu pedido.`,
                  href: `/cliente/pedidos/${r.orderId}`,
                  dedupeKey: `oferta-obtenida:${r.claimId}`,
                })
              : Promise.resolve(),
            // Bus de dominio: «obtenida» ≠ «canjeada» (el canje lo emite el cierre por QR como pedido.completado + oferta.canjeada).
            emitirEventoEstrategia({ companyId, type: AUTOMATION_EVENTS.DEAL_CLAIMED, subjectId: dealId, payload: { oferta: dealId, reclamo: r.claimId, pedido: r.orderId, ahorro: r.savings } }),
          ])
        } catch (e) {
          console.error('[deals-cliente] aviso a la empresa', e instanceof Error ? e.message : e)
        }
      })
      return { ok: true, pedidoId: r.orderId, code: r.orderCode, repetido: false, ahorro: r.savings }
    } catch (e) {
      // Ya la tenía: se le lleva a su pedido (clic doble, otra pestaña, volver a la oferta).
      if (e instanceof OfertaError && e.codigo === 'YA_RECLAMADA' && e.datos?.orderId) {
        return { ok: true, pedidoId: e.datos.orderId, code: null, repetido: true, ahorro: null }
      }
      throw e
    }
  } catch (e) {
    return aError(e)
  }
}
