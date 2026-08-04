import { conEmpresa } from '@/lib/tenant'

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

/**
 * Catálogo de productos. `ventana` pagina en la base; el resumen (activos y
 * stock bajo) se calcula sobre TODOS los productos, no sobre la página: un KPI
 * que cambia al pasar de página no sirve para decidir compras.
 */
export async function getInventario(
  companyId: string,
  ventana?: { saltar: number; tomar: number }
): Promise<{ items: ProductoInv[]; total: number; activos: number; bajos: number }> {
  const [productos, resumen] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.productoInventario.findMany({
        where: { companyId },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
        skip: ventana?.saltar ?? 0,
        take: ventana ? ventana.tomar : 300,
      }),
      tx.productoInventario.findMany({
        where: { companyId },
        select: { activo: true, stock: true, stockMinimo: true },
      }),
    ])
  )

  const items = productos.map((p) => ({
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

  const activos = resumen.filter((p) => p.activo)
  return {
    items,
    total: resumen.length,
    activos: activos.length,
    bajos: activos.filter((p) => esStockBajo(Number(p.stock), Number(p.stockMinimo))).length,
  }
}

/** Un producto suelto (para editar uno que no está en la página actual). */
export async function getProductoInv(
  companyId: string,
  id: string
): Promise<ProductoInv | undefined> {
  const p = await conEmpresa(companyId, (tx) =>
    tx.productoInventario.findFirst({ where: { id, companyId } })
  )
  if (!p) return undefined
  return {
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    unidad: p.unidad,
    stock: Number(p.stock),
    stockMinimo: Number(p.stockMinimo),
    costo: p.costo != null ? Number(p.costo) : null,
    activo: p.activo,
    notas: p.notas,
  }
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
  ventana?: { saltar: number; tomar: number }
): Promise<{ items: MovimientoInv[]; total: number }> {
  const [movimientos, total] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.movimientoInventario.findMany({
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
        skip: ventana?.saltar ?? 0,
        take: ventana ? ventana.tomar : 25,
      }),
      tx.movimientoInventario.count({ where: { companyId } }),
    ])
  )

  const items = movimientos.map((m) => ({
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

  return { items, total }
}
