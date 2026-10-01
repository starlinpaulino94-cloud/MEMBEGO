import { Prisma, type SupplyV2PaymentMethod } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { auditarEnTx, type ContextoAuditoria } from '../core/auditoria'
import { vencimientoDeReserva } from '../core/config'
import { fallo } from '../core/errores'
import {
  exigirTransicion,
  motivoNoComprable,
  ORDEN_CLIENTE_CON_RESERVA,
  TRANSICIONES_ORDEN_CLIENTE,
  unidadesQueCuentanParaLimite,
  validarLimitePorCliente,
} from '../core/estados'
import { repartirFefo } from '../core/fefo'
import { siguienteNumero } from '../core/numeracion'
import { calcularLineaCliente, montoCuadra } from '../core/precios'
import { registrarAsientoEnTx } from '../pool/lotes'
import { SIN_TOPE, unidadesLibres } from '../offers/domain'
import { marcarAgotadaSiCorrespondeEnTx, unidadesLibresDeOfertaComisionEnTx } from '../offers/service'
import { repartirEnUnidades } from '../core/comision'
import { calcularRepartoLinea, fotoDeReparto, type RepartoFinanciado, type UnidadFinanciada } from '../core/financiacion'
import { politicaDeVersion } from '../finance/domain'
import { aplicarReservaEnTx, liberarReservaEnTx, reservarBeneficioEnTx, type ReservaDeBeneficio } from '../benefits/service'
import { activarMembresiaPorPagoEnTx, soltarMembresiaDeOrdenEnTx } from '../loyalty/memberships'
import { acumularPorCompraEnTodosEnTx } from '../loyalty/points'
import { evaluarCompraEnTx } from '../loyalty/referrals'
import { consolidarCuponEnTx, liberarCuponEnTx, registrarAplicacionCuponEnTx, resolverCuponEnTx, type CuponResuelto } from '../campaigns/coupons'
import { promocionAutomaticaEnTx } from '../campaigns/service'
import { MENSAJES_CUPON, MENSAJE_CUPON_OPACO } from '../campaigns/domain'
import type { PaymentAccountRef } from '../contracts/gateways'
import { reconocerVentaEnTx } from '../economics/service'

/**
 * MEMBEGO SUPPLY 2.0 · CHECKOUT, RESERVA, PAGO Y DERECHO (§21–§37).
 *
 * TODO dentro de la `tx` de quien llama. La OFERTA se bloquea con
 * `FOR UPDATE` en cada operación que mueve sus unidades: dos clientes por la
 * última unidad, o dos checkouts del mismo cliente contra su límite, se
 * serializan en la base y solo uno pasa (§24, §35).
 *
 * Movimientos:
 *   abrir      ALLOCATED → RESERVED   (por lote, FEFO dentro de la asignación)
 *   cancelar   RESERVED  → ALLOCATED
 *   expirar    RESERVED  → ALLOCATED
 *   pagar      RESERVED  → ISSUED     + un derecho por unidad, con el costo del lote real
 */

export interface DatosCheckout {
  customerId: string
  offerId: string
  quantity: number
  idempotencyKey?: string | null
  /** Cuenta de cobro elegida; se congela como foto en la orden. */
  cuenta?: PaymentAccountRef | null
  /** Slice 6 (§16–§17): beneficio de la cuenta del cliente (asignación) o beneficio público. El servidor lo revalida todo. */
  customerBenefitId?: string | null
  benefitId?: string | null
  /** Slice 7 (§20): el código que el cliente escribió en el checkout. */
  couponCode?: string | null
}

// ── Slice 6 · financiación de la línea (§13–§15, §19) ──────────────────────────

type OfertaParaFinanciar = {
  id: string
  catalogItemId: string
  supplierId: string
  sourceType: 'PREPURCHASED_SUPPLY' | 'COMMISSION'
  currency: string
  salePrice: Prisma.Decimal
  commissionPercentage: Prisma.Decimal | null
  agreementVersion: { snapshot: unknown } | null
}

function baseDeComision(oferta: OfertaParaFinanciar): 'CONTRACTUAL_SALE_VALUE' | 'CUSTOMER_PAID_AMOUNT' | null {
  if (oferta.sourceType !== 'COMMISSION') return null
  return politicaDeVersion(oferta.agreementVersion?.snapshot ?? null).commissionBase
}

/**
 * Reparto de la línea: sin beneficio es plano (contractual = lo que paga el
 * cliente). Con beneficio, `reservarBeneficioEnTx` bloquea beneficio y
 * asignación, valida la elegibilidad y reserva el presupuesto; el reparto que
 * devuelve es el que la orden CONGELA (§15).
 */
async function financiarLineaEnTx(tx: Tx, d: DatosCheckout, oferta: OfertaParaFinanciar, orderId: string, orderLineId: string, expiresAt: Date, ctx: ContextoAuditoria): Promise<{ reparto: RepartoFinanciado; reserva: ReservaDeBeneficio | null; cupon: CuponResuelto | null }> {
  const commissionBase = baseDeComision(oferta)
  const plano = () => calcularRepartoLinea({ saleUnitPrice: oferta.salePrice, quantity: d.quantity, sourceType: oferta.sourceType, commissionPercentage: oferta.commissionPercentage, commissionBase })

  // Slice 7 (§20): el CUPÓN se resuelve primero y deja el cupón bloqueado; el
  // beneficio al que apunta es el que se reserva. Un código que no sirve NO
  // rompe la compra con un error técnico: se explica y se para aquí.
  let cupon: CuponResuelto | null = null
  let benefitId = d.benefitId ?? null
  if (d.couponCode?.trim()) {
    const r = await resolverCuponEnTx(tx, { codigo: d.couponCode, customerId: d.customerId, oferta: { id: oferta.id, salePrice: oferta.salePrice, currency: oferta.currency }, quantity: d.quantity })
    if (r.motivo) {
      // «No existe» y «no es tuyo» comparten mensaje: quien prueba códigos a
      // mano no debe poder distinguirlos (§28). Al dueño del cupón sí se le
      // explica lo que puede corregir.
      const opaco = r.motivo === 'CUPON_NO_ENCONTRADO' || r.motivo === 'CUPON_AJENO' || r.motivo === 'CODIGO_INVALIDO'
      fallo(`CUPON_${r.motivo}`, opaco ? MENSAJE_CUPON_OPACO : MENSAJES_CUPON[r.motivo])
    }
    cupon = r.cupon!
    if (d.customerBenefitId) fallo('CUPON_Y_BENEFICIO', 'Usa el cupón o un beneficio de tu cuenta, no los dos en la misma compra.')
    benefitId = cupon.benefitId
  }

  // Slice 7 (§20, §25): si el cliente no eligió nada, una promoción de campaña
  // SIN código y SIN asignación se aplica sola. Es «opcional»: si ya no cabe
  // —presupuesto agotado, límite, público— la compra sigue a precio normal, que
  // es lo correcto cuando el cliente no pidió esa promoción.
  const automatica = !d.customerBenefitId && !benefitId
  if (automatica) {
    const auto = await promocionAutomaticaEnTx(tx, {
      offerId: oferta.id,
      customerId: d.customerId,
      quantity: d.quantity,
      sourceType: oferta.sourceType,
      salePrice: oferta.salePrice,
      commissionPercentage: oferta.commissionPercentage,
      commissionBase,
    })
    if (auto) benefitId = auto.benefitId
  }

  if (!d.customerBenefitId && !benefitId) return { reparto: plano(), reserva: null, cupon: null }

  const reserva = await reservarBeneficioEnTx(
    tx,
    {
      customerId: d.customerId,
      customerBenefitId: d.customerBenefitId,
      benefitId,
      oferta: { id: oferta.id, catalogItemId: oferta.catalogItemId, supplierId: oferta.supplierId, sourceType: oferta.sourceType, currency: oferta.currency, salePrice: oferta.salePrice, commissionPercentage: oferta.commissionPercentage, commissionBase },
      quantity: d.quantity,
      orderId,
      orderLineId,
      expiresAt,
      conCupon: cupon !== null,
      opcional: automatica,
    },
    ctx
  )
  // La promoción automática que ya no cabía: se compra a precio normal.
  if (!reserva) return { reparto: plano(), reserva: null, cupon: null }
  if (cupon) {
    await registrarAplicacionCuponEnTx(
      tx,
      { couponId: cupon.couponId, reservationId: reserva.reservationId, customerId: d.customerId, orderId, membegoAmount: reserva.reparto.membegoSubsidy, supplierAmount: reserva.reparto.supplierDiscount },
      ctx
    )
  }
  return { reparto: reserva.reparto, reserva, cupon }
}

/** Escribe en orden y línea la financiación congelada. `total` = lo que paga el cliente. */
async function congelarFinanciacionEnTx(tx: Tx, orderId: string, orderLineId: string, r: RepartoFinanciado, reserva: ReservaDeBeneficio | null, atribucion: { campaignId: string | null; couponCode: string | null } = { campaignId: null, couponCode: null }): Promise<void> {
  await tx.supplyV2CustomerOrderLine.update({
    where: { id: orderLineId },
    data: {
      total: r.customerPayable,
      contractualValue: r.contractualSaleValue,
      supplierDiscountAmount: r.supplierDiscount,
      membegoSubsidyAmount: r.membegoSubsidy,
      benefitId: reserva?.benefitId ?? null,
      commissionPercentage: r.commissionPercentage,
      commissionAmount: r.commissionAmount,
      supplierNet: r.supplierNet,
      commissionUnitAmount: r.porUnidad[0]?.commissionAmount ?? 0,
      supplierUnitNet: r.porUnidad[0]?.supplierNet ?? 0,
    },
  })
  await tx.supplyV2CustomerOrder.update({
    where: { id: orderId },
    data: {
      total: r.customerPayable,
      contractualValue: r.contractualSaleValue,
      supplierDiscountTotal: r.supplierDiscount,
      membegoSubsidyTotal: r.membegoSubsidy,
      commissionBase: r.commissionBase,
      commissionPercentage: r.commissionPercentage,
      commissionAmount: r.commissionAmount,
      supplierNet: r.supplierNet,
      benefitFundingSnapshot: fotoDeReparto(r, reserva ? reserva.beneficio : null),
      // Slice 7 (§25): la atribución se CONGELA aquí. Una compra pertenece a UNA
      // campaña —la del beneficio aplicado—, así que una oferta que participa en
      // varias no puede duplicar su GMV.
      campaignId: atribucion.campaignId,
      couponCodeSnapshot: atribucion.couponCode,
    },
  })
}

/** Reconstruye el reparto POR UNIDAD desde lo congelado en la línea (determinista, §22). */
export function unidadesDesdeLinea(l: { quantity: number; saleUnitPrice: Prisma.Decimal; supplierDiscountAmount: Prisma.Decimal; membegoSubsidyAmount: Prisma.Decimal; commissionAmount: Prisma.Decimal }, esComision: boolean): UnidadFinanciada[] {
  const d = repartirEnUnidades(l.supplierDiscountAmount, l.quantity)
  const m = repartirEnUnidades(l.membegoSubsidyAmount, l.quantity)
  const c = repartirEnUnidades(l.commissionAmount, l.quantity)
  const out: UnidadFinanciada[] = []
  for (let i = 0; i < l.quantity; i++) {
    const contractual = l.saleUnitPrice.minus(d[i]!)
    out.push({ contractualValue: contractual, supplierDiscount: d[i]!, membegoSubsidy: m[i]!, customerPaid: contractual.minus(m[i]!), commissionAmount: esComision ? c[i]! : new Prisma.Decimal(0), supplierNet: esComision ? contractual.minus(c[i]!) : new Prisma.Decimal(0) })
  }
  return out
}

export interface OrdenClienteAbierta {
  id: string
  number: string
  total: string
  expiresAt: Date
  repetida: boolean
}

export async function abrirOrdenClienteEnTx(tx: Tx, d: DatosCheckout, ctx: ContextoAuditoria): Promise<OrdenClienteAbierta> {
  if (!Number.isInteger(d.quantity) || d.quantity <= 0) fallo('CANTIDAD_INVALIDA', 'La cantidad tiene que ser un entero positivo.')

  // 1. Bloquear la oferta: serializa a todos los compradores de esta oferta.
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${d.offerId} FOR UPDATE`

  // 2. Idempotencia, después del bloqueo (§26).
  if (d.idempotencyKey) {
    const previa = await tx.supplyV2CustomerOrder.findUnique({
      where: { idempotencyKey: d.idempotencyKey },
      select: { id: true, number: true, total: true, expiresAt: true, customerId: true },
    })
    if (previa) {
      if (previa.customerId !== d.customerId) fallo('CLAVE_AJENA', 'Esa clave de compra no es tuya.')
      return { id: previa.id, number: previa.number, total: previa.total.toFixed(2), expiresAt: previa.expiresAt, repetida: true }
    }
  }

  // 2b. Reservas caducadas de ESTA oferta: se sueltan aquí mismo, bajo el mismo
  // candado, para que el stock no dependa de cuándo pase el cron (§25, §37).
  await expirarCaducadasDeOfertaEnTx(tx, d.offerId, { ...ctx, actorId: null })

  const oferta = await tx.supplyV2Offer.findUnique({
    where: { id: d.offerId },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      sourceType: true,
      startsAt: true,
      endsAt: true,
      publicPrice: true,
      salePrice: true,
      currency: true,
      perCustomerLimit: true,
      agreementId: true,
      agreementVersionId: true,
      commissionPercentage: true,
      availabilityMode: true,
      availabilityQuantity: true,
      catalogItemId: true,
      supplierId: true,
      agreementVersion: { select: { snapshot: true } },
      supplier: { select: { companyId: true } },
      allocation: {
        select: {
          id: true,
          allocatedQuantity: true,
          reservedQuantity: true,
          issuedQuantity: true,
          releasedQuantity: true,
          lines: {
            select: { id: true, lotId: true, quantity: true, reservedQuantity: true, issuedQuantity: true, releasedQuantity: true, lot: { select: { expiresAt: true, receivedAt: true } } },
          },
        },
      },
    },
  })
  if (!oferta) fallo('OFERTA_NO_ENCONTRADA', 'La oferta no existe.')
  if (oferta.sourceType === 'COMMISSION') return abrirOrdenComisionEnTx(tx, d, oferta, ctx)
  if (!oferta.allocation) fallo('OFERTA_SIN_SUPPLY', 'Esta oferta no tiene supply asignado.')
  const libres = unidadesLibres(oferta.allocation)
  const veto = motivoNoComprable(oferta, libres)
  if (veto) fallo('OFERTA_NO_COMPRABLE', veto)
  if (d.quantity > libres) fallo('SIN_UNIDADES', libres === 1 ? 'Solo queda 1 unidad en esta oferta.' : `Solo quedan ${libres} unidades en esta oferta.`)

  // 3. Límite por cliente: pagadas + reservas vivas de este cliente en esta oferta (§35).
  const previas = await tx.supplyV2CustomerOrderLine.findMany({
    where: { offerId: oferta.id, order: { customerId: d.customerId } },
    select: { quantity: true, order: { select: { status: true } } },
  })
  const yaCuenta = unidadesQueCuentanParaLimite(previas.map((p) => ({ status: p.order.status, quantity: p.quantity })))
  const limite = validarLimitePorCliente(oferta.perCustomerLimit, yaCuenta, d.quantity)
  if (limite) fallo('LIMITE_POR_CLIENTE', limite)

  // 4. FEFO dentro de la asignación: de qué lotes salen las unidades reservadas (§33).
  const candidatos = oferta.allocation.lines.map((l) => ({
    id: l.id,
    disponible: l.quantity - l.reservedQuantity - l.issuedQuantity - l.releasedQuantity,
    expiresAt: l.lot.expiresAt,
    receivedAt: l.lot.receivedAt,
  }))
  const reparto = repartirFefo(candidatos, d.quantity)
  const lineaPorId = new Map(oferta.allocation.lines.map((l) => [l.id, l]))

  // 5. La orden con sus precios congelados (§49).
  const linea = calcularLineaCliente(oferta.publicPrice, oferta.salePrice, d.quantity)
  const number = await siguienteNumero(tx, 'MBG-SO', async (prefijo) => {
    const u = await tx.supplyV2CustomerOrder.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  })
  const expiresAt = vencimientoDeReserva()
  const orden = await tx.supplyV2CustomerOrder.create({
    data: {
      number,
      customerId: d.customerId,
      currency: oferta.currency,
      subtotal: linea.subtotal,
      discount: linea.discount,
      total: linea.total,
      // Slice 6: nace sin beneficio (contractual = lo que paga el cliente); `congelarFinanciacionEnTx`
      // reescribe las cuatro cifras juntas si hay beneficio. Así el CHECK de la base cuadra en los dos pasos.
      contractualValue: linea.total,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      expiresAt,
      paymentAccountId: d.cuenta?.id ?? null,
      paymentAccountSnapshot: d.cuenta ? (d.cuenta as unknown as Prisma.InputJsonValue) : undefined,
      idempotencyKey: d.idempotencyKey ?? null,
      lines: {
        create: {
          offerId: oferta.id,
          titleSnapshot: oferta.title,
          quantity: d.quantity,
          publicUnitPrice: linea.publicUnitPrice,
          saleUnitPrice: linea.saleUnitPrice,
          subtotal: linea.subtotal,
          discount: linea.discount,
          total: linea.total,
          contractualValue: linea.total,
          reservations: {
            create: reparto.map((r) => ({ allocationLineId: r.id, lotId: lineaPorId.get(r.id)!.lotId, quantity: r.cantidad, status: 'ACTIVE' })),
          },
        },
      },
    },
    select: { id: true, number: true, total: true, expiresAt: true, lines: { select: { id: true } } },
  })

  // 5b. Slice 6 (§16–§17): financiación de la línea (beneficio opcional) y foto congelada.
  const fin = await financiarLineaEnTx(tx, d, oferta, orden.id, orden.lines[0]!.id, expiresAt, ctx)
  await congelarFinanciacionEnTx(tx, orden.id, orden.lines[0]!.id, fin.reparto, fin.reserva, {
    campaignId: fin.reserva?.beneficio.campaignId ?? null,
    couponCode: fin.cupon?.code ?? null,
  })
  orden.total = fin.reparto.customerPayable

  // 6. ALLOCATED → RESERVED en cada lote, y los contadores.
  for (const r of reparto) {
    const l = lineaPorId.get(r.id)!
    await registrarAsientoEnTx(
      tx,
      l.lotId,
      { type: 'RESERVATION', sourceBucket: 'ALLOCATED', destinationBucket: 'RESERVED', quantity: r.cantidad, reason: `Reserva de la orden ${orden.number} (oferta ${oferta.code}).` },
      { referenceType: 'CUSTOMER_ORDER', referenceId: orden.id },
      ctx.actorId
    )
    await tx.supplyV2AllocationLine.update({ where: { id: l.id }, data: { reservedQuantity: { increment: r.cantidad } } })
  }
  await tx.supplyV2Allocation.update({ where: { id: oferta.allocation.id }, data: { reservedQuantity: { increment: d.quantity } } })

  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_CREATED', 'SupplyV2CustomerOrder', orden.id, {
    number: orden.number,
    offerId: oferta.id,
    quantity: d.quantity,
    total: orden.total.toString(),
    contractualValue: fin.reparto.contractualSaleValue.toFixed(2),
    membegoSubsidy: fin.reparto.membegoSubsidy.toFixed(2),
    supplierDiscount: fin.reparto.supplierDiscount.toFixed(2),
    benefitId: fin.reserva?.benefitId ?? null,
  }, oferta.supplier.companyId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_RESERVED', 'SupplyV2CustomerOrder', orden.id, {
    number: orden.number,
    reservas: reparto.map((r) => ({ lotId: lineaPorId.get(r.id)!.lotId, quantity: r.cantidad })),
    expiresAt: expiresAt.toISOString(),
  }, oferta.supplier.companyId)

  return { id: orden.id, number: orden.number, total: orden.total.toFixed(2), expiresAt, repetida: false }
}

// ── Slice 5 · checkout a COMISIÓN (§13–§19) ─────────────────────────────────

type OfertaComisionParaComprar = {
  id: string
  code: string
  title: string
  sourceType: 'PREPURCHASED_SUPPLY' | 'COMMISSION'
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'SOLD_OUT' | 'ENDED' | 'CANCELLED'
  startsAt: Date
  endsAt: Date | null
  publicPrice: Prisma.Decimal
  salePrice: Prisma.Decimal
  currency: string
  perCustomerLimit: number
  agreementId: string | null
  agreementVersionId: string | null
  commissionPercentage: Prisma.Decimal | null
  availabilityMode: 'UNLIMITED' | 'FIXED_QUANTITY' | 'CAPACITY' | null
  availabilityQuantity: number | null
  catalogItemId: string
  supplierId: string
  agreementVersion: { snapshot: unknown } | null
  supplier: { companyId: string | null }
}

/**
 * Mismo flujo que el prepago, SIN lote ni ledger: la reserva es comercial
 * (`SupplyV2CommissionReservation`) y se descuenta de la disponibilidad
 * propia de la oferta bajo el candado de la oferta (ya tomado por quien
 * llama). Congela acuerdo, versión y porcentaje: el reparto no cambia si el
 * acuerdo cambia después (§17).
 */
async function abrirOrdenComisionEnTx(tx: Tx, d: DatosCheckout, oferta: OfertaComisionParaComprar, ctx: ContextoAuditoria): Promise<OrdenClienteAbierta> {
  if (!oferta.agreementId || !oferta.agreementVersionId || oferta.commissionPercentage == null) {
    fallo('OFERTA_SIN_ACUERDO', 'Esta oferta a comisión no tiene su acuerdo congelado: no se puede vender.')
  }
  const libres = await unidadesLibresDeOfertaComisionEnTx(tx, oferta)
  const veto = motivoNoComprable(oferta, libres ?? SIN_TOPE)
  if (veto) fallo('OFERTA_NO_COMPRABLE', veto)
  if (libres !== null && d.quantity > libres) fallo('SIN_UNIDADES', libres === 1 ? 'Solo queda 1 unidad en esta oferta.' : `Solo quedan ${libres} unidades en esta oferta.`)

  const previas = await tx.supplyV2CustomerOrderLine.findMany({
    where: { offerId: oferta.id, order: { customerId: d.customerId } },
    select: { quantity: true, order: { select: { status: true } } },
  })
  const yaCuenta = unidadesQueCuentanParaLimite(previas.map((p) => ({ status: p.order.status, quantity: p.quantity })))
  const limite = validarLimitePorCliente(oferta.perCustomerLimit, yaCuenta, d.quantity)
  if (limite) fallo('LIMITE_POR_CLIENTE', limite)

  const linea = calcularLineaCliente(oferta.publicPrice, oferta.salePrice, d.quantity)
  const number = await siguienteNumero(tx, 'MBG-SO', async (prefijo) => {
    const u = await tx.supplyV2CustomerOrder.findFirst({ where: { number: { startsWith: prefijo } }, orderBy: { number: 'desc' }, select: { number: true } })
    return u?.number ?? null
  })
  const expiresAt = vencimientoDeReserva()
  const orden = await tx.supplyV2CustomerOrder.create({
    data: {
      number,
      customerId: d.customerId,
      currency: oferta.currency,
      subtotal: linea.subtotal,
      discount: linea.discount,
      total: linea.total,
      // Slice 6: nace sin beneficio (contractual = lo que paga el cliente); `congelarFinanciacionEnTx`
      // reescribe las cuatro cifras juntas si hay beneficio. Así el CHECK de la base cuadra en los dos pasos.
      contractualValue: linea.total,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      expiresAt,
      paymentAccountId: d.cuenta?.id ?? null,
      paymentAccountSnapshot: d.cuenta ? (d.cuenta as unknown as Prisma.InputJsonValue) : undefined,
      idempotencyKey: d.idempotencyKey ?? null,
      sourceType: 'COMMISSION',
      agreementId: oferta.agreementId,
      agreementVersionId: oferta.agreementVersionId,
      commissionPercentage: oferta.commissionPercentage,
      lines: {
        create: {
          offerId: oferta.id,
          titleSnapshot: oferta.title,
          quantity: d.quantity,
          publicUnitPrice: linea.publicUnitPrice,
          saleUnitPrice: linea.saleUnitPrice,
          subtotal: linea.subtotal,
          discount: linea.discount,
          total: linea.total,
          contractualValue: linea.total,
          commissionPercentage: oferta.commissionPercentage,
        },
      },
    },
    select: { id: true, number: true, total: true, expiresAt: true, lines: { select: { id: true } } },
  })
  // Slice 6: financiación (beneficio opcional) → reparto congelado con la base de comisión de la versión del acuerdo (§14).
  const fin = await financiarLineaEnTx(tx, d, oferta, orden.id, orden.lines[0]!.id, expiresAt, ctx)
  const reparto = fin.reparto
  await congelarFinanciacionEnTx(tx, orden.id, orden.lines[0]!.id, reparto, fin.reserva, {
    campaignId: fin.reserva?.beneficio.campaignId ?? null,
    couponCode: fin.cupon?.code ?? null,
  })
  orden.total = reparto.customerPayable
  await tx.supplyV2CommissionReservation.create({
    data: { offerId: oferta.id, orderId: orden.id, orderLineId: orden.lines[0]!.id, quantity: d.quantity, status: 'ACTIVE', expiresAt },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_CREATED', 'SupplyV2CustomerOrder', orden.id, {
    number: orden.number,
    offerId: oferta.id,
    sourceType: 'COMMISSION',
    quantity: d.quantity,
    total: orden.total.toString(),
    commissionPercentage: reparto.commissionPercentage?.toFixed(2) ?? null,
    commissionBase: reparto.commissionBase,
    commissionAmount: reparto.commissionAmount.toFixed(2),
    supplierNet: reparto.supplierNet.toFixed(2),
    contractualValue: reparto.contractualSaleValue.toFixed(2),
    membegoSubsidy: reparto.membegoSubsidy.toFixed(2),
    supplierDiscount: reparto.supplierDiscount.toFixed(2),
    benefitId: fin.reserva?.benefitId ?? null,
  }, oferta.supplier.companyId)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_RESERVED', 'SupplyV2CustomerOrder', orden.id, {
    number: orden.number,
    reservas: [{ offerId: oferta.id, quantity: d.quantity, availabilityMode: oferta.availabilityMode }],
    expiresAt: expiresAt.toISOString(),
  }, oferta.supplier.companyId)
  return { id: orden.id, number: orden.number, total: orden.total.toFixed(2), expiresAt, repetida: false }
}

// ── Liberar (cancelar / expirar / rechazar) ────────────────────────────────

async function ordenBloqueada(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supply_v2_customer_orders" WHERE "id" = ${orderId} FOR UPDATE`
  const o = await tx.supplyV2CustomerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      customerId: true,
      total: true,
      currency: true,
      expiresAt: true,
      sourceType: true,
      agreementId: true,
      agreementVersionId: true,
      // Slice 8: una compra de membresía no lleva líneas ni derechos.
      kind: true,
      lines: {
        select: {
          id: true,
          offerId: true,
          quantity: true,
          saleUnitPrice: true,
          commissionPercentage: true,
          commissionAmount: true,
          supplierNet: true,
          contractualValue: true,
          supplierDiscountAmount: true,
          membegoSubsidyAmount: true,
          benefitId: true,
          benefitReservation: { select: { id: true, status: true } },
          offer: { select: { id: true, code: true, sourceType: true, supplierId: true, catalogItemId: true, allocationId: true, endsAt: true, supplier: { select: { companyId: true } } } },
          reservations: { where: { status: 'ACTIVE' }, select: { id: true, allocationLineId: true, lotId: true, quantity: true } },
          commissionReservations: { where: { status: 'ACTIVE' }, select: { id: true, quantity: true } },
        },
      },
    },
  })
  if (!o) fallo('ORDEN_NO_ENCONTRADA', 'La compra no existe.')
  return o
}

type OrdenBloqueada = Awaited<ReturnType<typeof ordenBloqueada>>

/** RESERVED → ALLOCATED para todas las reservas vivas de la orden. */
async function soltarReservasEnTx(tx: Tx, o: OrdenBloqueada, motivo: string, actorId: string | null, destino: 'RELEASED' | 'EXPIRED' = 'RELEASED'): Promise<number> {
  let soltadas = 0
  for (const l of o.lines) {
    // Bloquear la oferta para que el contador no compita con un checkout.
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${l.offerId} FOR UPDATE`
    // Slice 6 (§27): la reserva del beneficio vuelve al presupuesto.
    if (l.benefitReservation?.status === 'ACTIVE') {
      const ctxSoltar = { actorId, ipAddress: null, userAgent: 'checkout' }
      // Slice 7: el uso del cupón se suelta con la reserva que abrió. Si se
      // liberara el presupuesto y no el cupón, el cliente perdería su cupón sin
      // haber comprado nada.
      await liberarCuponEnTx(tx, l.benefitReservation.id, motivo, ctxSoltar)
      await liberarReservaEnTx(tx, l.benefitReservation.id, destino, motivo, ctxSoltar)
    }
    // Slice 5: la reserva comercial de una oferta a comisión se libera (o expira) sin tocar ningún lote.
    for (const r of l.commissionReservations) {
      await tx.supplyV2CommissionReservation.update({ where: { id: r.id }, data: { status: destino, releasedAt: new Date() } })
      soltadas += r.quantity
    }
    if (l.commissionReservations.length > 0 && l.offer.sourceType === 'COMMISSION') {
      // Si estaba SOLD_OUT por capacidad, vuelve a ACTIVE: hay cupo otra vez.
      await tx.supplyV2Offer.updateMany({ where: { id: l.offerId, status: 'SOLD_OUT' }, data: { status: 'ACTIVE' } })
    }
    for (const r of l.reservations) {
      await registrarAsientoEnTx(
        tx,
        r.lotId,
        { type: 'RELEASE_RESERVATION', sourceBucket: 'RESERVED', destinationBucket: 'ALLOCATED', quantity: r.quantity, reason: motivo },
        { referenceType: 'CUSTOMER_ORDER', referenceId: o.id },
        actorId
      )
      await tx.supplyV2AllocationLine.update({ where: { id: r.allocationLineId }, data: { reservedQuantity: { decrement: r.quantity } } })
      await tx.supplyV2OrderReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedAt: new Date() } })
      soltadas += r.quantity
    }
    if (l.offer.allocationId && l.reservations.length > 0) {
      await tx.supplyV2Allocation.update({
        where: { id: l.offer.allocationId },
        data: { reservedQuantity: { decrement: l.reservations.reduce((t, r) => t + r.quantity, 0) } },
      })
    }
  }
  return soltadas
}

/** El cliente se echa atrás antes de pagar (§36). Solo el dueño. */
export async function cancelarOrdenClienteEnTx(tx: Tx, orderId: string, customerId: string, ctx: ContextoAuditoria): Promise<void> {
  const o = await ordenBloqueada(tx, orderId)
  if (o.customerId !== customerId) fallo('ORDEN_AJENA', 'Esa compra no es tuya.')
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, o.status, 'CANCELLED', 'Compra')
  const soltadas = await soltarReservasEnTx(tx, o, `Cancelada por el cliente (${o.number}).`, ctx.actorId)
  await tx.supplyV2CustomerOrder.update({ where: { id: o.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  if (o.kind === 'MEMBERSHIP') await soltarMembresiaDeOrdenEnTx(tx, o.id, `Compra cancelada por el cliente (${o.number}).`, ctx)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_CANCELLED', 'SupplyV2CustomerOrder', o.id, { number: o.number, antes: o.status, soltadas }, o.lines[0]?.offer.supplier.companyId ?? null)
}

/** Expira una orden PENDING cuya reserva caducó (§37). Idempotente. */
export async function expirarOrdenEnTx(tx: Tx, orderId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<boolean> {
  const o = await ordenBloqueada(tx, orderId)
  if (o.status !== 'PENDING') return false
  if (o.expiresAt > ahora) return false
  const soltadas = await soltarReservasEnTx(tx, o, `Reserva expirada (${o.number}).`, ctx.actorId, 'EXPIRED')
  await tx.supplyV2CustomerOrder.update({ where: { id: o.id }, data: { status: 'EXPIRED', expiredAt: ahora } })
  if (o.kind === 'MEMBERSHIP') await soltarMembresiaDeOrdenEnTx(tx, o.id, `Compra vencida sin pagar (${o.number}).`, ctx)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_EXPIRED', 'SupplyV2CustomerOrder', o.id, { number: o.number, soltadas }, o.lines[0]?.offer.supplier.companyId ?? null)
  return true
}

/**
 * Expira las órdenes PENDING de una oferta cuya reserva ya caducó. Se llama con
 * la oferta bloqueada (checkout) y desde el barrido; ambas rutas pasan por
 * `expirarOrdenEnTx`, que solo actúa una vez por orden. Devuelve cuántas expiró.
 */
export async function expirarCaducadasDeOfertaEnTx(tx: Tx, offerId: string, ctx: ContextoAuditoria, ahora = new Date()): Promise<number> {
  const caducadas = await tx.supplyV2CustomerOrder.findMany({
    where: { status: 'PENDING', expiresAt: { lte: ahora }, lines: { some: { offerId } } },
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  })
  let expiradas = 0
  for (const o of caducadas) if (await expirarOrdenEnTx(tx, o.id, ctx, ahora)) expiradas++
  return expiradas
}

/** Membego revisó y NO vio el dinero: la reserva se suelta y la orden se cancela. */
export async function rechazarPagoEnTx(tx: Tx, orderId: string, motivo: string, ctx: ContextoAuditoria): Promise<void> {
  if (!motivo?.trim()) fallo('MOTIVO_OBLIGATORIO', 'Rechazar un pago exige un motivo.')
  const o = await ordenBloqueada(tx, orderId)
  if (!ORDEN_CLIENTE_CON_RESERVA.includes(o.status)) fallo('ORDEN_NO_RECHAZABLE', `Una compra ${o.status} no se puede rechazar.`)
  const soltadas = await soltarReservasEnTx(tx, o, `Pago rechazado (${o.number}): ${motivo.trim()}`, ctx.actorId)
  await tx.supplyV2CustomerOrder.update({
    where: { id: o.id },
    data: { status: 'CANCELLED', paymentStatus: 'REJECTED', paymentRejectedReason: motivo.trim(), cancelledAt: new Date() },
  })
  if (o.kind === 'MEMBERSHIP') await soltarMembresiaDeOrdenEnTx(tx, o.id, `Pago rechazado (${o.number}): ${motivo.trim()}`, ctx)
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_PAYMENT_REJECTED', 'SupplyV2CustomerOrder', o.id, { number: o.number, motivo: motivo.trim(), soltadas }, o.lines[0]?.offer.supplier.companyId ?? null)
}

// ── Pago ───────────────────────────────────────────────────────────────────

/** El cliente avisa que pagó (§29): la orden pasa a revisión y la reserva aguanta. */
export async function avisarPagoEnTx(
  tx: Tx,
  d: { orderId: string; customerId: string; method: SupplyV2PaymentMethod; reference?: string | null },
  ctx: ContextoAuditoria
): Promise<void> {
  const o = await ordenBloqueada(tx, d.orderId)
  if (o.customerId !== d.customerId) fallo('ORDEN_AJENA', 'Esa compra no es tuya.')
  if (o.status === 'AWAITING_PAYMENT') return
  if (o.total.isZero()) fallo('COBERTURA_TOTAL', 'Esta compra está cubierta por completo por tu beneficio: confírmala sin pago.')
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, o.status, 'AWAITING_PAYMENT', 'Compra')
  if (o.expiresAt <= new Date()) fallo('RESERVA_VENCIDA', 'La reserva de esta compra ya venció. Vuelve a comprar.')
  await tx.supplyV2CustomerOrder.update({
    where: { id: o.id },
    data: { status: 'AWAITING_PAYMENT', paymentStatus: 'SUBMITTED', paymentMethod: d.method, paymentReference: d.reference?.trim() || null, paymentSubmittedAt: new Date() },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_PAYMENT_SUBMITTED', 'SupplyV2CustomerOrder', o.id, {
    number: o.number,
    method: d.method,
    reference: d.reference?.trim() || null,
  }, o.lines[0]?.offer.supplier.companyId ?? null)
}

export interface PagoConfirmado {
  id: string
  number: string
  /** `lotId` nulo en ventas a comisión (Slice 5). */
  entitlements: { id: string; lotId: string | null; actualUnitCost: string }[]
  repetido: boolean
}

/**
 * CONFIRMACIÓN DEL PAGO (§30): una persona de Membego vio el dinero. En UNA
 * transacción: bloquear la orden → validar → RESERVED → ISSUED por lote →
 * un derecho por unidad con el costo REAL del lote → orden PAID → bitácora.
 * Idempotente: una orden ya PAID devuelve sus derechos sin emitir de nuevo.
 */
export async function confirmarPagoEnTx(
  tx: Tx,
  d: { orderId: string; amountSeen: number | string; method?: SupplyV2PaymentMethod | null },
  ctx: ContextoAuditoria
): Promise<PagoConfirmado> {
  if (!ctx.actorId) fallo('SIN_ACTOR', 'Confirmar un pago necesita quién lo confirma.')
  const o = await ordenBloqueada(tx, d.orderId)
  if (o.status === 'PAID') {
    const existentes = await tx.supplyV2Entitlement.findMany({ where: { orderId: o.id }, select: { id: true, lotId: true, actualUnitCost: true } })
    return { id: o.id, number: o.number, entitlements: existentes.map((e) => ({ ...e, actualUnitCost: e.actualUnitCost.toFixed(2) })), repetido: true }
  }
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, o.status, 'PAID', 'Compra')
  if (o.total.isZero()) fallo('COBERTURA_TOTAL', 'Esta compra está cubierta por completo por un beneficio: no hay pago bancario que confirmar. El cliente la confirma sin pago.')
  if (!montoCuadra(d.amountSeen, o.total)) {
    fallo('MONTO_NO_CUADRA', `El monto visto (${d.amountSeen}) no coincide con el total de la compra (${o.total.toFixed(2)}).`)
  }
  const entitlements = await emitirDerechosDeOrdenEnTx(tx, o, ctx)
  await tx.supplyV2CustomerOrder.update({
    where: { id: o.id },
    data: {
      status: 'PAID',
      paymentStatus: 'CONFIRMED',
      paidAt: new Date(),
      paymentConfirmedById: ctx.actorId,
      paymentAmountSeen: String(d.amountSeen),
      ...(d.method ? { paymentMethod: d.method } : {}),
    },
  })
  await auditarPagoYVentaEnTx(tx, o, entitlements, { amountSeen: String(d.amountSeen) }, ctx)
  // Slice 8 (§12, §16): si lo que se compró es una membresía, se activa AQUÍ,
  // con el pago ya confirmado y dentro de la misma transacción. No hay otra
  // puerta: una membresía de pago no se activa antes de cobrarla.
  if (o.kind === 'MEMBERSHIP') await activarMembresiaPorPagoEnTx(tx, o.id, ctx)
  // Slice 8 (§27): los puntos se acumulan con la venta YA confirmada, con la
  // regla congelada en el movimiento y una clave de idempotencia por pedido y
  // programa, así que un reintento de la confirmación no suma dos veces.
  await acumularPorCompraEnTodosEnTx(tx, o.id, ctx)
  // Slice 8 (§18, §21): ¿hace esta compra elegible a alguna invitación? La
  // elegibilidad se calcula entera en el servidor; abrir el enlace no paga.
  await evaluarCompraEnTx(tx, o.id, ctx)
  return { id: o.id, number: o.number, entitlements, repetido: false }
}

/**
 * Slice 6 (§21) · COBERTURA TOTAL: el beneficio cubre el 100 % y no hay
 * transferencia que esperar. El propio cliente (dueño de la orden) confirma;
 * el servidor exige total 0 y una reserva de beneficio viva. NO se marca como
 * pago bancario: `paymentStatus = COVERED_BY_BENEFIT`, importe visto 0.
 */
export async function confirmarCoberturaTotalEnTx(tx: Tx, d: { orderId: string; customerId: string }, ctx: ContextoAuditoria): Promise<PagoConfirmado> {
  const o = await ordenBloqueada(tx, d.orderId)
  if (o.customerId !== d.customerId) fallo('ORDEN_AJENA', 'Esa compra no es tuya.')
  if (o.status === 'PAID') {
    const existentes = await tx.supplyV2Entitlement.findMany({ where: { orderId: o.id }, select: { id: true, lotId: true, actualUnitCost: true } })
    return { id: o.id, number: o.number, entitlements: existentes.map((e) => ({ ...e, actualUnitCost: e.actualUnitCost.toFixed(2) })), repetido: true }
  }
  exigirTransicion(TRANSICIONES_ORDEN_CLIENTE, o.status, 'PAID', 'Compra')
  if (!o.total.isZero()) fallo('SALDO_PENDIENTE', `Esta compra tiene un saldo de ${o.total.toFixed(2)} que pagar: no es una cobertura total.`)
  if (!o.lines.some((l) => l.benefitReservation?.status === 'ACTIVE')) fallo('SIN_BENEFICIO', 'Esta compra no tiene un beneficio reservado que la cubra.')
  if (o.expiresAt <= new Date()) fallo('RESERVA_VENCIDA', 'La reserva de esta compra ya venció. Vuelve a comprar.')
  const entitlements = await emitirDerechosDeOrdenEnTx(tx, o, ctx)
  await tx.supplyV2CustomerOrder.update({
    where: { id: o.id },
    data: { status: 'PAID', paymentStatus: 'COVERED_BY_BENEFIT', paidAt: new Date(), paymentAmountSeen: 0 },
  })
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_COVERED_BY_BENEFIT', 'SupplyV2CustomerOrder', o.id, {
    number: o.number,
    contractualValue: o.lines.reduce((t, l) => t.plus(l.contractualValue), new Prisma.Decimal(0)).toFixed(2),
    membegoSubsidy: o.lines.reduce((t, l) => t.plus(l.membegoSubsidyAmount), new Prisma.Decimal(0)).toFixed(2),
    supplierDiscount: o.lines.reduce((t, l) => t.plus(l.supplierDiscountAmount), new Prisma.Decimal(0)).toFixed(2),
    entitlements: entitlements.length,
  }, o.lines[0]?.offer.supplier.companyId ?? null)
  await auditarPagoYVentaEnTx(tx, o, entitlements, { amountSeen: '0' }, ctx)
  await acumularPorCompraEnTodosEnTx(tx, o.id, ctx)
  await evaluarCompraEnTx(tx, o.id, ctx)
  return { id: o.id, number: o.number, entitlements, repetido: false }
}

/**
 * Emite los derechos de una orden (ambas fuentes), consolidando antes la
 * reserva del beneficio (§20). Compartido por el pago confirmado y por la
 * cobertura total. No cambia el estado de la orden: lo hace quien llama.
 */
async function emitirDerechosDeOrdenEnTx(tx: Tx, o: OrdenBloqueada, ctx: ContextoAuditoria): Promise<PagoConfirmado['entitlements']> {
  const reservadas = o.lines.reduce((t, l) => t + l.reservations.reduce((s, r) => s + r.quantity, 0) + l.commissionReservations.reduce((s, r) => s + r.quantity, 0), 0)
  const pedidas = o.lines.reduce((t, l) => t + l.quantity, 0)
  if (reservadas !== pedidas) fallo('RESERVA_INCOMPLETA', 'La reserva de esta compra ya no está completa: no se puede emitir.')
  // Slice 6 (§20): el beneficio se consolida ANTES de emitir; si su reserva ya no vive, nada se emite.
  for (const l of o.lines) {
    if (l.benefitReservation) {
      await aplicarReservaEnTx(tx, l.benefitReservation.id, ctx)
      // Slice 7 (§12): el uso del cupón se consolida con la reserva, en la misma
      // transacción. Aplicar un cupón no entrega nada: la entrega es el QR.
      await consolidarCuponEnTx(tx, l.benefitReservation.id, ctx)
    }
  }

  const entitlements: PagoConfirmado['entitlements'] = []
  for (const l of o.lines) {
    await tx.$queryRaw`SELECT "id" FROM "supply_v2_offers" WHERE "id" = ${l.offerId} FOR UPDATE`
    // Slice 5 (§18–§19): a COMISIÓN la reserva comercial se CONSUME y nace un
    // derecho por unidad sin lote, con costo 0 y la foto de comisión/neto.
    const unidades = unidadesDesdeLinea(l, l.offer.sourceType === 'COMMISSION')
    if (l.offer.sourceType === 'COMMISSION') {
      if (o.sourceType !== 'COMMISSION' || l.commissionPercentage == null) fallo('ORDEN_INCONSISTENTE', 'La orden no tiene la foto de la comisión.')
      if (!l.contractualValue.minus(l.commissionAmount).equals(l.supplierNet)) {
        fallo('ORDEN_INCONSISTENTE', 'El reparto congelado en la orden no cuadra con el motor de precios.')
      }
      for (const r of l.commissionReservations) {
        await tx.supplyV2CommissionReservation.update({ where: { id: r.id }, data: { status: 'CONSUMED', consumedAt: new Date() } })
      }
      for (let i = 0; i < l.quantity; i++) {
        const u = unidades[i]!
        const e = await tx.supplyV2Entitlement.create({
          data: {
            customerId: o.customerId,
            supplierId: l.offer.supplierId,
            catalogItemId: l.offer.catalogItemId,
            offerId: l.offer.id,
            orderId: o.id,
            orderLineId: l.id,
            allocationId: null,
            allocationLineId: null,
            lotId: null,
            sourceType: 'COMMISSION',
            agreementId: o.agreementId,
            agreementVersionId: o.agreementVersionId,
            quantity: 1,
            origin: 'PURCHASE',
            actualUnitCost: 0,
            customerUnitPrice: u.customerPaid,
            contractualUnitValue: u.contractualValue,
            supplierDiscountAmount: u.supplierDiscount,
            membegoSubsidyAmount: u.membegoSubsidy,
            commissionPercentage: l.commissionPercentage,
            commissionAmount: u.commissionAmount,
            supplierNet: u.supplierNet,
            currency: o.currency,
            status: 'ACTIVE',
            expiresAt: l.offer.endsAt,
          },
          select: { id: true, lotId: true, actualUnitCost: true },
        })
        entitlements.push({ id: e.id, lotId: e.lotId, actualUnitCost: e.actualUnitCost.toFixed(2) })
      }
      await marcarAgotadaSiCorrespondeEnTx(tx, l.offerId)
      continue
    }
    let emitidasEnLinea = 0
    for (const r of l.reservations) {
      const lote = await tx.supplyV2Lot.findUniqueOrThrow({ where: { id: r.lotId }, select: { unitCost: true, currency: true, expiresAt: true } })
      await registrarAsientoEnTx(
        tx,
        r.lotId,
        { type: 'ISSUE', sourceBucket: 'RESERVED', destinationBucket: 'ISSUED', quantity: r.quantity, reason: `Pago confirmado de la orden ${o.number}.` },
        { referenceType: 'CUSTOMER_ORDER', referenceId: o.id },
        ctx.actorId
      )
      await tx.supplyV2AllocationLine.update({
        where: { id: r.allocationLineId },
        data: { reservedQuantity: { decrement: r.quantity }, issuedQuantity: { increment: r.quantity } },
      })
      await tx.supplyV2OrderReservation.update({ where: { id: r.id }, data: { status: 'ISSUED', issuedAt: new Date() } })
      for (let i = 0; i < r.quantity; i++) {
        const u = unidades[emitidasEnLinea++]!
        const e = await tx.supplyV2Entitlement.create({
          data: {
            customerId: o.customerId,
            supplierId: l.offer.supplierId,
            catalogItemId: l.offer.catalogItemId,
            offerId: l.offer.id,
            orderId: o.id,
            orderLineId: l.id,
            allocationId: l.offer.allocationId!,
            allocationLineId: r.allocationLineId,
            lotId: r.lotId,
            quantity: 1,
            origin: 'PURCHASE',
            actualUnitCost: lote.unitCost,
            customerUnitPrice: u.customerPaid,
            contractualUnitValue: u.contractualValue,
            supplierDiscountAmount: u.supplierDiscount,
            membegoSubsidyAmount: u.membegoSubsidy,
            currency: lote.currency,
            status: 'ACTIVE',
            expiresAt: lote.expiresAt,
          },
          select: { id: true, lotId: true, actualUnitCost: true },
        })
        entitlements.push({ id: e.id, lotId: e.lotId, actualUnitCost: e.actualUnitCost.toFixed(2) })
      }
    }
    if (l.offer.allocationId) {
      const q = l.reservations.reduce((t, r) => t + r.quantity, 0)
      await tx.supplyV2Allocation.update({
        where: { id: l.offer.allocationId },
        data: { reservedQuantity: { decrement: q }, issuedQuantity: { increment: q } },
      })
    }
    await marcarAgotadaSiCorrespondeEnTx(tx, l.offerId)
  }
  return entitlements
}

async function auditarPagoYVentaEnTx(tx: Tx, o: OrdenBloqueada, entitlements: PagoConfirmado['entitlements'], d: { amountSeen: string }, ctx: ContextoAuditoria): Promise<void> {
  const companyId = o.lines[0]?.offer.supplier.companyId ?? null
  await auditarEnTx(tx, ctx, 'SUPPLY_V2_ORDER_PAID', 'SupplyV2CustomerOrder', o.id, {
    number: o.number,
    total: o.total.toString(),
    amountSeen: d.amountSeen,
    entitlements: entitlements.length,
  }, companyId)
  if (o.sourceType === 'COMMISSION') {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_COMMISSION_ORDER_PAID', 'SupplyV2CustomerOrder', o.id, {
      number: o.number,
      gmv: o.total.toFixed(2),
      commissionAmount: o.lines.reduce((t, l) => t.plus(l.commissionAmount), new Prisma.Decimal(0)).toFixed(2),
      supplierNet: o.lines.reduce((t, l) => t.plus(l.supplierNet), new Prisma.Decimal(0)).toFixed(2),
      entitlements: entitlements.length,
    }, companyId)
  }
  for (const e of entitlements) {
    await auditarEnTx(tx, ctx, 'SUPPLY_V2_ENTITLEMENT_ISSUED', 'SupplyV2Entitlement', e.id, {
      orderId: o.id,
      number: o.number,
      lotId: e.lotId,
      actualUnitCost: e.actualUnitCost,
      customerId: o.customerId,
    }, companyId)
    // Slice 4 (§24–§25, §29): ingreso + costo de la unidad, reconocidos UNA vez, aquí.
    await reconocerVentaEnTx(tx, e.id, ctx)
  }
}
