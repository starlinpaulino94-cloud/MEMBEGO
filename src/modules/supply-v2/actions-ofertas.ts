'use server'

import { revalidatePath } from 'next/cache'
import type { SupplyV2PaymentMethod } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, entero, fecha, fechaFinDeDia, refrescarSupplyV2, texto, type EstadoAccion } from './actions-util'
import type { SupplyV2AvailabilityMode } from '@prisma/client'
import { cerrarOfertaEnTx, crearOfertaComisionEnTx, crearOfertaEnTx, editarOfertaEnTx, pausarOfertaEnTx, publicarOfertaEnTx, reanudarOfertaEnTx, type OfertaCreada } from './offers/service'
import { confirmarPagoEnTx, rechazarPagoEnTx, type PagoConfirmado } from './commerce/checkout'
import { RUTA_OFERTAS_PUBLICAS } from './core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · server actions de OFERTAS y COBROS (lado plataforma).
 */

function refrescarOfertas(id?: string): void {
  refrescarSupplyV2('ofertas', 'supply', ...(id ? [`ofertas/${id}`] : []))
  revalidatePath('/promociones')
  revalidatePath(RUTA_OFERTAS_PUBLICAS, 'layout')
}

/** El wizard crea y PUBLICA en una sola transacción: sin borradores que bloqueen supply (§12). */
export async function crearYPublicarOfertaAction(_prev: EstadoAccion<OfertaCreada>, fd: FormData): Promise<EstadoAccion<OfertaCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_PUBLISH')
    const ctx = await contextoDeAuditoria(actor)
    const startsAt = fecha(fd, 'startsAt') ?? new Date()
    const quantity = entero(fd, 'quantity')
    if (quantity == null) return { error: 'Indica cuántas unidades destinar.' }
    const r = await sinEmpresa('Supply 2.0: crear y publicar una oferta', async (tx) => {
      const creada = await crearOfertaEnTx(
        tx,
        {
          catalogItemId: texto(fd, 'catalogItemId', 60),
          title: texto(fd, 'title', 160),
          description: texto(fd, 'description', 2000) || null,
          publicPrice: texto(fd, 'publicPrice', 20),
          salePrice: texto(fd, 'salePrice', 20),
          quantity,
          // Vacío = no se toca, NO «vuelve a 1»: reiniciar un límite que nadie
      // escribió sería un cambio silencioso de las reglas de la oferta.
      perCustomerLimit: entero(fd, 'perCustomerLimit') ?? undefined,
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
        },
        ctx
      )
      const pub = await publicarOfertaEnTx(tx, creada.id, ctx)
      return { ...creada, status: pub.status }
    })
    refrescarOfertas(r.id)
    return { success: `Oferta ${r.code} publicada.`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'crearYPublicarOferta')
  }
}

/**
 * Slice 5 (§10–§12): oferta a COMISIÓN. Sin lote ni asignación: lo que se
 * congela es el acuerdo (resuelto en el servidor) y la disponibilidad propia.
 */
export async function crearYPublicarOfertaComisionAction(_prev: EstadoAccion<OfertaCreada>, fd: FormData): Promise<EstadoAccion<OfertaCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_COMMISSION_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const startsAt = fecha(fd, 'startsAt') ?? new Date()
    const availabilityMode = (texto(fd, 'availabilityMode', 20) || 'UNLIMITED') as SupplyV2AvailabilityMode
    const r = await sinEmpresa('Supply 2.0: crear y publicar una oferta a comisión', async (tx) => {
      const creada = await crearOfertaComisionEnTx(
        tx,
        {
          catalogItemId: texto(fd, 'catalogItemId', 60),
          title: texto(fd, 'title', 160),
          description: texto(fd, 'description', 2000) || null,
          publicPrice: texto(fd, 'publicPrice', 20),
          salePrice: texto(fd, 'salePrice', 20),
          availabilityMode,
          availabilityQuantity: availabilityMode === 'UNLIMITED' ? null : entero(fd, 'availabilityQuantity'),
          perCustomerLimit: entero(fd, 'perCustomerLimit') ?? 1,
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
        },
        ctx
      )
      const pub = await publicarOfertaEnTx(tx, creada.id, ctx)
      return { ...creada, status: pub.status }
    })
    refrescarOfertas(r.id)
    return { success: `Oferta a comisión ${r.code} publicada (${r.commissionPercentage} % según el acuerdo ${r.agreementCode}).`, id: r.id, data: r }
  } catch (e) {
    return comoError(e, 'crearYPublicarOfertaComision')
  }
}

export async function publicarOfertaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'offerId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_PUBLISH')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: publicar una oferta', (tx) => publicarOfertaEnTx(tx, id, ctx))
    refrescarOfertas(id)
    return { success: 'Oferta publicada.', id }
  } catch (e) {
    return comoError(e, 'publicarOferta')
  }
}

/**
 * EDITAR una oferta publicada. Permiso de gestión, no de publicación: editar no
 * aparta supply. Solo viajan los campos que el formulario mandó: lo ausente no
 * se toca, y `description`/`endsAt` vacíos SÍ son un cambio (se borran).
 */
export async function editarOfertaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'offerId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const fin = fd.get('endsAt')
    const d = {
      title: texto(fd, 'title', 160),
      description: texto(fd, 'description', 2000) || null,
      publicPrice: texto(fd, 'publicPrice', 20),
      salePrice: texto(fd, 'salePrice', 20),
      perCustomerLimit: entero(fd, 'perCustomerLimit') ?? 1,
      endsAt: typeof fin === 'string' && fin.trim() ? fechaFinDeDia(fd, 'endsAt') : null,
    }
    const r = await sinEmpresa('Supply 2.0: editar una oferta', (tx) => editarOfertaEnTx(tx, id, d, ctx))
    refrescarOfertas(id)
    return {
      success: r.cambios.length ? `Oferta actualizada: ${r.cambios.join(', ')}.` : 'No había nada que cambiar.',
      id,
    }
  } catch (e) {
    return comoError(e, 'editarOferta')
  }
}

export async function pausarOfertaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'offerId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: pausar una oferta', (tx) => pausarOfertaEnTx(tx, id, ctx))
    refrescarOfertas(id)
    return { success: 'Oferta pausada: no acepta compras nuevas.', id }
  } catch (e) {
    return comoError(e, 'pausarOferta')
  }
}

export async function reanudarOfertaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'offerId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply 2.0: reanudar una oferta', (tx) => reanudarOfertaEnTx(tx, id, ctx))
    refrescarOfertas(id)
    return { success: 'Oferta reactivada.', id }
  } catch (e) {
    return comoError(e, 'reanudarOferta')
  }
}

export async function finalizarOfertaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'offerId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'reason', 500) || 'Finalizada desde la administración.'
    const r = await sinEmpresa('Supply 2.0: finalizar una oferta', (tx) => cerrarOfertaEnTx(tx, id, 'ENDED', motivo, ctx))
    refrescarOfertas(id)
    return { success: `Oferta finalizada. ${r.liberadas.toLocaleString('es-DO')} unidades volvieron al supply disponible.`, id }
  } catch (e) {
    return comoError(e, 'finalizarOferta')
  }
}

export async function cancelarOfertaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'offerId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'reason', 500)
    if (!motivo) return { error: 'Escribe el motivo de la cancelación.' }
    const r = await sinEmpresa('Supply 2.0: cancelar una oferta', (tx) => cerrarOfertaEnTx(tx, id, 'CANCELLED', motivo, ctx))
    refrescarOfertas(id)
    return { success: `Oferta cancelada. ${r.liberadas.toLocaleString('es-DO')} unidades volvieron al supply disponible.`, id }
  } catch (e) {
    return comoError(e, 'cancelarOferta')
  }
}

// ── Cobros ──────────────────────────────────────────────────────────────────

export async function confirmarPagoClienteAction(_prev: EstadoAccion<PagoConfirmado>, fd: FormData): Promise<EstadoAccion<PagoConfirmado>> {
  const id = texto(fd, 'orderId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const monto = texto(fd, 'amountSeen', 20)
    if (!monto) return { error: 'Indica el monto que viste en el banco.' }
    const metodo = (texto(fd, 'method', 20) || null) as SupplyV2PaymentMethod | null
    const r = await sinEmpresa('Supply 2.0: confirmar el pago de un cliente', (tx) => confirmarPagoEnTx(tx, { orderId: id, amountSeen: monto, method: metodo }, ctx))
    refrescarOfertas()
    revalidatePath('/superadmin/supply-v2/ofertas/ventas')
    revalidatePath('/cliente/compras', 'layout')
    return {
      success: r.repetido ? `La compra ${r.number} ya estaba pagada.` : `Pago confirmado: ${r.entitlements.length} derecho(s) emitido(s) para ${r.number}.`,
      id,
      data: r,
    }
  } catch (e) {
    return comoError(e, 'confirmarPagoCliente')
  }
}

export async function rechazarPagoClienteAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'orderId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_OFFER_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'reason', 500)
    if (!motivo) return { error: 'Escribe por qué se rechaza el pago.' }
    await sinEmpresa('Supply 2.0: rechazar el pago de un cliente', (tx) => rechazarPagoEnTx(tx, id, motivo, ctx))
    refrescarOfertas()
    revalidatePath('/superadmin/supply-v2/ofertas/ventas')
    revalidatePath('/cliente/compras', 'layout')
    return { success: 'Pago rechazado: la unidad volvió a la oferta.', id }
  } catch (e) {
    return comoError(e, 'rechazarPagoCliente')
  }
}
