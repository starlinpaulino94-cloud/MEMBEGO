import 'server-only'

import { Prisma } from '@prisma/client'
import type { SupplyVentaEstado } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { nuevoCodigoEntrega, numeroVenta } from './codigos'
import { crearCuentaPorPagarEnTx, moverCuenta } from './cuentas'
import { redondear2, repartirVenta } from './dinero'
import { TRANSICIONES_VENTA, exigirTransicion } from './estados'
import { cobroMembegoDisponible } from './cobro'

/**
 * MEMBEGO SUPPLY · VENTA SIN PRECOMPRA (§14 del encargo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OTRO MODELO ECONÓMICO, OTRA TABLA
 *
 * Aquí Membego no compró nada. Vende un producto del proveedor, cobra al
 * cliente RD$1.000, el proveedor lo entrega, y SOLO ENTONCES Membego le debe
 * RD$900 (bruto menos 10% de comisión). No hay lote, no hay derecho, no hay
 * ledger de cubetas: mezclarlo con `supply_lotes` haría que una venta a
 * comisión pareciera una unidad comprada y descuadraría el pool. El encargo
 * lo dice con esas palabras: «no mezclar con lotes prepagados».
 *
 *   Venta → Pago del cliente → Entrega → Cuenta por pagar → Liquidación
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SÍ SE REUTILIZA
 *
 * El cobro al cliente es el MISMO `SupplyPedido` que paga una unidad
 * precomprada (transferencia a las cuentas de Membego, comprobante, revisión
 * humana). Un pedido paga O un derecho O una venta, y la base lo exige. La
 * comisión y el reparto se congelan al abrir la venta desde la versión
 * vigente del acuerdo: enmendar la comisión después no toca ventas abiertas.
 *
 * La entrega la registra el ESCÁNER del proveedor con el `codigoEntrega`, que
 * es una credencial al portador igual que un voucher, con una diferencia: no
 * mueve ninguna cubeta. Lo que mueve es dinero: nace la cuenta por pagar.
 */

export interface DatosVenta {
  acuerdoId: string
  clienteId: string
  cantidad?: number
  sucursalId?: string | null
  claveIdempotencia?: string | null
  actorId?: string | null
}

export type ResultadoVenta =
  | { ok: true; ventaId: string; numero: string; montoBruto: number; reutilizada: boolean }
  | { ok: false; mensaje: string }

/**
 * Abre la venta (INICIADA) con el reparto congelado. NO abre el pedido: eso lo
 * hace `abrirPedidoDeVenta` en `cobro.ts`, que es quien conoce las cuentas de
 * Membego y el hold. Se separa para que la venta exista aunque el cobro falle
 * y el error se pueda explicar.
 */
export async function abrirVentaEnTx(tx: Tx, d: DatosVenta): Promise<ResultadoVenta> {
  const cantidad = d.cantidad ?? 1
  if (!Number.isInteger(cantidad) || cantidad <= 0) return { ok: false, mensaje: 'La cantidad tiene que ser un entero positivo.' }

  if (d.claveIdempotencia) {
    const previa = await tx.supplyVentaDirecta.findUnique({
      where: { claveIdempotencia: d.claveIdempotencia },
      select: { id: true, numero: true, montoBruto: true },
    })
    if (previa) return { ok: true, ventaId: previa.id, numero: previa.numero, montoBruto: Number(previa.montoBruto), reutilizada: true }
  }

  const acuerdo = await tx.supplyAcuerdo.findUnique({
    where: { id: d.acuerdoId },
    select: {
      id: true, proveedorId: true, estado: true, modeloComercial: true, version: true, cantidad: true,
      itemNombre: true, varianteEtiqueta: true, precioReferencia: true, comisionPorcentaje: true, moneda: true,
      inicioAt: true, finAt: true, sucursalIds: true,
    },
  })
  if (!acuerdo) return { ok: false, mensaje: 'Acuerdo no encontrado.' }
  if (acuerdo.modeloComercial !== 'COMISION') return { ok: false, mensaje: 'Este acuerdo no es de venta sin precompra.' }
  if (acuerdo.estado !== 'ACTIVO') return { ok: false, mensaje: `El acuerdo está ${acuerdo.estado.toLowerCase()}: no se puede vender.` }
  const ahora = new Date()
  if (acuerdo.inicioAt > ahora || acuerdo.finAt <= ahora) return { ok: false, mensaje: 'El acuerdo no está en vigencia.' }
  if (!acuerdo.precioReferencia || !acuerdo.comisionPorcentaje) {
    return { ok: false, mensaje: 'El acuerdo no tiene precio o comisión definidos.' }
  }
  if (d.sucursalId && acuerdo.sucursalIds.length > 0 && !acuerdo.sucursalIds.includes(d.sucursalId)) {
    return { ok: false, mensaje: 'Esa sucursal no está en el acuerdo.' }
  }

  // El tope de ventas del acuerdo (`cantidad`) se comprueba con el acuerdo
  // bloqueado: dos clientes comprando la última unidad no pueden pasar los dos.
  await tx.$queryRaw`SELECT "id" FROM "supply_acuerdos" WHERE "id" = ${acuerdo.id} FOR UPDATE`
  const vendidas = await tx.supplyVentaDirecta.aggregate({
    where: { acuerdoId: acuerdo.id, estado: { in: ['INICIADA', 'PAGADA', 'ENTREGADA'] } },
    _sum: { cantidad: true },
  })
  if ((vendidas._sum.cantidad ?? 0) + cantidad > acuerdo.cantidad) {
    return { ok: false, mensaje: 'Este acuerdo ya alcanzó el máximo de unidades que Membego puede vender.' }
  }

  const reparto = repartirVenta(Number(acuerdo.precioReferencia), cantidad, Number(acuerdo.comisionPorcentaje))
  const secuencia = (await tx.supplyVentaDirecta.count()) + 1
  const venta = await tx.supplyVentaDirecta.create({
    data: {
      numero: numeroVenta(secuencia),
      proveedorId: acuerdo.proveedorId,
      acuerdoId: acuerdo.id,
      acuerdoVersion: acuerdo.version,
      clienteId: d.clienteId,
      sucursalId: d.sucursalId ?? null,
      estado: 'INICIADA',
      itemNombre: acuerdo.itemNombre,
      varianteEtiqueta: acuerdo.varianteEtiqueta,
      cantidad,
      precioUnitario: acuerdo.precioReferencia,
      montoBruto: new Prisma.Decimal(reparto.montoBruto),
      comisionPorcentaje: new Prisma.Decimal(reparto.comisionPorcentaje),
      comisionMonto: new Prisma.Decimal(reparto.comisionMonto),
      montoProveedor: new Prisma.Decimal(reparto.montoProveedor),
      moneda: acuerdo.moneda,
      codigoEntrega: nuevoCodigoEntrega(),
      claveIdempotencia: d.claveIdempotencia ?? null,
      meta: d.actorId ? { actorId: d.actorId } : {},
    },
    select: { id: true, numero: true },
  })
  return { ok: true, ventaId: venta.id, numero: venta.numero, montoBruto: reparto.montoBruto, reutilizada: false }
}

/** Membego vio el dinero (lo llama `confirmarPedido`). */
export async function marcarVentaPagadaEnTx(tx: Tx, ventaId: string): Promise<void> {
  const v = await tx.supplyVentaDirecta.findUnique({ where: { id: ventaId }, select: { estado: true } })
  if (!v) throw new Error('Venta no encontrada.')
  exigirTransicion(TRANSICIONES_VENTA, v.estado, 'PAGADA', 'Venta sin precompra')
  await tx.supplyVentaDirecta.update({ where: { id: ventaId }, data: { estado: 'PAGADA', pagadaAt: new Date() } })
}

export const MOTIVOS_RECHAZO_VENTA = ['DESCONOCIDA', 'NO_PAGADA', 'YA_ENTREGADA', 'CANCELADA', 'OTRO_COMERCIO', 'OTRA_SUCURSAL'] as const
export type MotivoRechazoVenta = (typeof MOTIVOS_RECHAZO_VENTA)[number]

const MENSAJE_RECHAZO: Record<MotivoRechazoVenta, string> = {
  DESCONOCIDA: 'Este código no corresponde a ninguna venta.',
  NO_PAGADA: 'Esta venta todavía no está pagada: no se puede entregar.',
  YA_ENTREGADA: 'Esta venta YA FUE ENTREGADA.',
  CANCELADA: 'Esta venta fue cancelada o reembolsada.',
  OTRO_COMERCIO: 'Esta venta es de otra empresa.',
  OTRA_SUCURSAL: 'Esta venta se recoge en otra sucursal.',
}

export type ResultadoEntregaVenta =
  | { ok: true; ventaId: string; cuentaPorPagarId: string; montoProveedor: number; reutilizada: boolean }
  | { ok: false; motivo: MotivoRechazoVenta; mensaje: string; detalle?: { fecha: Date } }

/**
 * EL PROVEEDOR ENTREGA. Aquí y solo aquí nace la cuenta por pagar por el
 * neto: entregar es el hecho que convierte un cobro de Membego en una deuda
 * con el proveedor. Bloquea la venta: dos empleados escaneando a la vez no
 * pueden entregar dos veces ni crear dos cuentas (además, `ventaId` es único
 * en la cuenta por pagar).
 */
export async function entregarVenta(d: {
  ventaId: string
  proveedorId: string
  sucursalId?: string | null
  empleadoId?: string | null
}): Promise<ResultadoEntregaVenta> {
  return sinEmpresa('Membego Supply: el proveedor entrega una venta sin precompra', async (tx) => {
    const filas = await tx.$queryRaw<{ id: string; estado: SupplyVentaEstado; entregadaAt: Date | null }[]>`
      SELECT "id", "estado", "entregadaAt" FROM "supply_ventas_directas" WHERE "id" = ${d.ventaId} FOR UPDATE
    `
    if (!filas[0]) return { ok: false, motivo: 'DESCONOCIDA', mensaje: MENSAJE_RECHAZO.DESCONOCIDA }
    const v = await tx.supplyVentaDirecta.findUniqueOrThrow({
      where: { id: d.ventaId },
      select: {
        id: true, estado: true, proveedorId: true, acuerdoId: true, sucursalId: true, numero: true, itemNombre: true,
        cantidad: true, montoBruto: true, comisionMonto: true, montoProveedor: true, moneda: true, entregadaAt: true,
        cuentaPorPagar: { select: { id: true } },
        acuerdo: { select: { plazoPagoDias: true, sucursalIds: true } },
      },
    })
    if (v.estado === 'ENTREGADA') {
      // Idempotente para el doble toque: devuelve la entrega que ya existe.
      if (v.cuentaPorPagar) {
        return { ok: true, ventaId: v.id, cuentaPorPagarId: v.cuentaPorPagar.id, montoProveedor: Number(v.montoProveedor), reutilizada: true }
      }
      return { ok: false, motivo: 'YA_ENTREGADA', mensaje: MENSAJE_RECHAZO.YA_ENTREGADA, detalle: { fecha: v.entregadaAt ?? new Date() } }
    }
    if (v.estado === 'CANCELADA' || v.estado === 'REEMBOLSADA') return { ok: false, motivo: 'CANCELADA', mensaje: MENSAJE_RECHAZO.CANCELADA }
    if (v.estado !== 'PAGADA') return { ok: false, motivo: 'NO_PAGADA', mensaje: MENSAJE_RECHAZO.NO_PAGADA }
    if (v.proveedorId !== d.proveedorId) return { ok: false, motivo: 'OTRO_COMERCIO', mensaje: MENSAJE_RECHAZO.OTRO_COMERCIO }
    if (d.sucursalId && v.acuerdo.sucursalIds.length > 0 && !v.acuerdo.sucursalIds.includes(d.sucursalId)) {
      return { ok: false, motivo: 'OTRA_SUCURSAL', mensaje: MENSAJE_RECHAZO.OTRA_SUCURSAL }
    }

    const ahora = new Date()
    const vencimiento = v.acuerdo.plazoPagoDias != null ? new Date(ahora.getTime() + v.acuerdo.plazoPagoDias * 86_400_000) : null
    const cxp = await crearCuentaPorPagarEnTx(tx, {
      proveedorId: v.proveedorId,
      acuerdoId: v.acuerdoId,
      origen: 'VENTA_DIRECTA',
      descripcion: `Venta ${v.numero} · ${v.cantidad} × ${v.itemNombre}`,
      montoBruto: Number(v.montoBruto),
      comision: Number(v.comisionMonto),
      moneda: v.moneda,
      vencimientoAt: vencimiento,
      ventaId: v.id,
      creadoPorId: d.empleadoId ?? null,
      claveIdempotencia: `venta-entregada:${v.id}`,
    })

    await tx.supplyVentaDirecta.update({
      where: { id: v.id },
      data: {
        estado: 'ENTREGADA',
        entregadaAt: ahora,
        entregadaPorId: d.empleadoId ?? null,
        sucursalId: d.sucursalId ?? v.sucursalId,
      },
    })
    return { ok: true, ventaId: v.id, cuentaPorPagarId: cxp.id, montoProveedor: cxp.montoNeto, reutilizada: false }
  })
}

/**
 * Cancela (antes de entregar) o reembolsa (después de pagar). Reembolsar una
 * venta ENTREGADA cancela además su cuenta por pagar con motivo, si sigue
 * viva: el proveedor no cobra por un producto que se devolvió.
 */
export async function cerrarVenta(
  ventaId: string,
  hasta: Extract<SupplyVentaEstado, 'CANCELADA' | 'REEMBOLSADA'>,
  motivo: string,
  actorId?: string | null
): Promise<void> {
  if (!motivo.trim()) throw new Error('Cancelar o reembolsar una venta exige un motivo.')
  const venta = await sinEmpresa('Membego Supply: cerrar una venta sin precompra', async (tx) => {
    const v = await tx.supplyVentaDirecta.findUnique({
      where: { id: ventaId },
      select: { estado: true, cuentaPorPagar: { select: { id: true, estado: true, liquidacionId: true } } },
    })
    if (!v) throw new Error('Venta no encontrada.')
    exigirTransicion(TRANSICIONES_VENTA, v.estado, hasta, 'Venta sin precompra')
    if (v.cuentaPorPagar?.liquidacionId) {
      throw new Error('La cuenta por pagar de esta venta ya entró en una liquidación: disputa la liquidación.')
    }
    await tx.supplyVentaDirecta.update({
      where: { id: ventaId },
      data: { estado: hasta, canceladaAt: new Date(), canceladaMotivo: motivo.trim() },
    })
    return v
  })
  if (venta.cuentaPorPagar && (venta.cuentaPorPagar.estado === 'ABIERTA' || venta.cuentaPorPagar.estado === 'PARCIALMENTE_SALDADA' || venta.cuentaPorPagar.estado === 'DISPUTADA')) {
    await moverCuenta('CXP', venta.cuentaPorPagar.id, 'CANCELADA', `Venta ${hasta.toLowerCase()}: ${motivo.trim()}`, actorId)
  }
}

// ── Escáner ─────────────────────────────────────────────────────────────────

export interface FichaVenta {
  ventaId: string
  numero: string
  estado: SupplyVentaEstado
  cliente: string
  producto: string
  variante: string | null
  cantidad: number
  proveedor: string
  montoBruto: number
  sucursalId: string | null
}

/** Resuelve un código de entrega SIN entregar (paso 1 del escáner). */
export async function fichaDeVentaPorCodigo(tx: Tx, codigoEntrega: string): Promise<FichaVenta | null> {
  const v = await tx.supplyVentaDirecta.findUnique({
    where: { codigoEntrega },
    select: {
      id: true, numero: true, estado: true, itemNombre: true, varianteEtiqueta: true, cantidad: true, montoBruto: true, sucursalId: true,
      cliente: { select: { nombre: true } },
      proveedor: { select: { name: true } },
    },
  })
  if (!v) return null
  return {
    ventaId: v.id, numero: v.numero, estado: v.estado, cliente: v.cliente.nombre, producto: v.itemNombre,
    variante: v.varianteEtiqueta, cantidad: v.cantidad, proveedor: v.proveedor.name, montoBruto: Number(v.montoBruto), sucursalId: v.sucursalId,
  }
}

// ── Vitrina y lecturas ──────────────────────────────────────────────────────

export interface OfertaVenta {
  acuerdoId: string
  producto: string
  variante: string | null
  proveedor: string
  proveedorSlug: string
  precio: number
  disponibles: number
  finAt: Date
}

/** Acuerdos a comisión vigentes con cupo, para la vitrina. Solo si Membego puede cobrar. */
export async function ofertasDeVenta(limite = 50): Promise<OfertaVenta[]> {
  if (!(await cobroMembegoDisponible())) return []
  return sinEmpresa('Membego Supply: vitrina de ventas sin precompra', async (tx) => {
    const ahora = new Date()
    const acuerdos = await tx.supplyAcuerdo.findMany({
      where: { modeloComercial: 'COMISION', estado: 'ACTIVO', inicioAt: { lte: ahora }, finAt: { gt: ahora } },
      take: limite,
      select: {
        id: true, itemNombre: true, varianteEtiqueta: true, precioReferencia: true, cantidad: true, finAt: true,
        proveedor: { select: { name: true, slug: true } },
      },
    })
    const out: OfertaVenta[] = []
    for (const a of acuerdos) {
      const vendidas = await tx.supplyVentaDirecta.aggregate({
        where: { acuerdoId: a.id, estado: { in: ['INICIADA', 'PAGADA', 'ENTREGADA'] } },
        _sum: { cantidad: true },
      })
      const disponibles = a.cantidad - (vendidas._sum.cantidad ?? 0)
      if (disponibles <= 0 || !a.precioReferencia) continue
      out.push({
        acuerdoId: a.id, producto: a.itemNombre, variante: a.varianteEtiqueta, proveedor: a.proveedor.name,
        proveedorSlug: a.proveedor.slug, precio: Number(a.precioReferencia), disponibles, finAt: a.finAt,
      })
    }
    return out
  })
}

export async function listarVentas(f: { proveedorId?: string; estado?: SupplyVentaEstado; desde?: Date; hasta?: Date; limite?: number } = {}) {
  return sinEmpresa('Membego Supply: ventas sin precompra', (tx) =>
    tx.supplyVentaDirecta.findMany({
      where: {
        ...(f.proveedorId ? { proveedorId: f.proveedorId } : {}),
        ...(f.estado ? { estado: f.estado } : {}),
        ...(f.desde || f.hasta ? { createdAt: { ...(f.desde ? { gte: f.desde } : {}), ...(f.hasta ? { lte: f.hasta } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: f.limite ?? 300,
      select: {
        id: true, numero: true, estado: true, itemNombre: true, cantidad: true, montoBruto: true, comisionMonto: true,
        montoProveedor: true, moneda: true, pagadaAt: true, entregadaAt: true, createdAt: true, canceladaMotivo: true,
        cliente: { select: { nombre: true } },
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        sucursal: { select: { nombre: true } },
        entregadaPor: { select: { name: true } },
        cuentaPorPagar: { select: { codigo: true, estado: true } },
        pedido: { select: { numero: true, estado: true } },
      },
    })
  )
}

/** Ventas de una persona, para su pantalla, con el código de recogida. */
export async function ventasDelCliente(clienteIds: readonly string[], limite = 30) {
  if (clienteIds.length === 0) return []
  return sinEmpresa('Membego Supply: ventas de un cliente', (tx) =>
    tx.supplyVentaDirecta.findMany({
      where: { clienteId: { in: [...clienteIds] } },
      orderBy: { createdAt: 'desc' },
      take: limite,
      select: {
        id: true, numero: true, estado: true, itemNombre: true, varianteEtiqueta: true, cantidad: true, montoBruto: true,
        codigoEntrega: true, entregadaAt: true, createdAt: true,
        proveedor: { select: { name: true } },
        sucursal: { select: { nombre: true } },
        pedido: { select: { id: true, numero: true, estado: true, monto: true, motivoRechazo: true, expiraAt: true } },
      },
    })
  )
}

/** Cifras del tablero: ventas del período y su economía. */
export async function resumenVentas(tx: Tx, desde: Date, hasta: Date, proveedorId?: string) {
  const filas = await tx.supplyVentaDirecta.findMany({
    where: { estado: { in: ['PAGADA', 'ENTREGADA'] }, createdAt: { gte: desde, lte: hasta }, ...(proveedorId ? { proveedorId } : {}) },
    select: { estado: true, montoBruto: true, comisionMonto: true, montoProveedor: true },
  })
  return {
    ventas: filas.length,
    entregadas: filas.filter((v) => v.estado === 'ENTREGADA').length,
    bruto: redondear2(filas.reduce((t, v) => t + Number(v.montoBruto), 0)),
    comision: redondear2(filas.reduce((t, v) => t + Number(v.comisionMonto), 0)),
    proveedor: redondear2(filas.reduce((t, v) => t + Number(v.montoProveedor), 0)),
  }
}
