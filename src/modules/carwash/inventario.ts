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

/**
 * Lee una cantidad escrita por el usuario: acepta coma o punto decimal,
 * rechaza negativos y basura, y redondea a 2 decimales.
 * Devuelve null si el texto no es una cantidad válida.
 */
export function parseCantidad(raw: unknown): number | null {
  const texto = String(raw ?? '').trim().replace(',', '.')
  // Vacío NO es cero: `Number('')` da 0, y con tipo AJUSTE eso pondría el
  // stock del producto en cero sin que nadie escribiera nada. El `required`
  // del formulario solo protege en el navegador; la acción del servidor se
  // puede invocar sin él.
  if (!texto) return null
  const n = Number(texto)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

/**
 * Stock que queda tras un movimiento. ENTRADA suma, SALIDA resta y AJUSTE
 * FIJA el stock en la cantidad indicada (es un conteo físico, no un delta).
 * Redondea a 2 decimales para que la coma flotante no invente centésimas.
 */
export function calcularNuevoStock(
  tipo: MovTipo,
  stockActual: number,
  cantidad: number
): number {
  const bruto =
    tipo === 'ENTRADA'
      ? stockActual + cantidad
      : tipo === 'SALIDA'
        ? stockActual - cantidad
        : cantidad
  return Math.round(bruto * 100) / 100
}

/** ¿El producto está en o por debajo de su umbral de alerta? */
export function esStockBajo(stock: number, stockMinimo: number): boolean {
  return stockMinimo > 0 && stock <= stockMinimo
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
