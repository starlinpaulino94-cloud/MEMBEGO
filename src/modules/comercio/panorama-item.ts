import type { AuditAccion, DealStatus } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { disponible, estadoDeStock, type EstadoStock } from '@/modules/inventory/domain'
import { ESTADOS_VIVOS, etiquetaDeDescuento, precioDeLaOferta } from '@/modules/deals/domain'

/**
 * COMERCIO · el PANORAMA COMERCIAL de un ítem del catálogo.
 *
 * Vive en `modules/comercio` y no en `modules/catalog` a propósito: el catálogo
 * no importa del inventario ni de las ofertas (la dependencia va en una sola
 * dirección y un test lo vigila). Este módulo es la capa que COMPONE lecturas
 * de varios dominios para las pantallas; no escribe en ninguno.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * El detalle de un producto era un callejón sin salida: enseñaba nombre, precio
 * y fotos, y para saber cuánto stock había, si tenía una oferta activa o si
 * alguien lo había pedido, la empresa tenía que saltar a Inventario, a Ofertas
 * y a Pedidos y buscarlo otra vez en cada uno. Esta lectura junta lo que ya
 * existe en esos tres dominios —sin copiar nada— para que desde la ficha del
 * producto se entienda el producto entero.
 *
 * La separación arquitectónica se mantiene: aquí solo se LEE. Mover stock,
 * crear la oferta o atender el pedido sigue siendo trabajo de su módulo, y
 * los enlaces de la ficha llevan allí.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface StockPorSucursal {
  sucursalId: string
  nombre: string
  activa: boolean
  onHand: number
  reserved: number
  disponible: number
  lowStockThreshold: number
  estado: EstadoStock
}

export interface StockDeVariante {
  varianteId: string
  nombre: string
  esDefault: boolean
  sucursales: StockPorSucursal[]
  totalDisponible: number
  totalReservado: number
  /** El peor estado entre sus sucursales activas. */
  estado: EstadoStock
}

export interface OfertaDelItem {
  id: string
  title: string
  status: DealStatus
  varianteId: string
  variantName: string
  descuento: string
  endsAt: Date | null
  claimsActive: number
  maxClaims: number
  /** Precio de lista y precio con la oferta, para enseñar «antes / ahora». */
  precioLista: string
  precioOferta: string
}

export interface VentasDelItem {
  /** Pedidos (no cancelados) que incluyen alguna variante, últimos 90 días. */
  pedidos90d: number
  /** Unidades vendidas en pedidos COMPLETADOS, últimos 90 días. */
  unidadesVendidas90d: number
  /** Suma de `lineTotal` de pedidos COMPLETADOS, últimos 90 días. */
  ventas90d: string
  /** Descuento concedido en esas líneas. */
  descuentos90d: string
  /** Pedidos que esperan a la empresa ahora mismo con alguna variante del ítem. */
  pedidosEsperando: number
}

export interface EntradaHistorial {
  id: string
  fecha: Date
  accion: AuditAccion
  entidadTipo: string
  entidadId: string
  usuario: string | null
  payload: Record<string, unknown>
}

export interface PanoramaDelItem {
  empresaSlug: string
  controlaInventario: boolean
  stock: StockDeVariante[]
  ofertas: OfertaDelItem[]
  ventas: VentasDelItem
  historial: EntradaHistorial[]
}

const DIAS_VENTAS = 90
const HISTORIAL_MAX = 25

function dos(n: { toFixed(d: number): string } | number | null | undefined): string {
  if (n == null) return '0.00'
  return typeof n === 'number' ? n.toFixed(2) : n.toFixed(2)
}

export async function panoramaDelItemEnTx(tx: Tx, companyId: string, itemId: string, ahora = new Date()): Promise<PanoramaDelItem | null> {
  const item = await tx.catalogItem.findFirst({
    where: { id: itemId, companyId },
    select: {
      type: true,
      capabilities: true,
      company: { select: { slug: true } },
      variants: {
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          isDefault: true,
          price: true,
          inventoryLevels: { where: { companyId }, select: { locationId: true, onHand: true, reserved: true, lowStockThreshold: true } },
        },
      },
    },
  })
  if (!item) return null
  const controlaInventario = normalizarCapacidades(item.type, item.capabilities).trackInventory
  const varianteIds = item.variants.map((v) => v.id)
  const desde = new Date(ahora.getTime() - DIAS_VENTAS * 24 * 60 * 60 * 1000)

  const [sucursales, deals, lineas, esperando, bitacora] = await Promise.all([
    tx.sucursal.findMany({ where: { companyId }, select: { id: true, nombre: true, activa: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] }),
    varianteIds.length === 0
      ? Promise.resolve([])
      : tx.deal.findMany({
          where: { companyId, catalogVariantId: { in: varianteIds }, status: { not: 'ARCHIVED' } },
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          take: 50,
          select: { id: true, title: true, status: true, catalogVariantId: true, discountType: true, discountValue: true, currency: true, endsAt: true, claimsActive: true, maxClaims: true, variant: { select: { name: true, price: true } } },
        }),
    varianteIds.length === 0
      ? Promise.resolve([])
      : tx.membegoOrderLine.findMany({
          where: { companyId, catalogVariantId: { in: varianteIds }, order: { createdAt: { gte: desde }, status: { notIn: ['CANCELLED'] } } },
          select: { orderId: true, quantity: true, lineTotal: true, discount: true, order: { select: { status: true } } },
        }),
    varianteIds.length === 0
      ? Promise.resolve(0)
      : tx.membegoOrder.count({ where: { companyId, status: 'AWAITING_MERCHANT', lines: { some: { catalogVariantId: { in: varianteIds } } } } }),
    tx.auditLog.findMany({
      where: {
        companyId,
        OR: [
          { entidadTipo: 'CatalogItem', entidadId: itemId },
          ...(varianteIds.length > 0 ? [{ entidadTipo: 'CatalogVariant', entidadId: { in: varianteIds } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: HISTORIAL_MAX,
      select: { id: true, createdAt: true, accion: true, entidadTipo: true, entidadId: true, payload: true, user: { select: { name: true } } },
    }),
  ])

  const stock: StockDeVariante[] = item.variants.map((v) => {
    const porSucursal = new Map(v.inventoryLevels.map((n) => [n.locationId, n]))
    const filas: StockPorSucursal[] = []
    for (const s of sucursales) {
      const n = porSucursal.get(s.id)
      if (!s.activa && !(n && n.onHand > 0)) continue
      const base = n ?? { onHand: 0, reserved: 0, lowStockThreshold: 0 }
      filas.push({
        sucursalId: s.id,
        nombre: s.nombre,
        activa: s.activa,
        onHand: base.onHand,
        reserved: base.reserved,
        disponible: disponible(base),
        lowStockThreshold: base.lowStockThreshold,
        estado: estadoDeStock(base),
      })
    }
    const activas = filas.filter((f) => f.activa)
    const totalDisponible = filas.reduce((a, f) => a + f.disponible, 0)
    // El estado de la VARIANTE mira el conjunto: una sucursal sin existencias no
    // «agota» un producto que en otra tiene 100. Agotado = nada en ninguna; bajo =
    // alguna sucursal activa cruzó su umbral; si no, en stock.
    const estado: EstadoStock = totalDisponible <= 0 ? 'AGOTADO' : activas.some((f) => f.estado === 'BAJO') ? 'BAJO' : 'OK'
    return {
      varianteId: v.id,
      nombre: v.name,
      esDefault: v.isDefault,
      sucursales: filas,
      totalDisponible,
      totalReservado: filas.reduce((a, f) => a + f.reserved, 0),
      estado,
    }
  })

  const ofertas: OfertaDelItem[] = deals.map((d) => {
    const lista = d.variant.price
    const { precio } = precioDeLaOferta(lista, d.discountType, d.discountValue)
    return {
      id: d.id,
      title: d.title,
      status: d.status,
      varianteId: d.catalogVariantId,
      variantName: d.variant.name,
      descuento: etiquetaDeDescuento(d.discountType, d.discountValue, d.currency),
      endsAt: d.endsAt,
      claimsActive: d.claimsActive,
      maxClaims: d.maxClaims,
      precioLista: dos(lista),
      precioOferta: dos(precio),
    }
  })

  const pedidos = new Set(lineas.map((l) => l.orderId))
  const completadas = lineas.filter((l) => l.order.status === 'COMPLETED')
  const ventas: VentasDelItem = {
    pedidos90d: pedidos.size,
    unidadesVendidas90d: completadas.reduce((a, l) => a + l.quantity, 0),
    ventas90d: completadas.reduce((a, l) => a + l.lineTotal.toNumber(), 0).toFixed(2),
    descuentos90d: completadas.reduce((a, l) => a + l.discount.toNumber(), 0).toFixed(2),
    pedidosEsperando: esperando,
  }

  return {
    empresaSlug: item.company.slug,
    controlaInventario,
    stock,
    ofertas,
    ventas,
    historial: bitacora.map((b) => ({
      id: b.id,
      fecha: b.createdAt,
      accion: b.accion,
      entidadTipo: b.entidadTipo,
      entidadId: b.entidadId,
      usuario: b.user?.name ?? null,
      payload: (b.payload ?? {}) as Record<string, unknown>,
    })),
  }
}

/** Ofertas que siguen vivas (publicadas, pausadas o sin presupuesto), para la ficha. */
export function ofertasVivas(ofertas: readonly OfertaDelItem[]): OfertaDelItem[] {
  return ofertas.filter((o) => (ESTADOS_VIVOS as readonly string[]).includes(o.status))
}

/** Texto corto de lo que pasó, leído del payload que escribe `auditarCatalogo`. */
export function describirCambioDeCatalogo(e: Pick<EntradaHistorial, 'accion' | 'payload'>): string {
  const p = e.payload
  switch (e.accion) {
    case 'CATALOG_ITEM_CREATED':
      return 'Creado'
    case 'CATALOG_ITEM_STATUS_CHANGED': {
      const de = typeof p.antes === 'string' ? ETIQUETA_ESTADO_HISTORIAL[p.antes] ?? p.antes : null
      const a = typeof p.despues === 'string' ? ETIQUETA_ESTADO_HISTORIAL[p.despues] ?? p.despues : null
      return de && a ? `${de} → ${a}` : 'Cambio de estado'
    }
    case 'CATALOG_VARIANT_CHANGED': {
      const accion = typeof p.accion === 'string' ? p.accion : 'editada'
      const sku = typeof p.sku === 'string' ? ` · SKU ${p.sku}` : ''
      return `Variante ${accion}${sku}`
    }
    case 'CATALOG_ITEM_UPDATED': {
      const cambio = typeof p.cambio === 'string' ? p.cambio : null
      if (cambio === 'imagen_agregada') return 'Foto agregada'
      if (cambio === 'imagen_eliminada') return 'Foto eliminada'
      if (cambio === 'portada') return 'Portada cambiada'
      if (cambio === 'categorias') return 'Categorías actualizadas'
      const antes = p.antes, despues = p.despues
      if (antes && despues && typeof antes === 'object' && typeof despues === 'object') {
        const campos = Object.keys(despues as Record<string, unknown>).filter(
          (k) => JSON.stringify((antes as Record<string, unknown>)[k]) !== JSON.stringify((despues as Record<string, unknown>)[k])
        )
        const legible = campos.map((c) => ETIQUETA_CAMPO_HISTORIAL[c] ?? c)
        return legible.length > 0 ? `Editado: ${legible.join(', ')}` : 'Editado'
      }
      return 'Editado'
    }
    default:
      return String(e.accion)
  }
}

const ETIQUETA_ESTADO_HISTORIAL: Record<string, string> = { DRAFT: 'Borrador', ACTIVE: 'Publicado', PAUSED: 'Pausado', ARCHIVED: 'Archivado' }
const ETIQUETA_CAMPO_HISTORIAL: Record<string, string> = { name: 'nombre', description: 'descripción', capabilities: 'comportamiento', slug: 'enlace' }
