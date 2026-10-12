import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { PedidoError } from '@/modules/orders/errores'
import { MAX_PEDIDOS_ABIERTOS_POR_CLIENTE } from '@/modules/orders/domain'
import { contarPedidosAbiertosEnTx, crearPedidoEnTx, type ContextoPedido } from '@/modules/orders/service'
import {
  CANALES_DE_CHECKOUT,
  MAX_CANTIDAD_POR_LINEA,
  MAX_LINEAS_CARRITO,
  esMetodoCheckout,
  metodoDePedidoDelCheckout,
  notaDelPedido,
  type LineaDeCarrito,
} from './domain'

/**
 * MARKETPLACE CHECKOUT · el servicio (Fase 8).
 *
 * Dos cosas, las dos dentro de la `tx` de quien llama (`conEmpresa`):
 *
 *  1. `resumenDelCarritoEnTx` — LEE el carrito de un negocio con lo que vale HOY: nombre, precio, si todavía
 *     se vende por el marketplace y, si ya se sabe la sucursal, cuántas existencias quedan allí. No cambia
 *     nada: es lo que se enseña mientras la persona arma su carrito y lo que revisa antes de pagar.
 *  2. `crearPedidoDelCarritoEnTx` — convierte el carrito en UN pedido Membego del negocio. En una sola
 *     transacción: valida, aparta las existencias de la sucursal elegida (todo o nada), toma los precios del
 *     catálogo y registra el pedido esperando a la empresa. Es `crearPedidoEnTx` de F3 con varios renglones;
 *     no hay otro camino para crear un pedido de la vitrina.
 *
 * LO QUE ESTO NO HACE: no cobra. El pedido nace «esperando a la empresa» como todos los de la vitrina; el pago
 * es al recoger o por transferencia que el negocio verifica (ver `docs/IMPLEMENTATION_STATUS.md`, F8). No hay
 * pasarela de tarjeta en línea. No aparta existencias mientras la persona navega: las aparta al pagar, de
 * golpe, sin carrera.
 */

export interface RenglonResumido {
  varianteId: string
  /** «Producto · Variante», o solo el producto si tiene una sola variante. */
  nombre: string
  precio: string
  cantidad: number
  subtotal: string
  /** Existencias disponibles en la sucursal pedida; `null` si el producto no las controla o no se pidió sucursal. */
  existencias: number | null
  /** Por qué este renglón no se puede pagar así, o `null` si sí. */
  problema: string | null
}

/** Lo que se enseña a cualquiera: el renglón SIN el número exacto de existencias (eso es del negocio). */
export type RenglonPublico = Omit<RenglonResumido, 'existencias'>

export interface ResumenDeCarrito {
  moneda: string
  renglones: RenglonResumido[]
  /** Suma de los renglones SIN problema. */
  total: string
  /** Hay al menos un renglón y ninguno tiene problema: se puede pagar. */
  comprable: boolean
}

export interface ResumenPublico extends Omit<ResumenDeCarrito, 'renglones'> {
  renglones: RenglonPublico[]
}

const NO_DISPONIBLE = 'Ya no está disponible.'

/**
 * Lo que se enseña a quien lo pide:
 *  · NUNCA el campo `existencias`;
 *  · lo que no se puede comprar (borrador, pausado, solo caja, de Supply, que ya no existe) sale sin su nombre ni su
 *    precio actual: un `varianteId` conocido no debe servir para leer el precio de algo que ya no es público;
 *  · el «solo quedan N» exacto únicamente con sesión de cliente (hace falta para corregir la cantidad al pagar); sin
 *    sesión se dice «no hay suficientes», que no revela cuántas existencias tiene el negocio en cada sucursal.
 */
export function aResumenPublico(r: ResumenDeCarrito, opciones: { conSesionDeCliente?: boolean } = {}): ResumenPublico {
  return {
    ...r,
    renglones: r.renglones.map(({ existencias: _e, ...resto }) => {
      void _e
      if (resto.problema === NO_DISPONIBLE) return { ...resto, nombre: 'Producto no disponible', precio: '0.00', subtotal: '0.00' }
      if (!opciones.conSesionDeCliente && resto.problema !== null && resto.problema.startsWith('Solo quedan')) return { ...resto, problema: 'No hay suficientes en esta sucursal.' }
      return resto
    }),
  }
}

const dos = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)

export async function resumenDelCarritoEnTx(tx: Tx, companyId: string, lineas: readonly LineaDeCarrito[], sucursalId: string | null): Promise<ResumenDeCarrito> {
  const pedidas = lineas.slice(0, MAX_LINEAS_CARRITO)
  const variantes = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: pedidas.map((l) => l.varianteId) } },
    select: {
      id: true,
      name: true,
      price: true,
      status: true,
      item: { select: { name: true, type: true, status: true, source: true, capabilities: true, currency: true, variants: { select: { id: true }, where: { status: { not: 'DISCONTINUED' } } } } },
      inventoryLevels: sucursalId ? { where: { locationId: sucursalId }, select: { onHand: true, reserved: true } } : false,
    },
  })
  const porId = new Map(variantes.map((v) => [v.id, v]))
  let total = 0
  let moneda: string | null = null
  const renglones: RenglonResumido[] = pedidas.map((l) => {
    const v = porId.get(l.varianteId)
    if (!v) return { varianteId: l.varianteId, nombre: 'Producto que ya no existe', precio: '0.00', cantidad: l.cantidad, subtotal: '0.00', existencias: null, problema: NO_DISPONIBLE }
    // Un pedido es de UNA moneda: el primer producto fija cuál, y los que vengan en otra no se pueden pagar juntos.
    if (moneda === null) moneda = v.item.currency
    const otraMoneda = v.item.currency !== moneda
    const caps = normalizarCapacidades(v.item.type, v.item.capabilities)
    const nombre = v.item.variants.length > 1 ? `${v.item.name} · ${v.name}` : v.item.name
    const precio = Number(v.price.toFixed(2))
    const nivel = Array.isArray(v.inventoryLevels) ? v.inventoryLevels[0] : undefined
    const existencias = caps.trackInventory && sucursalId ? Math.max(0, (nivel?.onHand ?? 0) - (nivel?.reserved ?? 0)) : null
    let problema: string | null = null
    if (v.item.status !== 'ACTIVE' || v.status !== 'ACTIVE' || v.item.source !== 'MERCHANT' || !caps.availableMarketplace) problema = NO_DISPONIBLE
    else if (otraMoneda) problema = `Este producto es en ${v.item.currency} y no se puede pagar junto con los demás (${moneda}).`
    else if (existencias !== null && existencias <= 0) problema = 'Agotado en esta sucursal.'
    else if (existencias !== null && l.cantidad > existencias) problema = `Solo quedan ${existencias} en esta sucursal.`
    const subtotal = precio * l.cantidad
    if (problema === null) total += subtotal
    return { varianteId: v.id, nombre, precio: dos(precio), cantidad: l.cantidad, subtotal: dos(subtotal), existencias, problema }
  })
  return { moneda: moneda ?? 'DOP', renglones, total: dos(total), comprable: renglones.length > 0 && renglones.every((r) => r.problema === null) }
}

export interface EntradaDeCheckout {
  customerId: string
  locationId: string
  lineas: readonly LineaDeCarrito[]
  metodo: unknown
  notas?: unknown
  canal?: unknown
  /** Identifica ESTE envío del formulario: reenviarlo devuelve el mismo pedido. */
  clave: string
}

export interface ResultadoDeCheckout {
  pedidoId: string
  code: string
  total: string
  repetido: boolean
}

/**
 * Lo que impediría el pedido y se sabe SIN crear nada: método, sucursal y que cada renglón se pueda comprar ahí. Solo lee.
 * Sirve para no afiliar a nadie (ficha, seguimiento, regalo de bienvenida) por un pedido que va a fallar; la última
 * palabra la sigue teniendo `crearPedidoDelCarritoEnTx` (existencias en carrera, tope de pedidos abiertos).
 */
export async function problemaDelPedidoEnTx(tx: Tx, companyId: string, e: { lineas: readonly LineaDeCarrito[]; locationId: string; metodo: unknown }): Promise<string | null> {
  if (!esMetodoCheckout(e.metodo)) return 'Elige cómo vas a pagar: al recoger o por transferencia.'
  const sucursal = await tx.sucursal.findFirst({ where: { id: e.locationId, companyId }, select: { nombre: true, activa: true } })
  if (!sucursal) return 'La sucursal no existe.'
  if (!sucursal.activa) return `La sucursal «${sucursal.nombre}» está desactivada.`
  const resumen = await resumenDelCarritoEnTx(tx, companyId, e.lineas, e.locationId)
  if (!resumen.comprable) return resumen.renglones.find((r) => r.problema)?.problema ?? 'Revisa tu carrito: algo cambió.'
  return null
}

/** Convierte el carrito de un negocio en UN pedido Membego, todo o nada. */
export async function crearPedidoDelCarritoEnTx(tx: Tx, companyId: string, e: EntradaDeCheckout, ctx: ContextoPedido, ahora = new Date()): Promise<ResultadoDeCheckout> {
  if (!esMetodoCheckout(e.metodo)) throw new PedidoError('METODO_INVALIDO', 'Elige cómo vas a pagar: al recoger o por transferencia.')
  if (!Array.isArray(e.lineas) || e.lineas.length === 0) throw new PedidoError('CARRITO_VACIO', 'Tu carrito está vacío.')
  if (e.lineas.length > MAX_LINEAS_CARRITO) throw new PedidoError('CARRITO_INVALIDO', `Un pedido admite como máximo ${MAX_LINEAS_CARRITO} productos distintos.`)
  for (const l of e.lineas) {
    if (typeof l.varianteId !== 'string' || l.varianteId === '' || !Number.isInteger(l.cantidad) || l.cantidad < 1 || l.cantidad > MAX_CANTIDAD_POR_LINEA) {
      throw new PedidoError('CARRITO_INVALIDO', `Cada producto lleva una cantidad entera entre 1 y ${MAX_CANTIDAD_POR_LINEA}.`)
    }
  }
  const canalCrudo = typeof e.canal === 'string' ? e.canal : ''
  const canal = (CANALES_DE_CHECKOUT as Record<string, 'MARKETPLACE_BROWSE' | 'MARKETPLACE_SEARCH' | 'DIRECT'>)[canalCrudo] ?? 'MARKETPLACE_BROWSE'

  const clave = `cli:${e.customerId}:${e.clave}`
  // Freno contra quien aparta existencias con pedidos que nunca recoge. Reintentar el MISMO envío (misma clave) no cuenta.
  const yaCreado = await tx.membegoOrder.findFirst({ where: { companyId, idempotencyKey: clave }, select: { id: true } })
  if (!yaCreado && (await contarPedidosAbiertosEnTx(tx, companyId, e.customerId)) >= MAX_PEDIDOS_ABIERTOS_POR_CLIENTE) {
    throw new PedidoError('DEMASIADOS_PEDIDOS_ABIERTOS', `Ya tienes ${MAX_PEDIDOS_ABIERTOS_POR_CLIENTE} pedidos abiertos con esta empresa. Espera a que atiendan alguno o cancela uno para hacer otro.`)
  }
  const r = await crearPedidoEnTx(
    tx,
    companyId,
    {
      customerId: e.customerId,
      locationId: e.locationId,
      origin: 'MARKETPLACE',
      // Solo variante y cantidad: el precio y el descuento no viajan.
      lineas: e.lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad })),
      atribucion: { channel: canal },
      paymentMethod: metodoDePedidoDelCheckout(e.metodo),
      notas: notaDelPedido(e.metodo, e.notas),
      idempotencyKey: clave,
      ahora,
    },
    ctx
  )
  return { pedidoId: r.pedidoId, code: r.code, total: r.total, repetido: r.repetido }
}
