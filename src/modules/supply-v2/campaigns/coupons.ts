import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { SupplyV2CouponKind } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { decimal, redondear2, type Decimal } from '../core/dinero'
import { fallo } from '../core/errores'
import {
  codigoAleatorio,
  codigoValido,
  estadoCuponSegunUsos,
  fueraDePublico,
  MENSAJES_CUPON,
  motivoCuponNoAplicable,
  normalizarCodigoCupon,
  type CampanaParaElegibilidad,
  type CuponParaElegibilidad,
  type HistorialDelCliente,
  type MotivoCuponNoAplicable,
} from './domain'

/**
 * MEMBEGO SUPPLY · SLICE 7 · MOTOR DE CUPONES (§9–§12, §28).
 *
 * Un cupón es la PUERTA a un beneficio del Slice 6: el código se enseña y se
 * teclea, pero no decide nada. Quien resuelve un código recibe el beneficio al
 * que apunta y TODAS las reglas se vuelven a comprobar en el servidor con la
 * oferta y el beneficio bloqueados.
 *
 * Orden de candados: CUPÓN (`FOR UPDATE`) → beneficio → asignación. El cupón
 * va primero porque es la puerta: dos checkouts por el último uso del mismo
 * código se serializan aquí, y el presupuesto se defiende después con el
 * candado del beneficio (Slice 6).
 *
 * La APLICACIÓN del cupón no es un descuento aparte: cuelga de la reserva del
 * beneficio (uno a uno). Así una venta no puede contar el mismo dinero dos
 * veces (§12).
 */

const CERO = new Prisma.Decimal(0)

// ── Generación (§10) ────────────────────────────────────────────────────────

export interface DatosGeneracion {
  campaignId: string
  benefitId: string
  kind: SupplyV2CouponKind
  /** Cuántos generar. 1 para un cupón suelto. */
  cantidad: number
  /** Código exacto, solo cuando se genera UNO. Si falta, se genera al azar. */
  codigo?: string | null
  /** Prefijo de los códigos aleatorios: «BIENVENIDO» → «BIENVENIDOK3M7…». */
  prefijo?: string | null
  /** Cupón privado: a quién se le asigna (uno por cliente). */
  customerIds?: string[] | null
  maxRedemptions?: number | null
  maxPerCustomer?: number | null
  minPurchase?: number | string | null
  expiresAt?: Date | null
  /** Nombre del lote, para el rastro. */
  lote?: string | null
}

export interface CuponesGenerados {
  distributionId: string | null
  generados: number
  codigos: string[]
}

const MAX_LOTE = 1000

/**
 * Genera cupones: uno con código a medida, o un lote con códigos aleatorios.
 * Los códigos salen de `randomBytes`, no de `Math.random`: un código
 * adivinable convierte un cupón privado en uno público de facto, aunque la
 * elegibilidad se siga comprobando (§10).
 */
export async function generarCuponesEnTx(tx: Tx, d: DatosGeneracion, ctx: ContextoAuditoria): Promise<CuponesGenerados> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Generar cupones necesita quién los genera.')
  if (!Number.isInteger(d.cantidad) || d.cantidad <= 0) fallo('CANTIDAD_INVALIDA', 'La cantidad de cupones tiene que ser un entero positivo.')
  if (d.cantidad > MAX_LOTE) fallo('LOTE_DEMASIADO_GRANDE', `De una vez se generan hasta ${MAX_LOTE} cupones.`)
  if (d.codigo && d.cantidad !== 1) fallo('CODIGO_UNICO', 'Un código a medida es para un solo cupón.')

  await tx.$queryRaw`SELECT "id" FROM "supply_v2_campaigns" WHERE "id" = ${d.campaignId} FOR UPDATE`
  const campana = await tx.supplyV2Campaign.findUnique({
    where: { id: d.campaignId },
    select: { id: true, code: true, name: true, status: true, endsAt: true, currency: true, supplier: { select: { companyId: true } } },
  })
  if (!campana) fallo('CAMPANA_NO_ENCONTRADA', 'La campaña no existe.')
  if (['CANCELLED', 'COMPLETED'].includes(campana.status)) fallo('CAMPANA_CERRADA', `Una campaña ${campana.status} no genera cupones.`)
  const beneficio = await tx.supplyV2Benefit.findUnique({ where: { id: d.benefitId }, select: { id: true, campaignId: true, status: true, requiresCoupon: true } })
  if (!beneficio) fallo('BENEFICIO_NO_ENCONTRADO', 'La promoción del cupón no existe.')
  if (beneficio.campaignId !== campana.id) fallo('BENEFICIO_DE_OTRA_CAMPANA', 'Esa promoción no es de esta campaña.')
  if (['CANCELLED', 'EXPIRED'].includes(beneficio.status)) fallo('BENEFICIO_CERRADO', 'Esa promoción ya no está disponible.')

  if (d.expiresAt && campana.endsAt && d.expiresAt > campana.endsAt) fallo('VENCIMIENTO_INVALIDO', 'Un cupón no puede vencer después que su campaña.')
  const minPurchase = d.minPurchase != null && d.minPurchase !== '' ? redondear2(decimal(d.minPurchase)) : null
  if (minPurchase && minPurchase.isNegative()) fallo('MINIMO_INVALIDO', 'La compra mínima no puede ser negativa.')

  const privados = d.kind === 'PRIVATE'
  const clientes = d.customerIds?.filter(Boolean) ?? []
  if (privados && clientes.length === 0) fallo('SIN_CLIENTES', 'Un cupón privado necesita a quién se le asigna.')
  if (privados && clientes.length !== d.cantidad) fallo('CANTIDAD_NO_CUADRA', 'En cupones privados, la cantidad es el número de clientes.')
  if (!privados && clientes.length > 0) fallo('CUPON_PUBLICO_CON_CLIENTE', 'Un cupón público no se asigna a un cliente.')
  if (privados) {
    const validos = await tx.user.count({ where: { id: { in: clientes }, role: 'CLIENTE' } })
    if (validos !== clientes.length) fallo('CLIENTE_NO_ENCONTRADO', 'Alguno de los clientes no existe o no es un cliente de Membego.')
  }

  const lote =
    d.cantidad > 1 || d.lote
      ? await tx.supplyV2CampaignDistribution.create({
          data: {
            campaignId: campana.id,
            name: d.lote?.trim() || `Lote de ${d.cantidad} cupón(es) · ${campana.name}`,
            kind: d.kind,
            requested: d.cantidad,
            prefix: d.prefijo?.trim() ? normalizarCodigoCupon(d.prefijo) : null,
            createdById: ctx.actorId,
          },
          select: { id: true },
        })
      : null

  const prefijo = d.prefijo?.trim() ? normalizarCodigoCupon(d.prefijo) : ''
  const codigos: string[] = []
  for (let i = 0; i < d.cantidad; i++) {
    const code = d.codigo ? normalizarCodigoCupon(d.codigo) : `${prefijo}${codigoAleatorio((n) => randomBytes(n), 10)}`
    if (!codigoValido(code)) fallo('CODIGO_INVALIDO', 'El código solo admite letras y números, entre 4 y 32 caracteres.')
    try {
      await tx.supplyV2Coupon.create({
        data: {
          code,
          campaignId: campana.id,
          benefitId: beneficio.id,
          kind: d.kind,
          customerId: privados ? clientes[i]! : null,
          distributionId: lote?.id ?? null,
          maxRedemptions: d.maxRedemptions ?? null,
          maxPerCustomer: d.maxPerCustomer ?? 1,
          minPurchase,
          expiresAt: d.expiresAt ?? campana.endsAt,
          status: 'ACTIVE',
          createdById: ctx.actorId,
        },
      })
      codigos.push(code)
    } catch (e) {
      // Un choque de código aleatorio es raro pero posible: con un código a
      // medida se avisa, y en un lote se salta y se cuenta de menos (el lote
      // guarda cuántos se pidieron y cuántos salieron).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (d.codigo) fallo('CODIGO_REPETIDO', `El código ${code} ya existe.`)
        continue
      }
      throw e
    }
  }
  if (lote) await tx.supplyV2CampaignDistribution.update({ where: { id: lote.id }, data: { generated: codigos.length } })
  await tx.supplyV2CampaignEvent.create({
    data: {
      campaignId: campana.id,
      type: 'COUPONS_GENERATED',
      detail: `${codigos.length} cupón(es) ${d.kind === 'PUBLIC' ? 'público(s)' : 'privado(s)'} generado(s).`,
      payload: { benefitId: beneficio.id, pedidos: d.cantidad, generados: codigos.length, distributionId: lote?.id ?? null },
      actorId: ctx.actorId,
    },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_COUPONS_GENERATED', 'SupplyV2Campaign', campana.id, {
    code: campana.code,
    benefitId: beneficio.id,
    kind: d.kind,
    pedidos: d.cantidad,
    generados: codigos.length,
    // Los códigos no se vuelcan en la bitácora: un lote privado quedaría a la
    // vista de cualquiera que pueda leerla. Se guarda el lote, no los códigos.
    distributionId: lote?.id ?? null,
  }, campana.supplier?.companyId ?? null)
  return { distributionId: lote?.id ?? null, generados: codigos.length, codigos }
}

export async function cancelarCuponEnTx(tx: Tx, couponId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Cancelar un cupón exige un motivo.')
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_coupons" WHERE "id" = ${couponId} FOR UPDATE`
  const c = await tx.supplyV2Coupon.findUnique({ where: { id: couponId }, select: { id: true, code: true, status: true, campaignId: true, campaign: { select: { code: true, supplier: { select: { companyId: true } } } } } })
  if (!c) fallo('CUPON_NO_ENCONTRADO', 'El cupón no existe.')
  if (c.status === 'CANCELLED') return
  const vivas = await tx.supplyV2CouponRedemption.count({ where: { couponId: c.id, status: 'RESERVED' } })
  if (vivas > 0) fallo('CUPON_EN_USO', 'Ese cupón está en un checkout en curso: espera a que se pague o expire.')
  await tx.supplyV2Coupon.update({ where: { id: c.id }, data: { status: 'CANCELLED' } })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_COUPON_CANCELLED', 'SupplyV2Coupon', c.id, { code: c.code, campaign: c.campaign.code, motivo: motivo.trim() }, c.campaign.supplier?.companyId ?? null)
}

// ── Resolución de un código para una oferta (§12, §20) ──────────────────────

export interface CuponResuelto {
  couponId: string
  code: string
  benefitId: string
  campaignId: string
  campaignCode: string
  campaignName: string
}

export interface OfertaParaCupon {
  id: string
  salePrice: Decimal
  currency: string
}

/** Historial del cliente para el público objetivo (§13). */
export async function historialDelClienteEnTx(tx: Tx, customerId: string, campaignId: string | null): Promise<HistorialDelCliente> {
  const [comprasPagadas, beneficiosDeCampanaUsados, asignadoAEstaCampana] = await Promise.all([
    tx.supplyV2CustomerOrder.count({ where: { customerId, status: 'PAID' } }),
    tx.supplyV2BenefitReservation.count({ where: { customerId, status: 'APPLIED', benefit: { campaignId: { not: null } } } }),
    campaignId
      ? tx.supplyV2CustomerBenefit.count({ where: { customerId, status: 'AVAILABLE', benefit: { campaignId } } }).then((n) => n > 0)
      : Promise.resolve(false),
  ])
  return { comprasPagadas, beneficiosDeCampanaUsados, asignadoAEstaCampana }
}

/**
 * Resuelve un código tecleado por un cliente para una oferta y una cantidad.
 * Deja el cupón BLOQUEADO (`FOR UPDATE`) para que quien llame reserve el
 * beneficio sin que otro checkout se cuele por el último uso.
 *
 * Devuelve `{ cupon }` o `{ motivo }`: nunca lanza por un código que no
 * sirve, porque teclear mal un cupón no es un error del sistema.
 */
export async function resolverCuponEnTx(
  tx: Tx,
  d: { codigo: string; customerId: string; oferta: OfertaParaCupon; quantity: number },
  ahora = new Date()
): Promise<{ cupon: CuponResuelto; motivo?: undefined } | { cupon?: undefined; motivo: MotivoCuponNoAplicable }> {
  const code = normalizarCodigoCupon(d.codigo)
  if (!codigoValido(code)) return { motivo: 'CODIGO_INVALIDO' }

  // Candado por código ANTES de leerlo: dos checkouts con el mismo cupón se
  // serializan aquí. `pg_advisory_xact_lock` se suelta al cerrar la
  // transacción, pase lo que pase.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supply_v2_coupon:${code}`}))`
  const c = await tx.supplyV2Coupon.findFirst({
    where: { code },
    select: {
      id: true,
      code: true,
      kind: true,
      customerId: true,
      status: true,
      maxRedemptions: true,
      maxPerCustomer: true,
      minPurchase: true,
      timesRedeemed: true,
      expiresAt: true,
      benefitId: true,
      campaignId: true,
      campaign: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          currency: true,
          startsAt: true,
          endsAt: true,
          activeFromMinute: true,
          activeToMinute: true,
          maxRedemptions: true,
          maxPerCustomer: true,
          audience: true,
        },
      },
    },
  })
  if (!c) return { motivo: 'CUPON_NO_ENCONTRADO' }
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_coupons" WHERE "id" = ${c.id} FOR UPDATE`

  const [ofertaEnCampana, usosTotales, usosDelCliente, usosCampanaCliente, usosCampana, historial] = await Promise.all([
    tx.supplyV2CampaignOffer.count({ where: { campaignId: c.campaignId, offerId: d.oferta.id } }).then((n) => n > 0),
    tx.supplyV2CouponRedemption.count({ where: { couponId: c.id, status: { in: ['RESERVED', 'APPLIED'] } } }),
    tx.supplyV2CouponRedemption.count({ where: { couponId: c.id, customerId: d.customerId, status: { in: ['RESERVED', 'APPLIED'] } } }),
    tx.supplyV2BenefitReservation.count({ where: { customerId: d.customerId, status: { in: ['ACTIVE', 'APPLIED'] }, benefit: { campaignId: c.campaignId } } }),
    tx.supplyV2BenefitReservation.count({ where: { status: { in: ['ACTIVE', 'APPLIED'] }, benefit: { campaignId: c.campaignId } } }),
    historialDelClienteEnTx(tx, d.customerId, c.campaignId),
  ])

  const cupon: CuponParaElegibilidad = {
    id: c.id,
    code: c.code,
    kind: c.kind,
    customerId: c.customerId,
    status: c.status,
    maxRedemptions: c.maxRedemptions,
    maxPerCustomer: c.maxPerCustomer,
    minPurchase: c.minPurchase,
    timesRedeemed: c.timesRedeemed,
    expiresAt: c.expiresAt,
  }
  const campana: CampanaParaElegibilidad = {
    id: c.campaign.id,
    status: c.campaign.status,
    currency: c.campaign.currency,
    startsAt: c.campaign.startsAt,
    endsAt: c.campaign.endsAt,
    activeFromMinute: c.campaign.activeFromMinute,
    activeToMinute: c.campaign.activeToMinute,
    maxRedemptions: c.campaign.maxRedemptions,
    maxPerCustomer: c.campaign.maxPerCustomer,
    audience: c.campaign.audience,
  }
  const motivo = motivoCuponNoAplicable(
    cupon,
    campana,
    {
      customerId: d.customerId,
      ofertaEnCampana,
      importeDeLinea: d.oferta.salePrice.times(d.quantity),
      usos: { totales: usosTotales, delCliente: usosDelCliente, deLaCampanaPorCliente: usosCampanaCliente, deLaCampana: usosCampana },
      historial,
    },
    ahora
  )
  if (motivo) return { motivo }
  return { cupon: { couponId: c.id, code: c.code, benefitId: c.benefitId, campaignId: c.campaignId, campaignCode: c.campaign.code, campaignName: c.campaign.name } }
}

// ── Aplicación: cuelga de la reserva del beneficio (§12) ────────────────────

/**
 * Registra que ESTA reserva de beneficio se abrió con ESTE cupón. No mueve
 * dinero: el dinero lo movió la reserva. El estado nace `RESERVED` y se
 * consolida cuando la compra se confirma.
 */
export async function registrarAplicacionCuponEnTx(
  tx: Tx,
  d: { couponId: string; reservationId: string; customerId: string; orderId: string; membegoAmount: Decimal; supplierAmount: Decimal },
  ctx: ContextoAuditoria
): Promise<{ id: string }> {
  const previa = await tx.supplyV2CouponRedemption.findUnique({ where: { reservationId: d.reservationId }, select: { id: true } })
  if (previa) return previa
  const r = await tx.supplyV2CouponRedemption.create({
    data: {
      couponId: d.couponId,
      reservationId: d.reservationId,
      customerId: d.customerId,
      orderId: d.orderId,
      membegoAmount: d.membegoAmount,
      supplierAmount: d.supplierAmount,
      status: 'RESERVED',
    },
    select: { id: true },
  })
  void ctx
  return r
}

/** Al confirmarse la compra: el uso del cupón se consolida. Idempotente (§15). */
export async function consolidarCuponEnTx(tx: Tx, reservationId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<void> {
  const r = await tx.supplyV2CouponRedemption.findUnique({
    where: { reservationId },
    select: { id: true, couponId: true, status: true, orderId: true, membegoAmount: true, coupon: { select: { code: true, campaignId: true, campaign: { select: { code: true, supplier: { select: { companyId: true } } } } } } },
  })
  if (!r || r.status !== 'RESERVED') return
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_coupons" WHERE "id" = ${r.couponId} FOR UPDATE`
  const c = await tx.supplyV2Coupon.findUniqueOrThrow({ where: { id: r.couponId }, select: { id: true, status: true, maxRedemptions: true, timesRedeemed: true, expiresAt: true } })
  const usos = c.timesRedeemed + 1
  if (c.maxRedemptions != null && usos > c.maxRedemptions) fallo('LIMITE_DEL_CUPON', MENSAJES_CUPON.LIMITE_DEL_CUPON)
  await tx.supplyV2CouponRedemption.update({ where: { id: r.id }, data: { status: 'APPLIED' } })
  await tx.supplyV2Coupon.update({
    where: { id: c.id },
    data: { timesRedeemed: usos, status: estadoCuponSegunUsos({ ...c, timesRedeemed: usos }, ahora) },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_COUPON_APPLIED', 'SupplyV2CouponRedemption', r.id, {
    code: r.coupon.code,
    campaign: r.coupon.campaign.code,
    orderId: r.orderId,
    membegoAmount: r.membegoAmount.toFixed(2),
    usos,
  }, r.coupon.campaign.supplier?.companyId ?? null)
}

/** El checkout se cayó: el uso del cupón se libera. Idempotente (§16 del S6). */
export async function liberarCuponEnTx(tx: Tx, reservationId: string, motivo: string, ctx: ContextoAuditoria, destino: 'RELEASED' | 'REVERSED' = 'RELEASED'): Promise<void> {
  const r = await tx.supplyV2CouponRedemption.findUnique({
    where: { reservationId },
    select: { id: true, couponId: true, status: true, orderId: true, coupon: { select: { code: true, campaign: { select: { code: true, supplier: { select: { companyId: true } } } } } } },
  })
  if (!r || r.status === 'RELEASED' || r.status === 'REVERSED') return
  const consolidado = r.status === 'APPLIED'
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_coupons" WHERE "id" = ${r.couponId} FOR UPDATE`
  await tx.supplyV2CouponRedemption.update({ where: { id: r.id }, data: { status: destino } })
  if (consolidado) {
    // Devolver el uso: el cupón puede volver a estar disponible.
    const c = await tx.supplyV2Coupon.findUniqueOrThrow({ where: { id: r.couponId }, select: { id: true, status: true, maxRedemptions: true, timesRedeemed: true, expiresAt: true } })
    const usos = Math.max(0, c.timesRedeemed - 1)
    await tx.supplyV2Coupon.update({
      where: { id: c.id },
      data: { timesRedeemed: usos, status: c.status === 'EXHAUSTED' ? estadoCuponSegunUsos({ ...c, timesRedeemed: usos, status: 'ACTIVE' }) : c.status },
    })
  }
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_COUPON_RELEASED', 'SupplyV2CouponRedemption', r.id, {
    code: r.coupon.code,
    campaign: r.coupon.campaign.code,
    orderId: r.orderId,
    destino,
    motivo,
  }, r.coupon.campaign.supplier?.companyId ?? null)
}

/** Cron: cupones vencidos por fecha. */
export async function expirarCuponesEnTx(tx: Tx, ahora = new Date(), limite = 500): Promise<number> {
  const r = await tx.supplyV2Coupon.updateMany({ where: { status: 'ACTIVE', expiresAt: { lte: ahora } }, data: { status: 'EXPIRED' } })
  void limite
  return r.count
}

/** ¿Encaja este cliente en el público de la campaña? Para las vistas (§13). */
export async function clienteEnPublicoEnTx(tx: Tx, customerId: string, campana: { id: string; audience: CampanaParaElegibilidad['audience'] }): Promise<boolean> {
  const h = await historialDelClienteEnTx(tx, customerId, campana.id)
  return fueraDePublico(campana.audience, h) === null
}

export { CERO as CERO_CUPONES }
