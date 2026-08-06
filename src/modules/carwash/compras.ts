import { conEmpresa } from '@/lib/tenant'

/**
 * App Car Wash · Fase 3 — PROVEEDORES Y ÓRDENES DE COMPRA.
 *
 * QUÉ RESUELVE: el inventario de la Fase 1 sabe cuánto queda, pero no cómo se
 * repone. Hoy eso vive en llamadas de WhatsApp y en la memoria de una persona.
 * Cuando esa persona no está, nadie sabe si el shampoo ya se pidió.
 *
 * EL ESTADO "PEDIDA" ES EL PUNTO. Entre pedir y recibir pasan días; sin ese
 * estado la única forma de saber si algo viene en camino es preguntar. Con él,
 * el panel de inventario puede decir "bajo, pero ya viene".
 *
 * RECIBIR ES LO ÚNICO QUE MUEVE STOCK, y lo hace por el camino de siempre
 * (`MovimientoInventario`). No hay un segundo camino hacia el stock: eso es lo
 * que mantiene el rastro de auditoría en una sola línea.
 */

export const ORDEN_ESTADOS = ['BORRADOR', 'PEDIDA', 'RECIBIDA', 'CANCELADA'] as const
export type OrdenEstado = (typeof ORDEN_ESTADOS)[number]

export const ORDEN_ESTADO_LABELS: Record<OrdenEstado, string> = {
  BORRADOR: 'Borrador',
  PEDIDA: 'Pedida · en camino',
  RECIBIDA: 'Recibida',
  CANCELADA: 'Cancelada',
}

/** Desde qué estado se puede pasar a cuál. El flujo no vuelve atrás. */
export const ORDEN_TRANSICIONES: Record<OrdenEstado, OrdenEstado[]> = {
  BORRADOR: ['PEDIDA', 'CANCELADA'],
  PEDIDA: ['RECIBIDA', 'CANCELADA'],
  RECIBIDA: [],
  CANCELADA: [],
}

/** Solo se pueden editar las líneas de una orden que todavía no se pidió. */
export function puedeEditarLineas(estado: string): boolean {
  return estado === 'BORRADOR'
}

/**
 * Siguiente número correlativo de orden para la empresa.
 *
 * Se calcula sobre el máximo existente y NO sobre el conteo: si alguna vez se
 * borra una orden, contar daría un número repetido y el unique la rechazaría.
 */
export function siguienteNumero(ultimo: string | null | undefined): string {
  const n = ultimo ? Number(ultimo.replace(/\D/g, '')) : 0
  const siguiente = Number.isFinite(n) ? n + 1 : 1
  return `OC-${String(siguiente).padStart(6, '0')}`
}

/** Total de una orden a partir de sus líneas. Pura, se prueba sin base. */
export function totalDeLineas(
  lineas: { cantidad: number; costoUnitario: number }[]
): number {
  const total = lineas.reduce((acc, l) => acc + l.cantidad * l.costoUnitario, 0)
  return Math.round(total * 100) / 100
}

/**
 * Cuánto entra al stock por una línea al recibir la orden.
 *
 * Si no se indicó cantidad recibida se asume la pedida — el caso normal. Si se
 * indicó (entrega incompleta), manda ese número. Nunca es negativa.
 */
export function cantidadAIngresar(
  cantidad: number,
  cantidadRecibida: number | null | undefined
): number {
  const n = cantidadRecibida == null ? cantidad : cantidadRecibida
  return n > 0 ? n : 0
}

export interface ProveedorResumen {
  id: string
  nombre: string
  contacto: string | null
  telefono: string | null
  diasCredito: number
  activo: boolean
  productos: number
  ordenesAbiertas: number
}

/** Proveedores con cuántos productos surten y cuántas órdenes tienen en vuelo. */
export async function getProveedores(companyId: string): Promise<ProveedorResumen[] | null> {
  try {
    const provs = await conEmpresa(companyId, (tx) =>
      tx.proveedor.findMany({
        where: { companyId },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        select: {
          id: true,
          nombre: true,
          contacto: true,
          telefono: true,
          diasCredito: true,
          activo: true,
          _count: {
            select: {
              productos: true,
              ordenes: { where: { estado: { in: ['BORRADOR', 'PEDIDA'] } } },
            },
          },
        },
      })
    )
    return provs.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      contacto: p.contacto,
      telefono: p.telefono,
      diasCredito: p.diasCredito,
      activo: p.activo,
      productos: p._count.productos,
      ordenesAbiertas: p._count.ordenes,
    }))
  } catch {
    // Migración 20260765 sin correr.
    return null
  }
}

export interface OrdenResumen {
  id: string
  numero: string
  proveedor: string
  estado: string
  total: number
  lineas: number
  createdAt: Date
  pedidaAt: Date | null
  recibidaAt: Date | null
}

export interface PanelCompras {
  ordenes: OrdenResumen[]
  proveedores: { id: string; nombre: string }[]
  productos: { id: string; nombre: string; unidad: string; costo: number | null; stock: number; stockMinimo: number }[]
  kpis: { enCamino: number; borradores: number; gastoPeriodo: number }
  /** Productos bajo mínimo que NO tienen una orden en camino: hay que pedirlos. */
  porPedir: { id: string; nombre: string; stock: number; stockMinimo: number; unidad: string }[]
}

/**
 * Panel de compras. `null` = migración sin correr.
 *
 * `porPedir` es el dato que hace útil el módulo: no basta con saber qué está
 * bajo mínimo (eso ya lo dice inventario) — hay que saber qué está bajo mínimo
 * Y todavía nadie ha pedido. Lo contrario hace que se compre dos veces.
 */
export async function getPanelCompras(
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<PanelCompras | null> {
  try {
    const [ordenes, proveedores, productos, gastoAgg] = await conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.ordenCompra.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            numero: true,
            estado: true,
            total: true,
            createdAt: true,
            pedidaAt: true,
            recibidaAt: true,
            proveedor: { select: { nombre: true } },
            lineas: { select: { cantidad: true, costoUnitario: true } },
          },
        }),
        tx.proveedor.findMany({
          where: { companyId, activo: true },
          orderBy: { nombre: 'asc' },
          select: { id: true, nombre: true },
        }),
        tx.productoInventario.findMany({
          where: { companyId, activo: true },
          orderBy: { nombre: 'asc' },
          select: { id: true, nombre: true, unidad: true, costo: true, stock: true, stockMinimo: true },
        }),
        tx.ordenCompra.aggregate({
          where: { companyId, estado: 'RECIBIDA', recibidaAt: { gte: desde, lte: hasta } },
          _sum: { total: true },
        }),
      ])
    )

    // Productos que ya están en alguna orden viva: no hace falta volver a pedirlos.
    const enOrdenAbierta = new Set(
      (
        await conEmpresa(companyId, (tx) =>
          tx.ordenCompraLinea.findMany({
            where: { orden: { companyId, estado: { in: ['BORRADOR', 'PEDIDA'] } } },
            select: { productoId: true },
          })
        )
      ).map((l) => l.productoId)
    )

    const bajos = productos.filter(
      (p) => Number(p.stock) <= Number(p.stockMinimo) && !enOrdenAbierta.has(p.id)
    )

    return {
      ordenes: ordenes.map((o) => ({
        id: o.id,
        numero: o.numero,
        proveedor: o.proveedor.nombre,
        estado: o.estado,
        // El total congelado manda; si aún no existe, se calcula de las líneas.
        total:
          o.total != null
            ? Number(o.total)
            : totalDeLineas(
                o.lineas.map((l) => ({
                  cantidad: Number(l.cantidad),
                  costoUnitario: Number(l.costoUnitario),
                }))
              ),
        lineas: o.lineas.length,
        createdAt: o.createdAt,
        pedidaAt: o.pedidaAt,
        recibidaAt: o.recibidaAt,
      })),
      proveedores,
      productos: productos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        unidad: p.unidad,
        costo: p.costo == null ? null : Number(p.costo),
        stock: Number(p.stock),
        stockMinimo: Number(p.stockMinimo),
      })),
      kpis: {
        enCamino: ordenes.filter((o) => o.estado === 'PEDIDA').length,
        borradores: ordenes.filter((o) => o.estado === 'BORRADOR').length,
        gastoPeriodo: Number(gastoAgg._sum.total ?? 0),
      },
      porPedir: bajos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        stock: Number(p.stock),
        stockMinimo: Number(p.stockMinimo),
        unidad: p.unidad,
      })),
    }
  } catch {
    return null
  }
}

export interface OrdenDetalle {
  id: string
  numero: string
  estado: string
  proveedor: { id: string; nombre: string; telefono: string | null }
  notas: string | null
  createdAt: Date
  pedidaAt: Date | null
  recibidaAt: Date | null
  total: number
  lineas: {
    id: string
    productoId: string
    nombre: string
    cantidad: number
    cantidadRecibida: number | null
    costoUnitario: number
    unidad: string
  }[]
}

export async function getOrdenDetalle(
  companyId: string,
  ordenId: string
): Promise<OrdenDetalle | null> {
  try {
    const o = await conEmpresa(companyId, (tx) =>
      tx.ordenCompra.findFirst({
        where: { id: ordenId, companyId },
        include: {
          proveedor: { select: { id: true, nombre: true, telefono: true } },
          lineas: {
            orderBy: { createdAt: 'asc' },
            include: { producto: { select: { unidad: true } } },
          },
        },
      })
    )
    if (!o) return null

    const lineas = o.lineas.map((l) => ({
      id: l.id,
      productoId: l.productoId,
      nombre: l.nombre,
      cantidad: Number(l.cantidad),
      cantidadRecibida: l.cantidadRecibida == null ? null : Number(l.cantidadRecibida),
      costoUnitario: Number(l.costoUnitario),
      unidad: l.producto.unidad,
    }))

    return {
      id: o.id,
      numero: o.numero,
      estado: o.estado,
      proveedor: o.proveedor,
      notas: o.notas,
      createdAt: o.createdAt,
      pedidaAt: o.pedidaAt,
      recibidaAt: o.recibidaAt,
      total: o.total != null ? Number(o.total) : totalDeLineas(lineas),
      lineas,
    }
  } catch {
    return null
  }
}
