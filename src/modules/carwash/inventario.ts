import { prisma } from '@/lib/prisma'

/**
 * App Car Wash · E5 — INVENTARIO de productos e insumos.
 * El stock NUNCA se edita directo: solo se mueve con movimientos
 * (ENTRADA/SALIDA/AJUSTE) que congelan el stock resultante — rastro completo.
 * Capacidad: INVENTARIO (nace apagada).
 */

export const MOV_TIPOS = ['ENTRADA', 'SALIDA', 'AJUSTE'] as const
export type MovTipo = (typeof MOV_TIPOS)[number]

export const MOV_TIPO_LABELS: Record<MovTipo, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  AJUSTE: 'Ajuste',
}

/** Producto serializado para la UI (Decimal → number). */
export interface ProductoInv {
  id: string
  nombre: string
  categoria: string | null
  unidad: string
  stock: number
  stockMinimo: number
  costo: number | null
  activo: boolean
  notas: string | null
}

export async function getInventario(companyId: string): Promise<ProductoInv[]> {
  const productos = await prisma.productoInventario.findMany({
    where: { companyId },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    take: 300,
  })
  return productos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    unidad: p.unidad,
    stock: Number(p.stock),
    stockMinimo: Number(p.stockMinimo),
    costo: p.costo != null ? Number(p.costo) : null,
    activo: p.activo,
    notas: p.notas,
  }))
}

export interface MovimientoInv {
  id: string
  producto: string
  unidad: string
  tipo: string
  cantidad: number
  stockResultante: number
  motivo: string | null
  registradoPor: string | null
  createdAt: Date
}

export async function getMovimientosRecientes(
  companyId: string,
  take = 25
): Promise<MovimientoInv[]> {
  const movimientos = await prisma.movimientoInventario.findMany({
    where: { companyId },
    select: {
      id: true,
      tipo: true,
      cantidad: true,
      stockResultante: true,
      motivo: true,
      createdAt: true,
      producto: { select: { nombre: true, unidad: true } },
      registradoPor: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return movimientos.map((m) => ({
    id: m.id,
    producto: m.producto.nombre,
    unidad: m.producto.unidad,
    tipo: m.tipo,
    cantidad: Number(m.cantidad),
    stockResultante: Number(m.stockResultante),
    motivo: m.motivo,
    registradoPor: m.registradoPor?.name ?? null,
    createdAt: m.createdAt,
  }))
}
