import { Prisma, type DealStatus } from '@prisma/client'
import { decimal, type Monto } from '@/lib/commerce-primitives/dinero'
import type { Tx } from '@/lib/tenant'
import { puedeCrearCampanas } from '@/modules/billing/domain'
import { cuentaBloqueada } from '@/modules/billing/service'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import type { ContextoAuditoria } from '@/modules/inventory/auditoria'
import { aceptarPedidoEnTx, confirmarMontoEnTx, crearPedidoEnTx, marcarListoEnTx } from '@/modules/orders/service'
import { auditarOferta } from './auditoria'
import {
  ESTADOS_EDITABLES,
  ESTADOS_PAUSABLES,
  LIMITES,
  estadoPorPresupuesto,
  motivoNoReclamable,
  precioDeLaOferta,
  puedePasarOferta,
  validarOferta,
  vencimientoDelReclamo,
  type EntradaDeOferta,
} from './domain'
import { fallo } from './errores'
import { COLUMNAS_DE_OFERTA, ajustarEstadoPorPresupuestoEnTx, filaDeOferta } from './reclamos'

/**
 * COMMERCE CORE · ofertas con presupuesto (Deals) — el servicio (Fase 5).
 *
 * Crear, publicar, pausar, ampliar y — sobre todo — RECLAMAR una oferta. Cada función corre
 * dentro de la `tx` de quien llama (`conEmpresa`), así que el presupuesto reservado, el
 * pedido, su QR y el reclamo se confirman o se deshacen JUNTOS.
 *
 * RECLAMAR es el momento delicado. En UNA transacción y en este orden:
 *   1. un `UPDATE` atómico reserva un cupo y la cuota del presupuesto SOLO si la oferta sigue
 *      vigente, hay cupos y el presupuesto alcanza (la condición va en el `WHERE`: cien
 *      reclamos simultáneos no pueden pasarse ni un centavo);
 *   2. se crea el PEDIDO Membego de la oferta (precio de catálogo con el descuento, atribución
 *      `PROMOTION_CLAIM`), la empresa lo acepta de antemano (la oferta es su aceptación), la
 *      persona confirma el monto (reclamar es aceptar el precio) y queda LISTO con su QR;
 *   3. se escribe el reclamo, único por (oferta, cliente) en la base.
 * Si cualquier paso falla, no queda reservado nada.
 *
 * ORDEN DE CANDADOS (pedido → oferta → inventario → cuenta de billing): este servicio toma
 * la oferta ANTES de crear el pedido y reservar el stock; ver `reclamos.ts`.
 *
 * SEPARACIÓN. Esto importa los pedidos y lee de billing (la tarifa y el estado de la cuenta);
 * los pedidos solo importan `reclamos.ts`. Nada de aquí toca Supply.
 */

export type ContextoOferta = ContextoAuditoria

const SISTEMA_PEDIDOS = { actor: 'SISTEMA' as const, actorId: null }
const CLIENTE_PEDIDOS = { actor: 'CLIENTE' as const, actorId: null }

/** El tipo de documento con el que un pedido recuerda de qué reclamo nació (único por oferta y cliente). */
export const FUENTE_DE_RECLAMO = 'DEAL_CLAIM'

// ── Lectura y candado ────────────────────────────────────────────────────────

/** Toma el candado de la fila de la oferta y la lee ya bloqueada. */
async function ofertaBloqueada(tx: Tx, companyId: string, id: string) {
  if (typeof id !== 'string' || id === '') fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  const filas = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "deals" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`
  if (filas.length === 0) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  return tx.deal.findFirstOrThrow({ where: { id, companyId } })
}

/** ¿La cuenta de la empresa admite campañas? (No está suspendida.) Sin cuenta todavía = sí. Lectura sin candado. */
export async function cuentaAdmiteCampanasEnTx(tx: Tx, companyId: string): Promise<boolean> {
  const cuenta = await tx.merchantBillingConfig.findUnique({ where: { companyId }, select: { status: true } })
  return cuenta === null || puedeCrearCampanas(cuenta.status)
}

async function varianteDeLaOferta(tx: Tx, companyId: string, varianteId: string) {
  const v = await tx.catalogVariant.findFirst({
    where: { id: varianteId, companyId },
    include: { item: { select: { id: true, name: true, type: true, status: true, source: true, currency: true, capabilities: true } } },
  })
  if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'Ese producto o servicio no existe en tu catálogo.')
  if (v.item.source !== 'MERCHANT') fallo('VARIANTE_INVALIDA', 'Las ofertas de Membego Supply no llevan descuentos de empresa.')
  return v
}

// ── Crear y editar ───────────────────────────────────────────────────────────

/**
 * Crea una oferta en BORRADOR. La cuota por canje se toma de la tarifa CPA de la cuenta de
 * Merchant Billing y se congela: la empresa ve de antemano lo que le cuesta cada canje.
 */
export async function crearOfertaEnTx(tx: Tx, companyId: string, e: EntradaDeOferta, ctx: ContextoOferta): Promise<{ id: string; fee: string; currency: string }> {
  const cuenta = await cuentaBloqueada(tx, companyId)
  if (!puedeCrearCampanas(cuenta.status)) {
    fallo('CUENTA_SUSPENDIDA', 'Tu cuenta Membego está suspendida: no puedes crear ofertas hasta ponerte al día.')
  }
  const valida = validarOferta(e, cuenta.cpaAmount)
  if (!valida.ok) fallo('OFERTA_INVALIDA', valida.error)
  const v = await varianteDeLaOferta(tx, companyId, valida.datos.catalogVariantId)
  if (cuenta.currency !== v.item.currency) {
    fallo('MONEDA_DISTINTA', `«${v.item.name}» está en ${v.item.currency} y tu cuenta Membego cobra en ${cuenta.currency}: no se puede ofrecer.`)
  }
  const d = valida.datos
  const oferta = await tx.deal.create({
    data: {
      companyId,
      catalogVariantId: v.id,
      title: d.title,
      description: d.description,
      discountType: d.discountType,
      discountValue: d.discountValue,
      currency: v.item.currency,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      voucherDays: d.voucherDays,
      newCustomersOnly: d.newCustomersOnly,
      maxClaims: d.maxClaims,
      feePerRedemption: cuenta.cpaAmount,
      budgetTotal: d.budgetTotal,
      createdByUserId: ctx.actorId,
    },
  })
  await auditarOferta(tx, ctx, companyId, 'DEAL_CREATED', 'Deal', oferta.id, {
    titulo: d.title,
    variante: v.id,
    descuento: `${d.discountType}:${d.discountValue.toFixed(2)}`,
    cuota: cuenta.cpaAmount.toFixed(2),
    presupuesto: d.budgetTotal.toFixed(2),
    cupos: d.maxClaims,
  })
  return { id: oferta.id, fee: cuenta.cpaAmount.toFixed(2), currency: v.item.currency }
}

export interface CambiosDeOferta extends Partial<EntradaDeOferta> {}

/**
 * Edita una oferta. En BORRADOR se puede cambiar todo; ya publicada, solo lo que no reescribe
 * lo prometido: título, descripción, fecha de fin y el máximo de clientes (nunca por debajo de
 * los reclamos que ya tiene). El descuento, la cuota y el producto no cambian: la base también
 * lo rechaza.
 */
export async function actualizarOfertaEnTx(tx: Tx, companyId: string, id: string, c: CambiosDeOferta, ctx: ContextoOferta): Promise<{ id: string }> {
  const o = await ofertaBloqueada(tx, companyId, id)
  if (o.status === 'ARCHIVED') fallo('ESTADO_INVALIDO', 'Una oferta archivada no se edita.')
  const editableTodo = ESTADOS_EDITABLES.includes(o.status)
  const actual: EntradaDeOferta = {
    title: o.title,
    description: o.description,
    catalogVariantId: o.catalogVariantId,
    discountType: o.discountType,
    discountValue: o.discountValue,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    voucherDays: o.voucherDays,
    newCustomersOnly: o.newCustomersOnly,
    maxClaims: o.maxClaims,
    budgetTotal: o.budgetTotal,
  }
  const permitidos: readonly (keyof EntradaDeOferta)[] = editableTodo
    ? ['title', 'description', 'catalogVariantId', 'discountType', 'discountValue', 'startsAt', 'endsAt', 'voucherDays', 'newCustomersOnly', 'maxClaims', 'budgetTotal']
    : ['title', 'description', 'endsAt', 'maxClaims']
  for (const k of Object.keys(c) as (keyof EntradaDeOferta)[]) {
    if (c[k] !== undefined && !permitidos.includes(k)) {
      fallo('CAMBIO_NO_PERMITIDO', 'Una oferta publicada no cambia su descuento, su producto ni su presupuesto (el presupuesto solo se amplía).')
    }
  }
  const nuevo: EntradaDeOferta = { ...actual, ...Object.fromEntries(Object.entries(c).filter(([k, v]) => v !== undefined && permitidos.includes(k as keyof EntradaDeOferta))) }
  const valida = validarOferta(nuevo, o.feePerRedemption)
  if (!valida.ok) fallo('OFERTA_INVALIDA', valida.error)
  const d = valida.datos
  if (d.maxClaims < o.claimsActive) fallo('OFERTA_INVALIDA', `Ya hay ${o.claimsActive} clientes con esta oferta: el máximo no puede ser menor.`)
  if (editableTodo && d.catalogVariantId !== o.catalogVariantId) {
    const v = await varianteDeLaOferta(tx, companyId, d.catalogVariantId)
    if (v.item.currency !== o.currency) fallo('MONEDA_DISTINTA', 'El producto elegido está en otra moneda.')
  }
  await tx.deal.update({
    where: { id: o.id },
    data: {
      title: d.title,
      description: d.description,
      endsAt: d.endsAt,
      maxClaims: d.maxClaims,
      ...(editableTodo
        ? { catalogVariantId: d.catalogVariantId, discountType: d.discountType, discountValue: d.discountValue, startsAt: d.startsAt, voucherDays: d.voucherDays, newCustomersOnly: d.newCustomersOnly, budgetTotal: d.budgetTotal }
        : {}),
    },
  })
  await auditarOferta(tx, ctx, companyId, 'DEAL_UPDATED', 'Deal', o.id, { cambios: Object.keys(c).filter((k) => c[k as keyof EntradaDeOferta] !== undefined), estado: o.status })
  return { id: o.id }
}

/** Suma presupuesto a una oferta (nunca lo quita: lo reservado y lo gastado ya son compromisos). Reabre una agotada. */
export async function ampliarPresupuestoEnTx(tx: Tx, companyId: string, id: string, adicional: Monto, ctx: ContextoOferta, ahora = new Date()): Promise<{ id: string; budgetTotal: string; status: DealStatus }> {
  const o = await ofertaBloqueada(tx, companyId, id)
  if (o.status === 'ARCHIVED' || o.status === 'COMPLETED') fallo('ESTADO_INVALIDO', 'Una oferta terminada no recibe más presupuesto.')
  let extra: Prisma.Decimal
  try {
    extra = decimal(adicional)
    if (!extra.isFinite()) throw new Error('no finito')
  } catch {
    fallo('PRESUPUESTO_INVALIDO', 'El monto no es un número.')
  }
  if (!extra.greaterThan(0) || extra.decimalPlaces() > 2) fallo('PRESUPUESTO_INVALIDO', 'Escribe un monto mayor que cero, con dos decimales como máximo.')
  if (extra.greaterThan(10_000_000)) fallo('PRESUPUESTO_INVALIDO', 'Ese monto es demasiado grande.')
  const nuevoTotal = o.budgetTotal.plus(extra)
  await tx.deal.update({ where: { id: o.id }, data: { budgetTotal: nuevoTotal } })
  await auditarOferta(tx, ctx, companyId, 'DEAL_UPDATED', 'Deal', o.id, { presupuesto: { antes: o.budgetTotal.toFixed(2), despues: nuevoTotal.toFixed(2) } })
  const estado = await ajustarEstadoPorPresupuestoEnTx(tx, ctx, companyId, filaDeOferta({ ...o, budgetTotal: nuevoTotal }), ahora, 'ampliación')
  return { id: o.id, budgetTotal: nuevoTotal.toFixed(2), status: estado }
}

// ── Estados ──────────────────────────────────────────────────────────────────

async function pasarA(tx: Tx, companyId: string, o: { id: string; status: DealStatus }, a: DealStatus, razon: string | null, ctx: ContextoOferta, ahora: Date, extra: Prisma.DealUpdateInput = {}) {
  if (!puedePasarOferta(o.status, a)) fallo('ESTADO_INVALIDO', `Una oferta ${o.status} no puede pasar a ${a}.`)
  await tx.deal.update({ where: { id: o.id }, data: { status: a, statusReason: razon, statusChangedAt: ahora, ...extra } })
  await auditarOferta(tx, ctx, companyId, 'DEAL_STATUS_CHANGED', 'Deal', o.id, { de: o.status, a, motivo: razon })
}

/** Publica un borrador: pasa a ACTIVE (o a BUDGET_EXHAUSTED si no hay presupuesto). Exige producto vendible y cuenta al día. */
export async function publicarOfertaEnTx(tx: Tx, companyId: string, id: string, ctx: ContextoOferta, ahora = new Date()): Promise<{ id: string; status: DealStatus }> {
  const o = await ofertaBloqueada(tx, companyId, id)
  if (o.status === 'ACTIVE') return { id: o.id, status: o.status }
  if (o.status !== 'DRAFT') fallo('ESTADO_INVALIDO', 'Solo se publica un borrador.')
  if (!(await cuentaAdmiteCampanasEnTx(tx, companyId))) fallo('CUENTA_SUSPENDIDA', 'Tu cuenta Membego está suspendida: no puedes publicar ofertas hasta ponerte al día.')
  if (o.endsAt !== null && o.endsAt.getTime() <= ahora.getTime()) fallo('OFERTA_INVALIDA', 'La fecha de fin ya pasó: ajusta la vigencia antes de publicar.')
  const v = await varianteDeLaOferta(tx, companyId, o.catalogVariantId)
  if (v.item.status !== 'ACTIVE') fallo('ITEM_NO_DISPONIBLE', `«${v.item.name}» no está publicado en tu catálogo: publícalo antes de ofrecerlo.`)
  if (v.status !== 'ACTIVE') fallo('VARIANTE_NO_DISPONIBLE', `«${v.item.name}» (${v.name}) no está disponible.`)
  if (!normalizarCapacidades(v.item.type, v.item.capabilities).availableMarketplace) fallo('ITEM_NO_DISPONIBLE', `«${v.item.name}» no se vende por el marketplace: actívalo en su ficha.`)
  const { ahorro } = precioDeLaOferta(v.price, o.discountType, o.discountValue)
  if (!ahorro.greaterThan(0)) fallo('OFERTA_SIN_DESCUENTO', 'Con ese descuento el precio no baja: no es una oferta. Revisa el descuento.')
  const destino = estadoPorPresupuesto({ ...o, status: 'ACTIVE' })
  await pasarA(tx, companyId, o, destino, null, ctx, ahora, { publishedAt: ahora })
  return { id: o.id, status: destino }
}

export async function pausarOfertaEnTx(tx: Tx, companyId: string, id: string, motivo: string | null, ctx: ContextoOferta, ahora = new Date()): Promise<{ id: string; status: DealStatus }> {
  const o = await ofertaBloqueada(tx, companyId, id)
  if (o.status === 'PAUSED') return { id: o.id, status: o.status }
  if (!ESTADOS_PAUSABLES.includes(o.status)) fallo('ESTADO_INVALIDO', 'Solo se pausa una oferta activa.')
  await pasarA(tx, companyId, o, 'PAUSED', motivo && motivo.trim() !== '' ? motivo.trim().slice(0, 200) : 'La empresa la pausó.', ctx, ahora)
  return { id: o.id, status: 'PAUSED' }
}

export async function reanudarOfertaEnTx(tx: Tx, companyId: string, id: string, ctx: ContextoOferta, ahora = new Date()): Promise<{ id: string; status: DealStatus }> {
  const o = await ofertaBloqueada(tx, companyId, id)
  if (o.status === 'ACTIVE' || o.status === 'BUDGET_EXHAUSTED') return { id: o.id, status: o.status }
  if (o.status !== 'PAUSED') fallo('ESTADO_INVALIDO', 'Solo se reanuda una oferta pausada.')
  if (!(await cuentaAdmiteCampanasEnTx(tx, companyId))) fallo('CUENTA_SUSPENDIDA', 'Tu cuenta Membego está suspendida: no puedes reanudar ofertas hasta ponerte al día.')
  if (o.endsAt !== null && o.endsAt.getTime() <= ahora.getTime()) fallo('OFERTA_INVALIDA', 'La oferta ya terminó: no se puede reanudar.')
  const destino = estadoPorPresupuesto({ ...o, status: 'ACTIVE' })
  await pasarA(tx, companyId, o, destino, null, ctx, ahora)
  return { id: o.id, status: destino }
}

/** Archiva la oferta: deja de mostrarse y de reclamarse. Los cupones ya reclamados siguen valiendo hasta su vencimiento. */
export async function archivarOfertaEnTx(tx: Tx, companyId: string, id: string, ctx: ContextoOferta, ahora = new Date()): Promise<{ id: string; status: DealStatus }> {
  const o = await ofertaBloqueada(tx, companyId, id)
  if (o.status === 'ARCHIVED') return { id: o.id, status: o.status }
  await pasarA(tx, companyId, o, 'ARCHIVED', 'La empresa la archivó.', ctx, ahora)
  return { id: o.id, status: 'ARCHIVED' }
}

/** El sistema cierra una oferta cuya vigencia terminó (los reclamos hechos siguen valiendo hasta su vencimiento). */
export async function terminarOfertaEnTx(tx: Tx, companyId: string, id: string, ctx: ContextoOferta, ahora = new Date()): Promise<{ id: string; status: DealStatus; cambio: boolean }> {
  const o = await ofertaBloqueada(tx, companyId, id)
  if (!['ACTIVE', 'PAUSED', 'BUDGET_EXHAUSTED'].includes(o.status) || o.endsAt === null || o.endsAt.getTime() > ahora.getTime()) {
    return { id: o.id, status: o.status, cambio: false }
  }
  await pasarA(tx, companyId, o, 'COMPLETED', 'Terminó su vigencia.', ctx, ahora)
  return { id: o.id, status: 'COMPLETED', cambio: true }
}

// ── Reclamar ─────────────────────────────────────────────────────────────────

export interface ReclamoCreado {
  claimId: string
  orderId: string
  orderCode: string
  savings: string
  total: string
  expiresAt: Date
}

/**
 * «Obtener oferta». Ver el encabezado: reserva atómica de cupo y presupuesto, pedido con QR y
 * reclamo, todo o nada. Una persona reclama una oferta UNA vez: si ya la tiene, lanza
 * `YA_RECLAMADA` con el id del pedido que ya es suyo (y no deja nada reservado).
 */
export async function reclamarOfertaEnTx(
  tx: Tx,
  companyId: string,
  e: { dealId: string; customerId: string; locationId: string },
  ahora = new Date()
): Promise<ReclamoCreado> {
  if (typeof e.dealId !== 'string' || e.dealId === '') fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')

  // Lectura previa, solo para decir las cosas claras y evitar el candado cuando es obvio.
  const previa = await tx.deal.findFirst({ where: { id: e.dealId, companyId } })
  if (!previa) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  const yaTiene = await tx.dealClaim.findFirst({ where: { dealId: previa.id, customerId: e.customerId }, select: { id: true, orderId: true, status: true } })
  if (yaTiene) fallo('YA_RECLAMADA', 'Ya reclamaste esta oferta.', { claimId: yaTiene.id, orderId: yaTiene.orderId, status: yaTiene.status })
  const suspendida = !(await cuentaAdmiteCampanasEnTx(tx, companyId))
  const razon = motivoNoReclamable(previa, ahora, suspendida)
  if (razon) fallo(razon.codigo, razon.mensaje)

  // RESERVA ATÓMICA. La condición completa va en el WHERE: es lo que impide pasarse del
  // presupuesto o de los cupos con reclamos simultáneos (el candado de fila los serializa).
  const filas = await tx.$queryRaw<Record<string, unknown>[]>`
    UPDATE "deals"
       SET "claimsActive"   = "claimsActive" + 1,
           "budgetReserved" = "budgetReserved" + "feePerRedemption",
           "updatedAt"      = ${ahora}
     WHERE "id" = ${previa.id} AND "companyId" = ${companyId}
       AND "status" = 'ACTIVE'
       AND "startsAt" <= ${ahora} AND ("endsAt" IS NULL OR "endsAt" > ${ahora})
       AND "claimsActive" < "maxClaims"
       AND "budgetSpent" + "budgetReserved" + "feePerRedemption" <= "budgetTotal"
 RETURNING ${COLUMNAS_DE_OFERTA}`
  if (filas.length === 0) {
    // Perdió la carrera (otra persona se llevó el último cupo o la última cuota): se dice por qué.
    const ahoraEnBase = await tx.deal.findFirst({ where: { id: previa.id, companyId } })
    const motivo = ahoraEnBase ? motivoNoReclamable(ahoraEnBase, ahora, suspendida) : null
    fallo(motivo?.codigo ?? 'OFERTA_AGOTADA', motivo?.mensaje ?? 'Esta oferta se agotó.')
  }
  const reservada = filaDeOferta(filas[0])

  // Con el candado de la oferta ya tomado, se vuelve a mirar si esta misma persona la reclamó
  // mientras esperaba (dos clics simultáneos): el segundo no crea un segundo pedido.
  const dobleClic = await tx.dealClaim.findFirst({ where: { dealId: reservada.id, customerId: e.customerId }, select: { id: true, orderId: true, status: true } })
  if (dobleClic) fallo('YA_RECLAMADA', 'Ya reclamaste esta oferta.', { claimId: dobleClic.id, orderId: dobleClic.orderId, status: dobleClic.status })

  if (previa.newCustomersOnly) {
    const previos = await tx.membegoOrder.count({ where: { companyId, customerId: e.customerId, status: 'COMPLETED' } })
    if (previos > 0) fallo('SOLO_CLIENTES_NUEVOS', 'Esta oferta es para quienes todavía no han visitado este negocio.')
  }

  const variante = await varianteDeLaOferta(tx, companyId, previa.catalogVariantId)
  const { ahorro } = precioDeLaOferta(variante.price, previa.discountType, previa.discountValue)
  if (!ahorro.greaterThan(0)) fallo('OFERTA_SIN_DESCUENTO', 'Esta oferta ya no baja el precio.')

  const pedido = await crearPedidoEnTx(
    tx,
    companyId,
    {
      customerId: e.customerId,
      locationId: e.locationId,
      origin: 'MARKETPLACE',
      lineas: [{ varianteId: variante.id, cantidad: 1, descuento: ahorro.toFixed(2) }],
      atribucion: { channel: 'PROMOTION_CLAIM', promotionId: previa.id },
      notas: `Oferta «${previa.title}»`,
      fuente: { tipo: FUENTE_DE_RECLAMO, id: `${previa.id}:${e.customerId}` },
      ahora,
    },
    SISTEMA_PEDIDOS
  )
  // La empresa aceptó de antemano (publicó la oferta); la persona confirma el monto al reclamar.
  await aceptarPedidoEnTx(tx, companyId, pedido.pedidoId, SISTEMA_PEDIDOS, ahora)
  await confirmarMontoEnTx(tx, companyId, pedido.pedidoId, { customerId: e.customerId, montoVisto: pedido.total }, CLIENTE_PEDIDOS, ahora)
  await marcarListoEnTx(tx, companyId, pedido.pedidoId, SISTEMA_PEDIDOS, ahora)

  const expiresAt = vencimientoDelReclamo(ahora, previa.voucherDays)
  let reclamo
  try {
    reclamo = await tx.dealClaim.create({
      data: { companyId, dealId: reservada.id, customerId: e.customerId, orderId: pedido.pedidoId, fee: reservada.feePerRedemption, savings: ahorro, claimedAt: ahora, expiresAt },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') fallo('YA_RECLAMADA', 'Ya reclamaste esta oferta.')
    throw err
  }
  await auditarOferta(tx, { actorId: null }, companyId, 'DEAL_CLAIMED', 'DealClaim', reclamo.id, {
    oferta: reservada.id,
    titulo: reservada.title,
    pedido: pedido.pedidoId,
    cliente: e.customerId,
    ahorro: ahorro.toFixed(2),
    cuota: reservada.feePerRedemption.toFixed(2),
    reservado: reservada.budgetReserved.toFixed(2),
    presupuesto: reservada.budgetTotal.toFixed(2),
  })
  await ajustarEstadoPorPresupuestoEnTx(tx, { actorId: null }, companyId, reservada, ahora, 'reclamo')
  return { claimId: reclamo.id, orderId: pedido.pedidoId, orderCode: pedido.code, savings: ahorro.toFixed(2), total: pedido.total, expiresAt }
}

export { LIMITES }
