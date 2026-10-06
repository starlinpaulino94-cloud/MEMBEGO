import { randomUUID } from 'node:crypto'
import { Prisma, type MembegoOrderOrigin, type MembegoOrderStatus, type MembegoPaymentMethod } from '@prisma/client'
import { siguienteNumero } from '@/lib/commerce-primitives/numeracion'
import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import type { ContextoAuditoria } from '@/modules/inventory/auditoria'
import { TTL_MAXIMO_MINUTOS } from '@/modules/inventory/domain'
import { InventarioError } from '@/modules/inventory/errores'
import { consumirReservaEnTx, devolverEnTx, liberarReservaEnTx, reservarEnTx, venderEnTx } from '@/modules/inventory/service'
import { nuevoTokenQr } from '@/modules/qr/token'
import { auditarPedido } from './auditoria'
import {
  ESTADOS_AJUSTABLES,
  ESTADOS_CANCELABLES,
  ESTADOS_CANCELABLES_POR_CLIENTE,
  ESTADOS_CON_PAGO_REGISTRABLE,
  ESTADOS_CONFIRMABLES,
  calcularPedido,
  confirmacionVigente,
  nivelDeVerificacion,
  normalizarMotivoPedido,
  normalizarNota,
  qrDePedidoVencido,
  validarAtribucion,
  validarPago,
  vencimientoQrPedido,
  type DatosAtribucion,
} from './domain'
import { fallo } from './errores'

/**
 * COMMERCE CORE · pedidos Membego — el servicio (Fase 3).
 *
 * El pedido unificado del marketplace. Cada función corre dentro de la `tx` de
 * quien llama (`conEmpresa`), así que el pedido, el inventario, la atribución y
 * la bitácora se confirman o se deshacen JUNTOS.
 *
 * CONCURRENCIA. Toda mutación de un pedido toma `SELECT … FOR UPDATE` sobre su
 * fila antes de leer su estado: dos escaneos del mismo QR, o un ajuste que se
 * cruza con una confirmación, se serializan. Quien llega segundo ve el estado
 * nuevo y recibe un mensaje claro, nunca un doble cierre. Debajo hay otra red:
 * el disparador `membego_orders_reglas` rechaza cualquier transición ilegal.
 *
 * PRECIOS. Salen SIEMPRE de la variante en la base, nunca de lo que mande quien
 * pide. Se congelan en la línea (el catálogo cambia; el pedido no).
 *
 * INVENTARIO. Las variantes que controlan inventario se APARTAN al crear el
 * pedido (reserva con la vigencia máxima), se VENDEN al cerrarlo y se LIBERAN al
 * cancelarlo. Si la reserva venció antes de cerrarse, se vende directamente de
 * lo disponible; si ya no alcanza, el cierre falla con un mensaje claro y el
 * pedido sigue LISTO (la empresa decide). Un servicio sin inventario no aparta
 * nada.
 *
 * QUIÉN. `ctx.actor` distingue empresa, cliente y sistema. Las acciones del
 * cliente exigen `customerId` y comprueban que el pedido sea suyo: el servicio
 * no confía en que la capa de arriba lo haya hecho.
 */

export interface ContextoPedido extends ContextoAuditoria {
  actor: 'EMPRESA' | 'CLIENTE' | 'SISTEMA'
}

/** El id que va a la bitácora: la FK es a `User`, y un cliente no siempre lo es. */
function contextoDeAuditoria(ctx: ContextoPedido): ContextoAuditoria {
  return { actorId: ctx.actor === 'CLIENTE' ? null : ctx.actorId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent }
}

/** Para el ledger de inventario: sí admite cualquier identificador (sin FK). */
function contextoDeInventario(ctx: ContextoPedido): ContextoAuditoria {
  return { actorId: ctx.actorId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent }
}

const REF_PEDIDO = 'ORDER'

export interface LineaPedido {
  varianteId: string
  cantidad: number
  /** Descuento en dinero sobre la línea (promociones). El cliente no lo fija. */
  descuento?: number | string
}

export interface EntradaPedido {
  customerId: string
  locationId: string
  origin: MembegoOrderOrigin
  lineas: readonly LineaPedido[]
  atribucion: DatosAtribucion
  paymentMethod?: MembegoPaymentMethod | null
  notas?: string | null
  /** Reintentar la MISMA creación devuelve el pedido ya creado. */
  idempotencyKey?: string | null
  /** El documento externo del que nace (envoltorio de Supply). */
  fuente?: { tipo: string; id: string } | null
  /** Impuestos del pedido (0 por defecto: la decisión fiscal es de una fase posterior). */
  impuesto?: number | string
  ahora?: Date
}

export interface ResultadoCreacion {
  pedidoId: string
  code: string
  status: MembegoOrderStatus
  total: string
  /** true si ya existía (misma clave de idempotencia o mismo documento de origen). */
  repetido: boolean
}

// ── Lectura y candado ────────────────────────────────────────────────────────

const INCLUIR_PEDIDO = {
  lines: { orderBy: { createdAt: 'asc' } },
  attribution: true,
  confirmation: true,
  payment: true,
} satisfies Prisma.MembegoOrderInclude

export type PedidoCompleto = Prisma.MembegoOrderGetPayload<{ include: typeof INCLUIR_PEDIDO }>

/** Toma el candado de la fila del pedido y lo lee ya bloqueado. */
async function pedidoBloqueado(tx: Tx, companyId: string, pedidoId: string): Promise<PedidoCompleto> {
  if (typeof pedidoId !== 'string' || pedidoId === '') fallo('PEDIDO_NO_ENCONTRADO', 'El pedido no existe.')
  const filas = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "membego_orders" WHERE "id" = ${pedidoId} AND "companyId" = ${companyId} FOR UPDATE`
  if (filas.length === 0) fallo('PEDIDO_NO_ENCONTRADO', 'El pedido no existe.')
  return tx.membegoOrder.findFirstOrThrow({ where: { id: pedidoId, companyId }, include: INCLUIR_PEDIDO })
}

/** Lectura sin candado (consultas). */
export async function obtenerPedidoEnTx(tx: Tx, companyId: string, pedidoId: string): Promise<PedidoCompleto | null> {
  return tx.membegoOrder.findFirst({ where: { id: pedidoId, companyId }, include: INCLUIR_PEDIDO })
}

function exigirDelCliente(pedido: { customerId: string }, ctx: ContextoPedido, customerId: string | undefined): void {
  if (ctx.actor !== 'CLIENTE') return
  // Mismo mensaje que «no existe»: no se revela que el pedido es de otra persona.
  if (!customerId || pedido.customerId !== customerId) fallo('PEDIDO_NO_ENCONTRADO', 'El pedido no existe.')
}

const decimalATexto = (d: Prisma.Decimal): string => d.toFixed(2)

// ── Crear ────────────────────────────────────────────────────────────────────

function claveValida(k: unknown): string | null {
  if (k === undefined || k === null || k === '') return null
  if (typeof k !== 'string' || k.length > 120) fallo('CLAVE_INVALIDA', 'La clave de idempotencia no es válida.')
  return k
}

function fuenteValida(f: EntradaPedido['fuente']): { tipo: string; id: string } | null {
  if (f === undefined || f === null) return null
  if (typeof f.tipo !== 'string' || typeof f.id !== 'string' || f.tipo === '' || f.id === '' || f.tipo.length > 60 || f.id.length > 120) {
    fallo('FUENTE_INVALIDA', 'El documento de origen del pedido no es válido.')
  }
  return f
}

/** Une las líneas que piden la misma variante: dos renglones iguales son uno solo. */
function unirLineas(lineas: readonly LineaPedido[]): LineaPedido[] {
  if (!Array.isArray(lineas) || lineas.length === 0) fallo('SIN_LINEAS', 'El pedido no tiene nada que pedir.')
  const porVariante = new Map<string, LineaPedido>()
  for (const l of lineas) {
    if (typeof l?.varianteId !== 'string' || l.varianteId === '') fallo('VARIANTE_NO_ENCONTRADA', 'Una de las líneas no indica qué se pide.')
    const previa = porVariante.get(l.varianteId)
    if (!previa) {
      porVariante.set(l.varianteId, { ...l })
      continue
    }
    previa.cantidad = (previa.cantidad ?? 0) + (l.cantidad ?? 0)
    if (l.descuento !== undefined || previa.descuento !== undefined) {
      previa.descuento = new Prisma.Decimal(previa.descuento ?? 0).plus(l.descuento ?? 0).toString()
    }
  }
  return [...porVariante.values()]
}

/**
 * Crea un pedido: valida cliente, sucursal y variantes, fija los precios desde el
 * catálogo, aparta el inventario de lo que lo controla, registra la atribución y
 * lo deja AWAITING_MERCHANT esperando a la empresa.
 */
export async function crearPedidoEnTx(tx: Tx, companyId: string, e: EntradaPedido, ctx: ContextoPedido): Promise<ResultadoCreacion> {
  const ahora = e.ahora ?? new Date()
  const clave = claveValida(e.idempotencyKey)
  const fuente = fuenteValida(e.fuente)

  // ¿Ya existe? Reintentar la misma creación no duplica el pedido.
  if (clave) {
    const previo = await tx.membegoOrder.findFirst({ where: { companyId, idempotencyKey: clave } })
    if (previo) {
      if (previo.customerId !== e.customerId) fallo('CLAVE_REUTILIZADA', 'Esa clave de idempotencia ya se usó para otro pedido.')
      return { pedidoId: previo.id, code: previo.code, status: previo.status, total: decimalATexto(previo.total), repetido: true }
    }
  }
  if (fuente) {
    const previo = await tx.membegoOrder.findFirst({ where: { companyId, sourceType: fuente.tipo, sourceId: fuente.id } })
    if (previo) return { pedidoId: previo.id, code: previo.code, status: previo.status, total: decimalATexto(previo.total), repetido: true }
  }

  const errorAtribucion = validarAtribucion(e.atribucion)
  if (errorAtribucion) fallo('ATRIBUCION_INVALIDA', errorAtribucion)
  const notas = normalizarNota(e.notas)
  if (!notas.ok) fallo('NOTA_INVALIDA', notas.error)

  const cliente = await tx.cliente.findFirst({ where: { id: e.customerId, companyId }, select: { id: true } })
  if (!cliente) fallo('CLIENTE_NO_ENCONTRADO', 'El cliente no existe.')
  const sucursal = await tx.sucursal.findFirst({ where: { id: e.locationId, companyId }, select: { id: true, nombre: true, activa: true } })
  if (!sucursal) fallo('SUCURSAL_NO_ENCONTRADA', 'La sucursal no existe.')
  if (!sucursal.activa) fallo('SUCURSAL_INACTIVA', `La sucursal «${sucursal.nombre}» está desactivada.`)

  const unidas = unirLineas(e.lineas)
  const variantes = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: unidas.map((l) => l.varianteId) } },
    include: { item: { select: { id: true, name: true, type: true, status: true, source: true, currency: true, capabilities: true } } },
  })
  const porId = new Map(variantes.map((v) => [v.id, v]))

  const lineasCalculo: { quantity: number; unitPrice: Prisma.Decimal; discount?: number | string }[] = []
  for (const l of unidas) {
    const v = porId.get(l.varianteId)
    if (!v) fallo('VARIANTE_NO_ENCONTRADA', 'Uno de los productos ya no existe.')
    const nombre = v.item.name
    if (v.item.status !== 'ACTIVE') fallo('ITEM_NO_DISPONIBLE', `«${nombre}» no está a la venta.`)
    if (v.status !== 'ACTIVE') fallo('VARIANTE_NO_DISPONIBLE', `«${nombre}» (${v.name}) no está disponible.`)
    const capacidades = normalizarCapacidades(v.item.type, v.item.capabilities)
    if (e.origin === 'MARKETPLACE' && !capacidades.availableMarketplace) fallo('ITEM_NO_DISPONIBLE', `«${nombre}» no se vende por el marketplace.`)
    if (e.origin === 'POS' && !capacidades.availablePOS) fallo('ITEM_NO_DISPONIBLE', `«${nombre}» no se vende en caja.`)
    // Las ofertas de Supply se compran por el checkout de Supply; el pedido de
    // Membego las envuelve (origin SUPPLY) pero no las vende por su cuenta.
    if (v.item.source === 'SUPPLY' && e.origin !== 'SUPPLY') fallo('ITEM_DE_SUPPLY', `«${nombre}» es una oferta de Membego Supply: se compra por su propio checkout.`)
    if (v.item.source !== 'SUPPLY' && e.origin === 'SUPPLY') fallo('ORIGEN_INCOHERENTE', `«${nombre}» no es una oferta de Supply.`)
    lineasCalculo.push({ quantity: l.cantidad, unitPrice: v.price, discount: l.descuento })
  }

  const monedas = new Set(variantes.map((v) => v.item.currency))
  if (monedas.size > 1) fallo('MONEDAS_MEZCLADAS', 'Un pedido no puede mezclar monedas.')
  const moneda = [...monedas][0] ?? 'DOP'

  let totales: ReturnType<typeof calcularPedido>
  try {
    totales = calcularPedido(lineasCalculo, { tax: e.impuesto })
  } catch (err) {
    fallo('PEDIDO_INVALIDO', err instanceof Error ? err.message : 'El pedido no es válido.')
  }

  const code = await siguienteNumero(
    tx,
    'MBG-PED',
    async (prefijo) => {
      const ultimo = await tx.membegoOrder.findFirst({
        where: { companyId, code: { startsWith: prefijo } },
        orderBy: { code: 'desc' },
        select: { code: true },
      })
      return ultimo?.code ?? null
    },
    ahora,
    `pedido:${companyId}`
  )

  const pedido = await tx.membegoOrder.create({
    data: {
      companyId,
      code,
      locationId: sucursal.id,
      customerId: cliente.id,
      status: 'CREATED',
      origin: e.origin,
      paymentMethod: e.paymentMethod ?? null,
      currency: moneda,
      subtotal: totales.subtotal,
      discount: totales.discount,
      adjustment: totales.adjustment,
      commissionableBase: totales.commissionableBase,
      tax: totales.tax,
      total: totales.total,
      notes: notas.valor,
      idempotencyKey: clave,
      sourceType: fuente?.tipo ?? null,
      sourceId: fuente?.id ?? null,
    },
  })

  // Aparta el inventario ANTES de escribir las líneas: la línea guarda el id de
  // su reserva y es inmutable. Si algo no alcanza, falla todo y no queda nada.
  for (let i = 0; i < unidas.length; i++) {
    const l = unidas[i]
    const v = porId.get(l.varianteId)!
    const calculada = totales.lineas[i]
    let reservaId: string | null = null
    if (normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory) {
      const r = await reservarEnTx(
        tx,
        companyId,
        {
          varianteId: v.id,
          sucursalId: sucursal.id,
          cantidad: l.cantidad,
          ttlMinutos: TTL_MAXIMO_MINUTOS,
          referencia: { tipo: REF_PEDIDO, id: pedido.id },
          idempotencyKey: `pedido:${pedido.id}:${v.id}`,
          ahora,
        },
        contextoDeInventario(ctx)
      )
      reservaId = r.reservaId
    }
    await tx.membegoOrderLine.create({
      data: {
        companyId,
        orderId: pedido.id,
        catalogVariantId: v.id,
        description: v.name && v.name !== v.item.name ? `${v.item.name} — ${v.name}` : v.item.name,
        sku: v.sku,
        quantity: calculada.quantity,
        unitPrice: calculada.unitPrice,
        discount: calculada.discount,
        lineTotal: calculada.lineTotal,
        inventoryReservationId: reservaId,
      },
    })
  }

  await tx.orderAttribution.create({
    data: {
      companyId,
      orderId: pedido.id,
      channel: e.atribucion.channel,
      campaignId: e.atribucion.campaignId ?? null,
      promotionId: e.atribucion.promotionId ?? null,
      referralCode: e.atribucion.referralCode ?? null,
      supplyV2OfferId: e.atribucion.supplyV2OfferId ?? null,
    },
  })

  await tx.membegoOrder.update({ where: { id: pedido.id }, data: { status: 'AWAITING_MERCHANT' } })

  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_CREATED', pedido.id, {
    code,
    por: ctx.actor,
    origen: e.origin,
    canal: e.atribucion.channel,
    lineas: unidas.length,
    total: decimalATexto(totales.total),
  })

  return { pedidoId: pedido.id, code, status: 'AWAITING_MERCHANT', total: decimalATexto(totales.total), repetido: false }
}

// ── Aceptar, ajustar, marcar listo ───────────────────────────────────────────

function exigirEstado(pedido: { code: string; status: MembegoOrderStatus }, permitidos: readonly MembegoOrderStatus[], mensaje: string): void {
  if (!permitidos.includes(pedido.status)) fallo('ESTADO_INVALIDO', `${mensaje} (el pedido ${pedido.code} está en ${pedido.status}).`)
}

/** La empresa acepta el pedido: empieza a atenderlo. */
export async function aceptarPedidoEnTx(tx: Tx, companyId: string, pedidoId: string, ctx: ContextoPedido, ahora = new Date()) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  if (p.status === 'IN_PROGRESS') return { pedidoId: p.id, status: p.status, repetido: true }
  exigirEstado(p, ['AWAITING_MERCHANT'], 'Solo se acepta un pedido que espera a la empresa')
  await tx.membegoOrder.update({ where: { id: p.id }, data: { status: 'IN_PROGRESS', acceptedAt: ahora } })
  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_ACCEPTED', p.id, { code: p.code, por: ctx.actor })
  return { pedidoId: p.id, status: 'IN_PROGRESS' as const, repetido: false }
}

/**
 * La empresa fija el ajuste del monto (+ recargo, − rebaja) con un motivo. Es el
 * valor TOTAL del ajuste, no un incremento: pedir el mismo dos veces no lo suma.
 * El cliente tiene que volver a confirmar el monto nuevo.
 */
export async function ajustarMontoEnTx(
  tx: Tx,
  companyId: string,
  pedidoId: string,
  e: { ajuste: number | string; motivo: string },
  ctx: ContextoPedido
) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  exigirEstado(p, ESTADOS_AJUSTABLES, 'El monto solo se ajusta mientras el pedido se atiende')
  const motivo = normalizarMotivoPedido(e.motivo)
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)

  let totales: ReturnType<typeof calcularPedido>
  try {
    // Mismas cifras que el pedido, con el ajuste nuevo: reutiliza la aritmética del dominio.
    totales = calcularPedido([{ quantity: 1, unitPrice: p.subtotal, discount: p.discount }], { adjustment: e.ajuste, tax: p.tax })
  } catch (err) {
    fallo('AJUSTE_INVALIDO', err instanceof Error ? err.message : 'El ajuste no es válido.')
  }

  const cambia = !totales.adjustment.equals(p.adjustment)
  if (!cambia) return { pedidoId: p.id, total: decimalATexto(p.total), repetido: true }

  await tx.membegoOrder.update({
    where: { id: p.id },
    data: {
      adjustment: totales.adjustment,
      adjustmentReason: totales.adjustment.isZero() ? null : motivo.valor,
      commissionableBase: totales.commissionableBase,
      total: totales.total,
      // La confirmación anterior era de otro monto: el cliente confirma de nuevo.
      customerConfirmedAt: null,
    },
  })
  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_ADJUSTED', p.id, {
    code: p.code,
    por: ctx.actor,
    motivo: motivo.valor,
    antes: { ajuste: decimalATexto(p.adjustment), total: decimalATexto(p.total) },
    despues: { ajuste: decimalATexto(totales.adjustment), total: decimalATexto(totales.total) },
  })
  return { pedidoId: p.id, total: decimalATexto(totales.total), repetido: false }
}

/**
 * La empresa marca el pedido LISTO: se emite el QR con el que el cliente lo
 * recoge. Puede venir directo de AWAITING_MERCHANT cuando no hay nada que preparar.
 */
export async function marcarListoEnTx(tx: Tx, companyId: string, pedidoId: string, ctx: ContextoPedido, ahora = new Date()) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  if (p.status === 'READY') return { pedidoId: p.id, status: p.status, qrToken: p.qrToken, qrExpiresAt: p.qrExpiresAt, repetido: true }
  exigirEstado(p, ['AWAITING_MERCHANT', 'IN_PROGRESS'], 'Solo se marca listo un pedido que se está atendiendo')
  const qrToken = nuevoTokenQr()
  const qrExpiresAt = vencimientoQrPedido(ahora)
  await tx.membegoOrder.update({
    where: { id: p.id },
    data: { status: 'READY', readyAt: ahora, acceptedAt: p.acceptedAt ?? ahora, qrToken, qrExpiresAt },
  })
  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_READY', p.id, { code: p.code, por: ctx.actor })
  return { pedidoId: p.id, status: 'READY' as const, qrToken, qrExpiresAt, repetido: false }
}

/** Emite un QR nuevo para un pedido LISTO (se perdió o venció). El anterior deja de valer. */
export async function renovarQrEnTx(
  tx: Tx,
  companyId: string,
  pedidoId: string,
  e: { customerId?: string },
  ctx: ContextoPedido,
  ahora = new Date()
) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  exigirDelCliente(p, ctx, e.customerId)
  exigirEstado(p, ['READY'], 'Solo un pedido listo tiene QR')
  const qrToken = nuevoTokenQr()
  const qrExpiresAt = vencimientoQrPedido(ahora)
  await tx.membegoOrder.update({ where: { id: p.id }, data: { qrToken, qrExpiresAt } })
  return { pedidoId: p.id, qrToken, qrExpiresAt }
}

// ── Confirmación del cliente y pago registrado ───────────────────────────────

async function recalcularNivel(tx: Tx, companyId: string, pedidoId: string): Promise<void> {
  const p = await tx.membegoOrder.findFirstOrThrow({ where: { id: pedidoId, companyId }, include: { confirmation: true, payment: true } })
  const nivel = nivelDeVerificacion({
    status: p.status,
    total: p.total,
    confirmacion: p.confirmation,
    pago: p.payment ? { method: p.payment.method, amount: p.payment.amount, reference: p.payment.reference } : null,
  })
  if (nivel !== p.verificationLevel) await tx.membegoOrder.update({ where: { id: p.id }, data: { verificationLevel: nivel } })
}

/**
 * El cliente confirma el monto. `montoVisto` es lo que tenía en pantalla: si la
 * empresa lo cambió entretanto, la confirmación se rechaza para que nadie
 * confirme una cifra que no vio.
 */
export async function confirmarMontoEnTx(
  tx: Tx,
  companyId: string,
  pedidoId: string,
  e: { customerId: string; montoVisto: number | string },
  ctx: ContextoPedido,
  ahora = new Date()
) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  exigirDelCliente(p, { ...ctx, actor: 'CLIENTE' }, e.customerId)
  exigirEstado(p, ESTADOS_CONFIRMABLES, 'El monto se confirma cuando la empresa ya aceptó el pedido')

  let visto: Prisma.Decimal
  try {
    visto = new Prisma.Decimal(e.montoVisto)
    if (!visto.isFinite()) throw new Error('no finito')
  } catch {
    fallo('MONTO_INVALIDO', 'El monto que confirmas no es válido.')
  }
  if (!visto.equals(p.total)) fallo('MONTO_CAMBIO', `El monto cambió a ${decimalATexto(p.total)}. Revísalo y vuelve a confirmar.`)

  if (confirmacionVigente(p.total, p.confirmation)) return { pedidoId: p.id, repetido: true }

  await tx.customerConfirmation.upsert({
    where: { orderId: p.id },
    create: { companyId, orderId: p.id, confirmedTotal: p.total, confirmedAt: ahora },
    update: { confirmedTotal: p.total, confirmedAt: ahora },
  })
  await tx.membegoOrder.update({ where: { id: p.id }, data: { customerConfirmedAt: ahora } })
  await recalcularNivel(tx, companyId, p.id)
  await auditarPedido(tx, contextoDeAuditoria({ ...ctx, actor: 'CLIENTE' }), companyId, 'ORDER_CONFIRMED', p.id, {
    code: p.code,
    por: 'CLIENTE',
    total: decimalATexto(p.total),
  })
  return { pedidoId: p.id, repetido: false }
}

/**
 * La empresa deja constancia de un pago hecho fuera de la plataforma. No mueve
 * dinero. Con un método verificable (tarjeta, transferencia), una referencia y el
 * monto del pedido, sube el nivel de verificación.
 */
export async function registrarPagoEnTx(
  tx: Tx,
  companyId: string,
  pedidoId: string,
  e: { method: MembegoPaymentMethod; amount: number | string; reference?: string | null; notes?: string | null },
  ctx: ContextoPedido,
  ahora = new Date()
) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  exigirEstado(p, ESTADOS_CON_PAGO_REGISTRABLE, 'El pago se registra cuando el pedido está listo o completado')
  const error = validarPago(e)
  if (error) fallo('PAGO_INVALIDO', error)
  const referencia = typeof e.reference === 'string' && e.reference.trim() !== '' ? e.reference.trim() : null
  const notas = typeof e.notes === 'string' && e.notes.trim() !== '' ? e.notes.trim().slice(0, 300) : null
  const monto = new Prisma.Decimal(e.amount)

  await tx.paymentEvidence.upsert({
    where: { orderId: p.id },
    create: { companyId, orderId: p.id, method: e.method, amount: monto, reference: referencia, notes: notas, recordedByUserId: ctx.actorId, recordedAt: ahora },
    update: { method: e.method, amount: monto, reference: referencia, notes: notas, recordedByUserId: ctx.actorId, recordedAt: ahora },
  })
  await tx.membegoOrder.update({ where: { id: p.id }, data: { paymentMethod: e.method } })
  await recalcularNivel(tx, companyId, p.id)
  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_PAYMENT_RECORDED', p.id, {
    code: p.code,
    por: ctx.actor,
    metodo: e.method,
    monto: decimalATexto(monto),
    conReferencia: referencia !== null,
  })
  return { pedidoId: p.id }
}

// ── Completar por QR ─────────────────────────────────────────────────────────

/** Vende lo apartado de una línea; si la reserva ya no sirve, vende de lo disponible. */
async function venderLinea(
  tx: Tx,
  companyId: string,
  pedido: { id: string; locationId: string },
  linea: { id: string; catalogVariantId: string; quantity: number; inventoryReservationId: string | null },
  ahora: Date,
  ctx: ContextoPedido
): Promise<void> {
  if (!linea.inventoryReservationId) return
  const referencia = { tipo: REF_PEDIDO, id: pedido.id }
  try {
    await consumirReservaEnTx(tx, companyId, linea.inventoryReservationId, { referencia, ahora }, contextoDeInventario(ctx))
    return
  } catch (err) {
    // La reserva venció o se liberó: el stock pudo haberse vendido a otra
    // persona. Se intenta vender de lo disponible; si no alcanza, falla el cierre.
    if (!(err instanceof InventarioError) || (err.codigo !== 'RESERVA_VENCIDA' && err.codigo !== 'RESERVA_LIBERADA')) throw err
  }
  try {
    await venderEnTx(
      tx,
      companyId,
      { varianteId: linea.catalogVariantId, sucursalId: pedido.locationId, cantidad: linea.quantity, referencia, idempotencyKey: `pedido:${pedido.id}:${linea.id}:venta`, ahora },
      contextoDeInventario(ctx)
    )
  } catch (err) {
    if (err instanceof InventarioError && err.codigo === 'STOCK_INSUFICIENTE') {
      fallo('STOCK_YA_NO_ALCANZA', 'La reserva de este pedido venció y ya no hay existencias suficientes. Repón el stock o cancela el pedido.')
    }
    throw err
  }
}

export interface ResultadoCierre {
  pedidoId: string
  code: string
  status: MembegoOrderStatus
  nivel: string
  repetido: boolean
}

/**
 * Cierra el pedido al escanear su QR. ATÓMICO: el candado de la fila hace que dos
 * escaneos simultáneos se serialicen; el segundo ve COMPLETED y recibe
 * `YA_COMPLETADO`. Vende el inventario apartado y fija el nivel de verificación
 * (REDEEMED, o más si el cliente ya confirmó el monto y hay un pago verificable).
 */
export async function completarPorQrEnTx(tx: Tx, companyId: string, token: string, ctx: ContextoPedido, ahora = new Date()): Promise<ResultadoCierre> {
  if (typeof token !== 'string' || token.trim() === '' || token.length > 200) fallo('QR_INVALIDO', 'El código QR no es válido.')
  const candidato = await tx.membegoOrder.findFirst({ where: { companyId, qrToken: token.trim() }, select: { id: true } })
  if (!candidato) fallo('QR_INVALIDO', 'Ese código QR no corresponde a ningún pedido de esta empresa.')

  const p = await pedidoBloqueado(tx, companyId, candidato.id)
  // Releído ya bajo candado: el token pudo cambiar (QR renovado) mientras esperaba.
  if (p.qrToken !== token.trim()) fallo('QR_INVALIDO', 'Ese código QR ya no es el vigente de este pedido. Pide uno nuevo.')
  if (p.status === 'COMPLETED' || p.status === 'REFUNDED') {
    const cuando = p.completedAt ? ` el ${p.completedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''
    fallo('YA_COMPLETADO', `El pedido ${p.code} ya se canjeó${cuando}.`)
  }
  if (p.status === 'CANCELLED') fallo('PEDIDO_CANCELADO', `El pedido ${p.code} fue cancelado.`)
  exigirEstado(p, ['READY'], 'El pedido todavía no está listo para canjear')
  if (qrDePedidoVencido(p.qrExpiresAt, ahora)) fallo('QR_VENCIDO', 'Este código QR venció. El cliente puede generar uno nuevo desde su pedido.')

  for (const l of p.lines) await venderLinea(tx, companyId, p, l, ahora, ctx)

  const nivel = nivelDeVerificacion({
    status: 'COMPLETED',
    total: p.total,
    confirmacion: p.confirmation,
    pago: p.payment ? { method: p.payment.method, amount: p.payment.amount, reference: p.payment.reference } : null,
  })
  await tx.membegoOrder.update({
    where: { id: p.id },
    data: { status: 'COMPLETED', completedAt: ahora, completedByUserId: ctx.actorId, verificationLevel: nivel },
  })
  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_COMPLETED', p.id, {
    code: p.code,
    por: ctx.actor,
    nivel,
    total: decimalATexto(p.total),
  })
  return { pedidoId: p.id, code: p.code, status: 'COMPLETED', nivel, repetido: false }
}

// ── Cancelar y reembolsar ────────────────────────────────────────────────────

/**
 * Cancela un pedido y libera lo apartado. El cliente solo puede cancelar antes
 * de que la empresa lo acepte; la empresa, hasta que se cierre. Cancelar un
 * pedido ya cancelado es inofensivo.
 */
export async function cancelarPedidoEnTx(
  tx: Tx,
  companyId: string,
  pedidoId: string,
  e: { motivo: string; customerId?: string },
  ctx: ContextoPedido,
  ahora = new Date()
) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  exigirDelCliente(p, ctx, e.customerId)
  if (p.status === 'CANCELLED') return { pedidoId: p.id, status: p.status, repetido: true }
  const motivo = normalizarMotivoPedido(e.motivo)
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)
  if (ctx.actor === 'CLIENTE') {
    if (!ESTADOS_CANCELABLES_POR_CLIENTE.includes(p.status)) {
      fallo('ESTADO_INVALIDO', `Ya no puedes cancelar este pedido porque la empresa lo está atendiendo (${p.code}). Comunícate con ella.`)
    }
  } else {
    exigirEstado(p, ESTADOS_CANCELABLES, 'Un pedido cerrado no se cancela; se reembolsa')
  }

  for (const l of p.lines) {
    if (!l.inventoryReservationId) continue
    await liberarReservaEnTx(tx, companyId, l.inventoryReservationId, { motivo: `Pedido ${p.code} cancelado`, ahora }, contextoDeInventario(ctx))
  }
  await tx.membegoOrder.update({
    where: { id: p.id },
    // El QR deja de valer con el pedido.
    data: { status: 'CANCELLED', cancelledAt: ahora, cancelReason: motivo.valor, qrToken: null, qrExpiresAt: null },
  })
  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_CANCELLED', p.id, { code: p.code, por: ctx.actor, motivo: motivo.valor, desde: p.status })
  return { pedidoId: p.id, status: 'CANCELLED' as const, repetido: false }
}

/**
 * Reembolsa un pedido ya completado. No mueve dinero (el pago fue externo):
 * deja constancia. Con `devolverAlInventario`, lo vendido vuelve a lo disponible.
 */
export async function reembolsarPedidoEnTx(
  tx: Tx,
  companyId: string,
  pedidoId: string,
  e: { motivo: string; devolverAlInventario?: boolean },
  ctx: ContextoPedido,
  ahora = new Date()
) {
  const p = await pedidoBloqueado(tx, companyId, pedidoId)
  if (p.status === 'REFUNDED') return { pedidoId: p.id, status: p.status, repetido: true }
  exigirEstado(p, ['COMPLETED'], 'Solo se reembolsa un pedido completado')
  const motivo = normalizarMotivoPedido(e.motivo)
  if (!motivo.ok) fallo('MOTIVO_INVALIDO', motivo.error)

  if (e.devolverAlInventario) {
    for (const l of p.lines) {
      if (!l.inventoryReservationId) continue // la variante no controla inventario
      await devolverEnTx(
        tx,
        companyId,
        {
          varianteId: l.catalogVariantId,
          sucursalId: p.locationId,
          cantidad: l.quantity,
          motivo: `Reembolso del pedido ${p.code}`,
          referencia: { tipo: REF_PEDIDO, id: p.id },
          idempotencyKey: `pedido:${p.id}:${l.id}:reembolso`,
          ahora,
        },
        contextoDeInventario(ctx)
      )
    }
  }
  await tx.membegoOrder.update({ where: { id: p.id }, data: { status: 'REFUNDED', refundedAt: ahora, refundReason: motivo.valor } })
  await auditarPedido(tx, contextoDeAuditoria(ctx), companyId, 'ORDER_REFUNDED', p.id, {
    code: p.code,
    por: ctx.actor,
    motivo: motivo.valor,
    devolvioStock: e.devolverAlInventario === true,
  })
  return { pedidoId: p.id, status: 'REFUNDED' as const, repetido: false }
}

/** Identificador de reintento para quien crea pedidos desde un formulario. */
export function nuevaClaveDePedido(): string {
  return randomUUID()
}
