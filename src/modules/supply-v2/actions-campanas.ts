'use server'

import { revalidatePath } from 'next/cache'
import type { SupplyV2CampaignAudience, SupplyV2CampaignOrganizer, SupplyV2CouponKind } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { exigirPermisoSupplyV2 } from './permisos'
import { comoError, contextoDeAuditoria, entero, fecha, fechaFinDeDia, texto, type EstadoAccion } from './actions-util'
import {
  adjuntarPromocionEnTx,
  agregarOfertaEnTx,
  ajustarPromocionEnTx,
  aprobarCampanaEnTx,
  asignarCampanaAClienteEnTx,
  cancelarCampanaEnTx,
  crearCampanaCompletaEnTx,
  enviarARevisionEnTx,
  pausarCampanaEnTx,
  publicarCampanaEnTx,
  quitarOfertaEnTx,
  reanudarCampanaEnTx,
  rechazarCampanaEnTx,
  type CampanaCreada,
} from './campaigns/service'
import { cancelarCuponEnTx, generarCuponesEnTx, type CuponesGenerados } from './campaigns/coupons'
import { AUDIENCIAS, minutosDesdeTexto, ORGANIZADORES, TIPOS_CUPON } from './campaigns/domain'
import { buscarClientesParaCampana } from './campaigns/queries'
import { RUTA_CAMPANAS, RUTA_CAMPANAS_PUBLICAS, RUTA_CUPONES_CLIENTE } from './core/catalogo'

/**
 * MEMBEGO SUPPLY · SLICE 7 · server actions de CAMPAÑAS Y CUPONES (§27).
 *
 * GUARDIA (permiso de plataforma) → REGLA (en `campaigns/`, dentro de UNA
 * transacción, con bitácora) → `{ error }` o `{ success }`.
 *
 * Los permisos están separados a propósito (§27): crear no es aprobar, aprobar
 * no es publicar, y los cupones tienen su propio permiso porque valen dinero.
 * La segregación —quien crea no aprueba— la impone el dominio.
 */

function refrescarCampanas(id?: string): void {
  revalidatePath(RUTA_CAMPANAS)
  if (id) revalidatePath(`${RUTA_CAMPANAS}/${id}`)
  revalidatePath(RUTA_CAMPANAS_PUBLICAS)
  revalidatePath('/promociones')
  revalidatePath(RUTA_CUPONES_CLIENTE)
}

export async function crearCampanaAction(_prev: EstadoAccion<CampanaCreada>, fd: FormData): Promise<EstadoAccion<CampanaCreada>> {
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const organizer = texto(fd, 'organizer', 20) as SupplyV2CampaignOrganizer
    const audience = texto(fd, 'audience', 30) as SupplyV2CampaignAudience
    if (!ORGANIZADORES.includes(organizer)) return { error: 'Indica quién organiza la campaña.' }
    if (!AUDIENCIAS.includes(audience)) return { error: 'Indica a qué público va la campaña.' }
    const funding = texto(fd, 'funding', 20) as 'MEMBEGO' | 'SUPPLIER' | 'SHARED'
    if (!['MEMBEGO', 'SUPPLIER', 'SHARED'].includes(funding)) return { error: 'Indica quién financia la campaña.' }
    const startsAt = fecha(fd, 'startsAt')
    if (!startsAt) return { error: 'Indica desde cuándo vale la campaña.' }
    const offerIds = fd.getAll('offerIds').map((v) => String(v)).filter(Boolean)
    const valueType = texto(fd, 'valueType', 20) as 'FIXED_AMOUNT' | 'PERCENTAGE'
    // El asistente manda las ofertas elegidas y la forma de la promoción: la
    // campaña nace completa en una sola transacción (§5). Sin ofertas, nace
    // vacía y se completa a mano desde su ficha.
    const promocion =
      offerIds.length > 0 && ['FIXED_AMOUNT', 'PERCENTAGE'].includes(valueType)
        ? {
            valueType,
            membegoValue: texto(fd, 'membegoValue', 20) || null,
            supplierValue: texto(fd, 'supplierValue', 20) || null,
            maxMembegoAmount: texto(fd, 'maxMembegoAmount', 20) || null,
            requiresCoupon: texto(fd, 'requiresCoupon', 5) === 'si',
            requiresAssignment: texto(fd, 'requiresAssignment', 5) === 'si',
          }
        : null
    const creada = await sinEmpresa('Supply: alta de una campaña', (tx) =>
      crearCampanaCompletaEnTx(
        tx,
        {
          offerIds,
          promocion,
          name: texto(fd, 'name', 140),
          description: texto(fd, 'description', 2000) || null,
          objective: texto(fd, 'objective', 300) || null,
          organizer,
          supplierId: texto(fd, 'supplierId', 60) || null,
          funding,
          budgetTotal: texto(fd, 'budgetTotal', 20) || null,
          budgetWaiverReason: texto(fd, 'budgetWaiverReason', 500) || null,
          audience,
          startsAt,
          endsAt: fechaFinDeDia(fd, 'endsAt'),
          activeFromMinute: minutosDesdeTexto(texto(fd, 'activeFrom', 5)),
          activeToMinute: minutosDesdeTexto(texto(fd, 'activeTo', 5)),
          maxRedemptions: entero(fd, 'maxRedemptions'),
          maxPerCustomer: entero(fd, 'maxPerCustomer') ?? 1,
        },
        ctx
      )
    )
    refrescarCampanas(creada.id)
    return {
      success:
        creada.promociones > 0
          ? `Campaña ${creada.code} creada como borrador con ${creada.ofertas} oferta(s) y su promoción. Revísala y pídele a otra persona autorizada que la apruebe.`
          : `Campaña ${creada.code} creada como borrador. Añade ofertas y promociones, y pídele a otra persona autorizada que la apruebe.`,
      id: creada.id,
      data: creada,
    }
  } catch (e) {
    return comoError<CampanaCreada>(e, 'crearCampana')
  }
}

export async function agregarOfertaCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const offerId = texto(fd, 'offerId', 60)
    if (!offerId) return { error: 'Elige la oferta que participa.' }
    const r = await sinEmpresa('Supply: añadir una oferta a una campaña', (tx) =>
      agregarOfertaEnTx(tx, { campaignId: id, offerId, featured: texto(fd, 'featured', 5) === 'si' }, ctx)
    )
    refrescarCampanas(id)
    return { success: r.repetida ? 'Esa oferta ya participaba en la campaña.' : 'Oferta añadida. Ahora configura su promoción.', id }
  } catch (e) {
    return comoError(e, 'agregarOfertaCampana')
  }
}

export async function quitarOfertaCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: quitar una oferta de una campaña', (tx) => quitarOfertaEnTx(tx, { campaignId: id, offerId: texto(fd, 'offerId', 60) }, ctx))
    refrescarCampanas(id)
    return { success: 'Oferta retirada de la campaña.', id }
  } catch (e) {
    return comoError(e, 'quitarOfertaCampana')
  }
}

export async function adjuntarPromocionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const valueType = texto(fd, 'valueType', 20) as 'FIXED_AMOUNT' | 'PERCENTAGE'
    if (!['FIXED_AMOUNT', 'PERCENTAGE'].includes(valueType)) return { error: 'Indica si la promoción es un importe fijo o un porcentaje.' }
    const b = await sinEmpresa('Supply: configurar la promoción de una oferta de campaña', (tx) =>
      adjuntarPromocionEnTx(
        tx,
        {
          campaignId: id,
          offerId: texto(fd, 'offerId', 60),
          nombre: texto(fd, 'nombre', 120) || null,
          valueType,
          membegoValue: texto(fd, 'membegoValue', 20) || null,
          supplierValue: texto(fd, 'supplierValue', 20) || null,
          maxMembegoAmount: texto(fd, 'maxMembegoAmount', 20) || null,
          maxSupplierAmount: texto(fd, 'maxSupplierAmount', 20) || null,
          budgetTotal: texto(fd, 'budgetTotal', 20) || null,
          perCustomerLimit: entero(fd, 'perCustomerLimit'),
          requiresCoupon: texto(fd, 'requiresCoupon', 5) === 'si',
          requiresAssignment: texto(fd, 'requiresAssignment', 5) === 'si',
        },
        ctx
      )
    )
    refrescarCampanas(id)
    return { success: `Promoción ${b.code} configurada para esa oferta.`, id }
  } catch (e) {
    return comoError(e, 'adjuntarPromocion')
  }
}

/**
 * Ajusta la promoción que ya tiene una oferta de la campaña (§16): rebalancear
 * su presupuesto, cambiar lo que rebaja mientras nadie la ha usado, o abrirla
 * con cupón. Es el mismo beneficio: no se crea otro.
 */
export async function ajustarPromocionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    const valueType = texto(fd, 'valueType', 20) as 'FIXED_AMOUNT' | 'PERCENTAGE'
    if (!['FIXED_AMOUNT', 'PERCENTAGE'].includes(valueType)) return { error: 'Indica si la promoción es un importe fijo o un porcentaje.' }
    const b = await sinEmpresa('Supply: ajustar la promoción de una oferta de campaña', (tx) =>
      ajustarPromocionEnTx(
        tx,
        {
          campaignId: id,
          offerId: texto(fd, 'offerId', 60),
          nombre: texto(fd, 'nombre', 120) || null,
          valueType,
          membegoValue: texto(fd, 'membegoValue', 20) || null,
          supplierValue: texto(fd, 'supplierValue', 20) || null,
          maxMembegoAmount: texto(fd, 'maxMembegoAmount', 20) || null,
          maxSupplierAmount: texto(fd, 'maxSupplierAmount', 20) || null,
          budgetTotal: texto(fd, 'budgetTotal', 20) || null,
          perCustomerLimit: entero(fd, 'perCustomerLimit'),
          requiresCoupon: texto(fd, 'requiresCoupon', 5) === 'si',
          requiresAssignment: texto(fd, 'requiresAssignment', 5) === 'si',
        },
        ctx
      )
    )
    refrescarCampanas(id)
    return { success: `Promoción ${b.code} ajustada.`, id }
  } catch (e) {
    return comoError(e, 'ajustarPromocion')
  }
}

export async function enviarCampanaARevisionAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: enviar una campaña a revisión', (tx) => enviarARevisionEnTx(tx, id, ctx))
    refrescarCampanas(id)
    return { success: 'Campaña en revisión: otra persona autorizada tiene que aprobarla.', id }
  } catch (e) {
    return comoError(e, 'enviarCampanaARevision')
  }
}

export async function aprobarCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: aprobar una campaña', (tx) => aprobarCampanaEnTx(tx, id, ctx))
    refrescarCampanas(id)
    return {
      success: r.repetida
        ? 'Esta campaña ya estaba aprobada.'
        : r.autoaprobada
          ? `Campaña ${r.code} aprobada. Eres la única persona autorizada, así que queda registrado que la aprobaste tú. Ya se puede publicar.`
          : `Campaña ${r.code} aprobada. Ya se puede publicar.`,
      id,
    }
  } catch (e) {
    return comoError(e, 'aprobarCampana')
  }
}

export async function rechazarCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_APPROVE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe por qué se devuelve la campaña.' }
    await sinEmpresa('Supply: rechazar una campaña', (tx) => rechazarCampanaEnTx(tx, id, motivo, ctx))
    refrescarCampanas(id)
    return { success: 'Campaña devuelta a borrador con tu motivo.', id }
  } catch (e) {
    return comoError(e, 'rechazarCampana')
  }
}

export async function publicarCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_PUBLISH')
    const ctx = await contextoDeAuditoria(actor)
    const r = await sinEmpresa('Supply: publicar una campaña', (tx) => publicarCampanaEnTx(tx, id, ctx))
    refrescarCampanas(id)
    return {
      success: r.repetida
        ? 'Esta campaña ya estaba publicada.'
        : r.status === 'SCHEDULED'
          ? `Campaña ${r.code} publicada y programada: empieza en su fecha de inicio.`
          : `Campaña ${r.code} publicada y activa: ya la ven los clientes.`,
      id,
    }
  } catch (e) {
    return comoError(e, 'publicarCampana')
  }
}

export async function pausarCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: pausar una campaña', (tx) => pausarCampanaEnTx(tx, id, ctx))
    refrescarCampanas(id)
    return { success: 'Campaña pausada: sus promociones dejan de aplicarse en compras nuevas.', id }
  } catch (e) {
    return comoError(e, 'pausarCampana')
  }
}

export async function reanudarCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE')
    const ctx = await contextoDeAuditoria(actor)
    await sinEmpresa('Supply: reanudar una campaña', (tx) => reanudarCampanaEnTx(tx, id, ctx))
    refrescarCampanas(id)
    return { success: 'Campaña activa otra vez.', id }
  } catch (e) {
    return comoError(e, 'reanudarCampana')
  }
}

export async function cancelarCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_CAMPAIGN_PUBLISH')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe por qué se cancela la campaña.' }
    await sinEmpresa('Supply: cancelar una campaña', (tx) => cancelarCampanaEnTx(tx, id, motivo, ctx))
    refrescarCampanas(id)
    return { success: 'Campaña cancelada. Lo aplicado queda aplicado; sus cupones vivos se cancelaron.', id }
  } catch (e) {
    return comoError(e, 'cancelarCampana')
  }
}

export async function generarCuponesAction(_prev: EstadoAccion<CuponesGenerados>, fd: FormData): Promise<EstadoAccion<CuponesGenerados>> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_COUPON_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const kind = texto(fd, 'kind', 10) as SupplyV2CouponKind
    if (!TIPOS_CUPON.includes(kind)) return { error: 'Indica si el cupón es público o privado.' }
    const benefitId = texto(fd, 'benefitId', 60)
    if (!benefitId) return { error: 'Elige la promoción a la que abre el cupón.' }
    const clientes = fd.getAll('customerIds').map((v) => String(v)).filter(Boolean)
    const cantidad = kind === 'PRIVATE' ? clientes.length : (entero(fd, 'cantidad') ?? 1)
    const r = await sinEmpresa('Supply: generar cupones de una campaña', (tx) =>
      generarCuponesEnTx(
        tx,
        {
          campaignId: id,
          benefitId,
          kind,
          cantidad,
          codigo: texto(fd, 'codigo', 32) || null,
          prefijo: texto(fd, 'prefijo', 16) || null,
          customerIds: kind === 'PRIVATE' ? clientes : null,
          maxRedemptions: entero(fd, 'maxRedemptions'),
          maxPerCustomer: entero(fd, 'maxPerCustomer') ?? 1,
          minPurchase: texto(fd, 'minPurchase', 20) || null,
          expiresAt: fechaFinDeDia(fd, 'expiresAt'),
          lote: texto(fd, 'lote', 140) || null,
        },
        ctx
      )
    )
    refrescarCampanas(id)
    return {
      success: r.generados === 1 ? `Cupón ${r.codigos[0]} generado.` : `${r.generados} cupones generados.`,
      id,
      data: r,
    }
  } catch (e) {
    return comoError<CuponesGenerados>(e, 'generarCupones')
  }
}

export async function cancelarCuponAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const campaignId = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_COUPON_MANAGE')
    const ctx = await contextoDeAuditoria(actor)
    const motivo = texto(fd, 'motivo', 500)
    if (!motivo) return { error: 'Escribe por qué se cancela el cupón.' }
    await sinEmpresa('Supply: cancelar un cupón', (tx) => cancelarCuponEnTx(tx, texto(fd, 'couponId', 60), motivo, ctx))
    refrescarCampanas(campaignId)
    return { success: 'Cupón cancelado.', id: campaignId }
  } catch (e) {
    return comoError(e, 'cancelarCupon')
  }
}

export async function asignarCampanaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, 'campaignId', 60)
  try {
    const actor = await exigirPermisoSupplyV2('SUPPLY_V2_BENEFIT_ASSIGN')
    const ctx = await contextoDeAuditoria(actor)
    const customerId = texto(fd, 'customerId', 60)
    if (!customerId) return { error: 'Elige el cliente que recibe la campaña.' }
    const r = await sinEmpresa('Supply: asignar una campaña a un cliente', (tx) =>
      asignarCampanaAClienteEnTx(tx, { campaignId: id, customerId, usesAllowed: entero(fd, 'usesAllowed'), note: texto(fd, 'note', 500) || null }, ctx)
    )
    refrescarCampanas(id)
    return {
      success:
        r.asignados === 0
          ? 'Este cliente ya tenía todas las promociones de la campaña.'
          : `Campaña asignada: ${r.asignados} promoción(es) en la cuenta del cliente${r.repetidos > 0 ? ` (${r.repetidos} ya la tenía)` : ''}.`,
      id,
    }
  } catch (e) {
    return comoError(e, 'asignarCampana')
  }
}

/** Buscador de clientes de los formularios de campaña (§14). */
export async function buscarClientesCampanaAction(query: string): Promise<{ id: string; nombre: string; email: string }[]> {
  await exigirPermisoSupplyV2('SUPPLY_V2_COUPON_MANAGE')
  return buscarClientesParaCampana(query)
}
