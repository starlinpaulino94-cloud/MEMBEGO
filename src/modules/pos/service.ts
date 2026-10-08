import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { crearTransaccionAplicada } from '@/lib/transactions/application/transaction-service'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'
import { PedidoError } from '@/modules/orders/errores'
import { ETIQUETA_METODO } from '@/modules/orders/formato'
import { qrDePedidoVencido } from '@/modules/orders/domain'
import {
  bloquearPedidoEnTx,
  cerrarPedidoExternoEnTx,
  completarPorQrEnTx,
  crearPedidoEnTx,
  registrarPagoEnTx,
  type ContextoPedido,
} from '@/modules/orders/service'
import { fallo, PosError } from './errores'
import {
  ETIQUETA_METODO_POS,
  ID_CLIENTE_DE_MOSTRADOR,
  NOMBRE_CLIENTE_DE_MOSTRADOR,
  claveDeVenta,
  claveDelEnvioValida,
  metodoDeCaja,
  metodoDePedido,
  validarCarrito,
  validarCobroPos,
  type CobroPos,
} from './domain'

/**
 * POS CONECTADO A COMMERCE CORE · el servicio (Fase 7).
 *
 * Dos cosas que la CAJA hace con un pedido Membego, cada una en UNA transacción:
 *
 *  1. `cobrarPedidoEnCajaEnTx` — la persona llegó con su pedido del marketplace (o el cupón de una
 *     oferta) y paga en el mostrador. Quien cobra ESCANEA O TECLEA el QR de la persona (la regla de
 *     F3 no cambia: un pedido de la vitrina se cierra solo con su QR), se registra el pago con su
 *     método y su referencia, se cierra el pedido (vende el stock, cobra la comisión o la cuota de la
 *     oferta) y queda el cobro en la caja del turno, con su ticket.
 *  2. `venderEnMostradorEnTx` — una venta de mostrador de variantes del catálogo, con cliente
 *     opcional: pedido `origin = POS`, existencias vendidas, cobro y ticket en la caja del turno.
 *
 * LO QUE ESTO NO HACE, A PROPÓSITO:
 *  · No hay comisión por una venta de mostrador pura. Membego cobra por lo que TRAE (marketplace y
 *    ofertas); cobrarle el 8 % a una empresa por lo que vende a su propia gente sin que la plataforma
 *    intervenga es una decisión de producto que no está tomada (ver `billing/domain.ts`,
 *    `ORIGENES_COMISIONABLES`). Sí comisiona, como siempre, el pedido del marketplace que se cobra aquí.
 *  · Una venta de mostrador no tiene la confirmación del cliente en su teléfono, así que su nivel de
 *    verificación nunca pasa de REDEEMED: la caja no inventa evidencia que el dominio de pedidos no da.
 *  · No hay descuentos manuales ni promociones del motor: el descuento de un pedido solo lo fija un flujo
 *    del servidor que lo verificó (una oferta con presupuesto). Quien tenga una, la cobra por el punto 1.
 *
 * SEGURIDAD: la empresa sale de la sesión (la acción), la caja tiene que estar ABIERTA y ser de esa
 * empresa, y el precio sale SIEMPRE del catálogo. El orden de candados es el de siempre: pedido →
 * oferta → inventario → cuenta de billing (aquí todo se delega a los servicios que ya lo respetan).
 */

export interface ContextoCaja {
  /** El `User` que cobra (va a la bitácora y al ticket). */
  actorId: string | null
  /** Nombre comercial de quien cobra, para el ticket (nunca el correo). */
  nombre: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

const empresa = (c: ContextoCaja): ContextoPedido => ({ actor: 'EMPRESA', actorId: c.actorId, ipAddress: c.ipAddress ?? null, userAgent: c.userAgent ?? null })
// El cierre de un pedido que no es del marketplace lo hace el SISTEMA, pero a nombre de quien cobra.
const sistemaACargoDe = (c: ContextoCaja): ContextoPedido => ({ actor: 'SISTEMA', actorId: c.actorId, ipAddress: c.ipAddress ?? null, userAgent: c.userAgent ?? null })

// ── La caja ──────────────────────────────────────────────────────────────────

export interface SesionDeCaja {
  id: string
  sucursalId: string
  sucursalNombre: string
}

/**
 * La caja cuenta en pesos: el arqueo y los tickets no llevan moneda. Un producto en otra moneda no se vende
 * ni se cobra aquí (entraría al cajón como si fueran pesos).
 */
export const MONEDA_DE_CAJA = 'DOP'

/** La caja tiene que estar abierta y ser de la empresa: sin caja abierta no se cobra. */
export async function sesionAbiertaEnTx(tx: Tx, companyId: string, cajaSesionId: string): Promise<SesionDeCaja> {
  if (typeof cajaSesionId !== 'string' || cajaSesionId === '') fallo('CAJA_CERRADA', 'La caja está cerrada: ábrela para poder cobrar.')
  const s = await tx.cajaSesion.findFirst({
    where: { id: cajaSesionId, companyId, estado: 'ABIERTA' },
    select: { id: true, sucursalId: true, sucursal: { select: { nombre: true } } },
  })
  if (!s) fallo('CAJA_CERRADA', 'La caja está cerrada: ábrela para poder cobrar.')
  return { id: s.id, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre }
}

// ── Lecturas para la pantalla ────────────────────────────────────────────────

export interface ProductoDeCaja {
  varianteId: string
  etiqueta: string
  precio: string
  currency: string
  /** Existencias disponibles en la sucursal de la caja; `null` si el producto no controla inventario. */
  disponible: number | null
}

/** Qué se puede vender en el mostrador: variantes activas de productos de la empresa que se venden en caja. */
export async function buscarProductosDeCajaEnTx(tx: Tx, companyId: string, sucursalId: string, q: string, limite = 20): Promise<ProductoDeCaja[]> {
  const termino = typeof q === 'string' ? q.trim().slice(0, 80) : ''
  const variantes = await tx.catalogVariant.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
      item: { status: 'ACTIVE', source: 'MERCHANT', currency: MONEDA_DE_CAJA, ...(termino ? { name: { contains: termino, mode: 'insensitive' as const } } : {}) },
    },
    orderBy: [{ item: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    take: 80,
    select: {
      id: true,
      name: true,
      price: true,
      item: { select: { name: true, type: true, capabilities: true, currency: true, variants: { select: { id: true } } } },
      inventoryLevels: { where: { locationId: sucursalId }, select: { onHand: true, reserved: true } },
    },
  })
  const out: ProductoDeCaja[] = []
  for (const v of variantes) {
    const caps = normalizarCapacidades(v.item.type, v.item.capabilities)
    if (!caps.availablePOS) continue
    const nivel = v.inventoryLevels[0]
    out.push({
      varianteId: v.id,
      etiqueta: v.item.variants.length > 1 ? `${v.item.name} · ${v.name}` : v.item.name,
      precio: v.price.toFixed(2),
      currency: v.item.currency,
      disponible: caps.trackInventory ? Math.max(0, (nivel?.onHand ?? 0) - (nivel?.reserved ?? 0)) : null,
    })
    if (out.length >= limite) break
  }
  return out
}

export interface ClienteDeCaja {
  id: string
  nombre: string
  telefono: string | null
}

/** Busca por nombre, teléfono o correo (mínimo dos letras). La ficha de «cliente de mostrador» no sale: se elige «sin registro». */
export async function buscarClientesDeCajaEnTx(tx: Tx, companyId: string, q: string, limite = 8): Promise<ClienteDeCaja[]> {
  const termino = typeof q === 'string' ? q.trim().slice(0, 80) : ''
  if (termino.length < 2) return []
  const digitos = termino.replace(/\D/g, '')
  const filas = await tx.cliente.findMany({
    where: {
      companyId,
      supabaseId: { not: ID_CLIENTE_DE_MOSTRADOR },
      OR: [
        { nombreBusqueda: { contains: normalizarBusqueda(termino) } },
        ...(digitos.length >= 4 ? [{ telefono: { contains: digitos } }] : []),
        { email: { contains: termino, mode: 'insensitive' as const } },
      ],
    },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    take: limite,
    select: { id: true, nombre: true, telefono: true },
  })
  return filas
}

/** La ficha compartida de quien paga sin que se le anote. Una por empresa, creada la primera vez. */
export async function clienteDeMostradorEnTx(tx: Tx, companyId: string): Promise<string> {
  const c = await tx.cliente.upsert({
    where: { supabaseId_companyId: { supabaseId: ID_CLIENTE_DE_MOSTRADOR, companyId } },
    update: {},
    create: { companyId, supabaseId: ID_CLIENTE_DE_MOSTRADOR, nombre: NOMBRE_CLIENTE_DE_MOSTRADOR, email: '', esLocal: true },
    select: { id: true },
  })
  return c.id
}

// ── Escribir el cobro en la caja ─────────────────────────────────────────────

interface LineaDeTicket {
  descripcion: string
  cantidad: number
  precioUnitario: number
  descuento: number
  total: number
}

async function registrarCobroEnCajaEnTx(
  tx: Tx,
  companyId: string,
  e: {
    sesion: SesionDeCaja
    pedido: { id: string; code: string; customerId: string; total: Prisma.Decimal; subtotal: Prisma.Decimal; discount: Prisma.Decimal }
    clienteNombre: string
    lineas: LineaDeTicket[]
    cobro: CobroPos
    detalle: string
    tipoDeOrden: 'PEDIDO_MEMBEGO' | 'VENTA_MOSTRADOR'
  },
  ctx: ContextoCaja
): Promise<{ id: string; codigo: string; ticketNumero: string }> {
  const total = Number(e.pedido.total.toFixed(2))
  const tx1 = await crearTransaccionAplicada(tx, {
    tipo: 'SALE',
    companyId,
    sucursalId: e.sesion.sucursalId,
    clienteId: e.pedido.customerId,
    empleadoId: ctx.actorId,
    caja: e.sesion.sucursalNombre,
    cajaSesionId: e.sesion.id,
    monto: total,
    metodoCobro: metodoDeCaja(e.cobro.metodo),
    snapshot: {
      detalle: e.detalle,
      cliente: e.clienteNombre,
      empleado: ctx.nombre ?? '',
      sucursal: e.sesion.sucursalNombre,
      servicio: e.detalle,
      ordenTipo: e.tipoDeOrden,
      ordenId: e.pedido.id,
      pedido: e.pedido.code,
      lineas: e.lineas,
      subtotal: e.pedido.subtotal.toFixed(2),
      descuento: e.pedido.discount.toFixed(2),
      total: e.pedido.total.toFixed(2),
      metodoCobroLabel: ETIQUETA_METODO_POS[e.cobro.metodo],
      ...(e.cobro.referencia ? { referencia: e.cobro.referencia } : {}),
      ...(e.cobro.recibido ? { recibido: e.cobro.recibido.toFixed(2), cambio: (e.cobro.cambio ?? new Prisma.Decimal(0)).toFixed(2) } : {}),
    },
    auditoria: { ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null },
    resultado: e.cobro.referencia,
    userId: ctx.actorId,
  })
  await tx.auditLog.create({
    data: {
      companyId,
      userId: ctx.actorId,
      accion: 'COBRO_REGISTRADO',
      entidadTipo: 'MembegoOrder',
      entidadId: e.pedido.id,
      payload: { codigo: tx1.codigo, pedido: e.pedido.code, monto: total, metodoCobro: e.cobro.metodo, tipo: e.tipoDeOrden, cajaSesionId: e.sesion.id },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  })
  return tx1
}

const aNumero = (d: Prisma.Decimal) => Number(d.toFixed(2))

function notasDeEfectivo(c: CobroPos): string | null {
  return c.recibido ? `Recibido ${c.recibido.toFixed(2)}, cambio ${(c.cambio ?? new Prisma.Decimal(0)).toFixed(2)}` : null
}

/** Por qué un pedido no se puede cobrar en ESTA caja, o `null` si se puede. */
function motivoNoCobrable(
  p: { code: string; origin: string; status: string; locationId: string; currency: string; qrExpiresAt: Date | null },
  sesion: SesionDeCaja,
  ahora: Date
): { codigo: string; mensaje: string } | null {
  if (p.currency !== MONEDA_DE_CAJA) return { codigo: 'MONEDA_NO_SOPORTADA', mensaje: `El pedido ${p.code} es en ${p.currency}: la caja solo cobra en pesos (${MONEDA_DE_CAJA}).` }
  if (p.origin === 'SUPPLY') return { codigo: 'PEDIDO_DE_SUPPLY', mensaje: 'Las compras de Membego Supply se entregan con el escáner, no se cobran en la caja: ya están pagadas.' }
  if (p.locationId !== sesion.sucursalId) return { codigo: 'OTRA_SUCURSAL', mensaje: `Este pedido es para otra sucursal: la caja abierta es la de «${sesion.sucursalNombre}».` }
  if (p.status === 'COMPLETED' || p.status === 'REFUNDED') return { codigo: 'YA_COBRADO', mensaje: `El pedido ${p.code} ya se canjeó.` }
  if (p.status === 'CANCELLED') return { codigo: 'PEDIDO_CANCELADO', mensaje: `El pedido ${p.code} fue cancelado.` }
  if (p.status !== 'READY') return { codigo: 'PEDIDO_NO_LISTO', mensaje: `El pedido ${p.code} todavía no está listo para cobrar.` }
  if (qrDePedidoVencido(p.qrExpiresAt, ahora)) return { codigo: 'QR_VENCIDO', mensaje: 'Este código QR venció. El cliente puede generar uno nuevo desde su pedido.' }
  return null
}

export interface PedidoParaCobrar {
  pedidoId: string
  code: string
  clienteNombre: string
  total: string
  lineas: { descripcion: string; cantidad: number; total: string }[]
  /** El cliente confirmó el monto vigente en su teléfono (sin esto, ni una transferencia verificada sube de nivel). */
  confirmado: boolean
  /** El título de la oferta si el pedido es el cupón de una. */
  oferta: string | null
  /**
   * El pago que YA tiene el pedido (por ejemplo, una transferencia que el negocio registró). Si existe, la caja no
   * cobra otra vez ni lo sustituye: solo entrega (`entregarSinCobrar`).
   */
  pagoRegistrado: { metodo: string; referencia: string | null; monto: string } | null
  puedeCobrar: boolean
  mensaje: string | null
}

/** Lo que la pantalla enseña antes de cobrar: el pedido de ese QR, y si esta caja lo puede cobrar. Solo lee. */
export async function pedidoParaCobrarEnTx(tx: Tx, companyId: string, cajaSesionId: string, tokenCrudo: unknown, ahora = new Date()): Promise<PedidoParaCobrar> {
  const sesion = await sesionAbiertaEnTx(tx, companyId, cajaSesionId)
  const token = typeof tokenCrudo === 'string' ? tokenCrudo.trim() : ''
  if (token === '' || token.length > 200) fallo('QR_INVALIDO', 'El código QR no es válido.')
  const p = await tx.membegoOrder.findFirst({
    where: { companyId, qrToken: token },
    include: {
      lines: { orderBy: { createdAt: 'asc' } },
      customer: { select: { nombre: true } },
      confirmation: { select: { confirmedTotal: true } },
      dealClaim: { select: { deal: { select: { title: true } } } },
      payment: { select: { method: true, reference: true, amount: true } },
    },
  })
  if (!p) fallo('QR_INVALIDO', 'Ese código QR no corresponde a ningún pedido de esta empresa.')
  const motivo = motivoNoCobrable(p, sesion, ahora)
  return {
    pedidoId: p.id,
    code: p.code,
    clienteNombre: p.customer.nombre,
    total: p.total.toFixed(2),
    lineas: p.lines.map((l) => ({ descripcion: l.description, cantidad: l.quantity, total: l.lineTotal.toFixed(2) })),
    confirmado: !!p.confirmation && p.confirmation.confirmedTotal.equals(p.total),
    oferta: p.dealClaim?.deal.title ?? null,
    pagoRegistrado: p.payment ? { metodo: ETIQUETA_METODO[p.payment.method], referencia: p.payment.reference, monto: p.payment.amount.toFixed(2) } : null,
    puedeCobrar: motivo === null,
    mensaje: motivo?.mensaje ?? null,
  }
}

// ── 1 · Cobrar un pedido Membego en la caja ──────────────────────────────────

export interface ResultadoDeCobro {
  pedidoId: string
  code: string
  total: string
  cambio: string | null
  nivel: string
  /** `null` cuando el pedido ya estaba pagado y la caja solo lo entregó: no entró dinero al cajón, no hay ticket. */
  transaccion: { id: string; codigo: string; ticketNumero: string } | null
}

/**
 * La persona llegó con su QR (de un pedido del marketplace o del cupón de una oferta): se registra su
 * pago, se cierra el pedido con ese QR y el cobro queda en la caja del turno. Todo o nada.
 *
 * UN PEDIDO QUE YA TIENE SU PAGO (una transferencia que el negocio registró desde el panel) NO se cobra otra
 * vez: cobrarlo sustituiría la evidencia verificada por la que teclee el cajero, bajaría el nivel de
 * verificación —y con él la comisión— y metería al arqueo un efectivo que nunca entró. Solo se entrega
 * (`entregarSinCobrar`), con la evidencia tal como estaba. Y al revés: `entregarSinCobrar` sin pago previo se
 * rechaza (no se entrega sin cobrar lo que no está pagado).
 *
 * El pedido se bloquea ANTES de leerlo: un ajuste de monto concurrente no puede dejar el cobro (la evidencia, el
 * movimiento de caja y el ticket) con un total distinto del que el pedido cierra.
 */
export async function cobrarPedidoEnCajaEnTx(
  tx: Tx,
  companyId: string,
  e: { cajaSesionId: string; token: string; metodo?: unknown; referencia?: unknown; recibido?: unknown; entregarSinCobrar?: unknown },
  ctx: ContextoCaja,
  ahora = new Date()
): Promise<ResultadoDeCobro> {
  const sesion = await sesionAbiertaEnTx(tx, companyId, e.cajaSesionId)
  const token = typeof e.token === 'string' ? e.token.trim() : ''
  if (token === '' || token.length > 200) fallo('QR_INVALIDO', 'El código QR no es válido.')

  const candidato = await tx.membegoOrder.findFirst({ where: { companyId, qrToken: token }, select: { id: true } })
  if (!candidato) fallo('QR_INVALIDO', 'Ese código QR no corresponde a ningún pedido de esta empresa.')
  // Bajo candado desde aquí: lo que se lea ya no cambia hasta que termine la transacción.
  const p = await bloquearPedidoEnTx(tx, companyId, candidato.id)
  if (p.qrToken !== token) fallo('QR_INVALIDO', 'Ese código QR ya no es el vigente de este pedido. Pide uno nuevo.')
  const cliente = await tx.cliente.findFirst({ where: { id: p.customerId, companyId }, select: { nombre: true } })
  const motivo = motivoNoCobrable(p, sesion, ahora)
  if (motivo) fallo(motivo.codigo, motivo.mensaje)

  const entregarSinCobrar = e.entregarSinCobrar === true
  if (entregarSinCobrar) {
    if (!p.payment) fallo('SIN_PAGO_REGISTRADO', 'Este pedido no tiene un pago registrado: cóbralo para entregarlo.')
    const cierre = await completarPorQrEnTx(tx, companyId, token, empresa(ctx), ahora)
    return { pedidoId: p.id, code: p.code, total: p.total.toFixed(2), cambio: null, nivel: cierre.nivel, transaccion: null }
  }
  if (p.payment) {
    const ref = p.payment.reference ? ` (ref. ${p.payment.reference})` : ''
    fallo('PEDIDO_YA_PAGADO', `El pedido ${p.code} ya tiene un pago registrado: ${ETIQUETA_METODO[p.payment.method]}${ref}. No se cobra otra vez: entrégalo sin cobrar.`)
  }

  const v = validarCobroPos({ metodo: e.metodo, referencia: e.referencia, recibido: e.recibido }, p.total)
  if (!v.ok) fallo('COBRO_INVALIDO', v.error)
  const cobro = v.cobro

  // El pago se registra ANTES de cerrar: el nivel de verificación se deriva al cerrar con la evidencia que haya.
  await registrarPagoEnTx(
    tx,
    companyId,
    p.id,
    { method: metodoDePedido(cobro.metodo), amount: p.total.toFixed(2), reference: cobro.referencia, notes: notasDeEfectivo(cobro) },
    empresa(ctx),
    ahora
  )
  const cierre = await completarPorQrEnTx(tx, companyId, token, empresa(ctx), ahora)

  const lineas = p.lines.map((l) => ({ descripcion: l.description, cantidad: l.quantity, precioUnitario: aNumero(l.unitPrice), descuento: aNumero(l.discount), total: aNumero(l.lineTotal) }))
  const tk = await registrarCobroEnCajaEnTx(
    tx,
    companyId,
    {
      sesion,
      pedido: p,
      clienteNombre: cliente?.nombre ?? '',
      lineas,
      cobro,
      detalle: p.lines.length === 1 ? p.lines[0].description : `Pedido ${p.code}`,
      tipoDeOrden: 'PEDIDO_MEMBEGO',
    },
    ctx
  )
  return { pedidoId: p.id, code: p.code, total: p.total.toFixed(2), cambio: cobro.cambio ? cobro.cambio.toFixed(2) : null, nivel: cierre.nivel, transaccion: tk }
}

// ── 2 · Venta de mostrador ───────────────────────────────────────────────────

export interface EntradaDeVenta {
  cajaSesionId: string
  lineas: unknown
  /** Una ficha de cliente de la empresa; vacío = «sin registro». */
  clienteId?: string | null
  metodo: unknown
  referencia?: unknown
  recibido?: unknown
  /** Identifica ESTE envío del formulario: reenviarlo no vende dos veces. */
  clave: unknown
}

export interface ResultadoDeVenta extends Omit<ResultadoDeCobro, 'transaccion'> {
  /** Una venta de mostrador siempre deja ticket (vacío solo si es el reenvío de una que ya existía). */
  transaccion: { id: string; codigo: string; ticketNumero: string }
  repetido: boolean
}

/** Una venta de mostrador de variantes del catálogo: pedido POS, existencias vendidas, cobro y ticket. Todo o nada. */
export async function venderEnMostradorEnTx(tx: Tx, companyId: string, e: EntradaDeVenta, ctx: ContextoCaja, ahora = new Date()): Promise<ResultadoDeVenta> {
  const sesion = await sesionAbiertaEnTx(tx, companyId, e.cajaSesionId)
  if (!claveDelEnvioValida(e.clave)) fallo('CLAVE_INVALIDA', 'Recarga la pantalla e inténtalo de nuevo.')
  const carrito = validarCarrito(e.lineas)
  if (!carrito.ok) fallo('CARRITO_INVALIDO', carrito.error)

  let customerId: string
  let clienteNombre: string
  if (typeof e.clienteId === 'string' && e.clienteId !== '') {
    const c = await tx.cliente.findFirst({ where: { id: e.clienteId, companyId }, select: { id: true, nombre: true } })
    if (!c) fallo('CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe.')
    customerId = c.id
    clienteNombre = c.nombre
  } else {
    customerId = await clienteDeMostradorEnTx(tx, companyId)
    clienteNombre = NOMBRE_CLIENTE_DE_MOSTRADOR
  }

  const clave = claveDeVenta(sesion.id, e.clave)
  let creado
  try {
    creado = await crearPedidoEnTx(
      tx,
      companyId,
      { customerId, locationId: sesion.sucursalId, origin: 'POS', lineas: carrito.lineas, atribucion: { channel: 'DIRECT' }, idempotencyKey: clave, notas: 'Venta de mostrador', ahora },
      empresa(ctx)
    )
  } catch (err) {
    if (err instanceof PedidoError) throw new PosError(err.codigo, err.message)
    throw err
  }

  // Reenviar el mismo formulario: la venta ya está hecha, no se cobra otra vez.
  if (creado.repetido) {
    const p = await tx.membegoOrder.findFirstOrThrow({ where: { id: creado.pedidoId, companyId }, select: { id: true, code: true, total: true, verificationLevel: true } })
    const previa = await tx.transaction.findFirst({ where: { companyId, cajaSesionId: sesion.id, snapshot: { path: ['ordenId'], equals: p.id } }, select: { id: true, codigo: true, ticketNumero: true } })
    return {
      pedidoId: p.id,
      code: p.code,
      total: p.total.toFixed(2),
      cambio: null,
      nivel: p.verificationLevel,
      transaccion: previa ?? { id: '', codigo: '', ticketNumero: '' },
      repetido: true,
    }
  }

  // La caja cuenta en pesos: una venta en otra moneda se deshace entera (la transacción no se confirma).
  const moneda = await tx.membegoOrder.findFirstOrThrow({ where: { id: creado.pedidoId, companyId }, select: { currency: true } })
  if (moneda.currency !== MONEDA_DE_CAJA) fallo('MONEDA_NO_SOPORTADA', `Esta venta es en ${moneda.currency}: la caja solo cobra en pesos (${MONEDA_DE_CAJA}).`)

  const total = new Prisma.Decimal(creado.total)
  const v = validarCobroPos(e, total)
  if (!v.ok) fallo('COBRO_INVALIDO', v.error)
  const cobro = v.cobro

  // Cierra el pedido en el acto (el cliente está presente y paga): sin QR, a nombre de quien cobra.
  const cierre = await cerrarPedidoExternoEnTx(
    tx,
    companyId,
    creado.pedidoId,
    { completedAt: ahora, confirmadoPorCliente: false, pago: { method: metodoDePedido(cobro.metodo), amount: total.toFixed(2), reference: cobro.referencia } },
    sistemaACargoDe(ctx)
  )

  const p = await tx.membegoOrder.findFirstOrThrow({ where: { id: creado.pedidoId, companyId }, include: { lines: { orderBy: { createdAt: 'asc' } } } })
  const lineas = p.lines.map((l) => ({ descripcion: l.description, cantidad: l.quantity, precioUnitario: aNumero(l.unitPrice), descuento: aNumero(l.discount), total: aNumero(l.lineTotal) }))
  const tk = await registrarCobroEnCajaEnTx(
    tx,
    companyId,
    { sesion, pedido: p, clienteNombre, lineas, cobro, detalle: p.lines.length === 1 ? p.lines[0].description : `Venta de mostrador ${p.code}`, tipoDeOrden: 'VENTA_MOSTRADOR' },
    ctx
  )
  return { pedidoId: p.id, code: p.code, total: p.total.toFixed(2), cambio: cobro.cambio ? cobro.cambio.toFixed(2) : null, nivel: cierre.nivel, transaccion: tk, repetido: false }
}
