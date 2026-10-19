import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { costoDeDecimal, type Costo } from './costos'
import { estadoDeStock } from './domain'
import {
  MAX_NIVELES_REPOSICION,
  armarReposicion,
  claveDeBorradores,
  claveDeNivel,
  resumirReposicion,
  sugerenciaDeReposicion,
  posicionDeStock,
  type BorradorExistente,
  type FiltrosReposicion,
  type GrupoDeReposicion,
  type NivelParaReposicion,
  type ResumenReposicion,
  type VinculoReposicion,
} from './reposicion'

/**
 * COMMERCE CORE · inventario — INV-3c: lecturas de reposición («qué comprar»).
 *
 * Solo lectura, siempre dentro de `conEmpresa` y con el `companyId` escrito en cada consulta. Lee proveedores y costos de
 * órdenes (el último costo de cada proveedor), así que solo se llama detrás de la función `comprar`: la página y la ruta de
 * exportación la piden antes de llegar aquí.
 */

export interface DatosReposicion {
  grupos: GrupoDeReposicion[]
  resumen: ResumenReposicion
  /** Saldos con «llenar hasta» que no hace falta reponer ahora (de los que cumplen la sucursal y la búsqueda). */
  alDia: number
  /** Saldos con «llenar hasta» en total (los que se reponen más los que están al día). */
  conObjetivo: number
  /** Saldos en alerta de stock bajo que NO tienen «llenar hasta»: no aparecen aquí porque no hay hasta cuánto pedir. */
  alertasSinObjetivo: number
  /** Había más saldos con objetivo de los que se leen de una vez: la lista está cortada. */
  truncado: boolean
}

const cargo = (v: { toFixed(n: number): string }): Costo => costoDeDecimal(v)

type CantidadPorNivel = { varianteId: string; sucursalId: string; cantidad: number }

const aMapa = (filas: readonly CantidadPorNivel[]): Map<string, number> => new Map(filas.map((f) => [claveDeNivel(f.varianteId, f.sucursalId), Number(f.cantidad)]))

/**
 * Lo que hay que reponer, con sus filtros: los saldos con objetivo, lo pedido y lo que va en camino hacia cada uno,
 * agrupado por proveedor y sucursal. El caller decide cuánto de esto enseña (la pantalla, el CSV). `maxNiveles` solo existe
 * para que las pruebas puedan probar el corte sin crear miles de saldos.
 */
export async function reposicionEnTx(tx: Tx, companyId: string, f: FiltrosReposicion = {}, maxNiveles: number = MAX_NIVELES_REPOSICION): Promise<DatosReposicion> {
  const t = (f.q ?? '').trim().slice(0, 80)
  // Los productos que cuentan: los que controlan inventario, no descontinuados ni archivados, en sucursales activas.
  const variante = {
    status: { not: 'DISCONTINUED' },
    item: { status: { not: 'ARCHIVED' }, capabilities: { path: ['trackInventory'], equals: true } },
    ...(t
      ? {
          OR: [
            { sku: { contains: t, mode: 'insensitive' } },
            { barcode: { contains: t, mode: 'insensitive' } },
            { name: { contains: t, mode: 'insensitive' } },
            { item: { name: { contains: t, mode: 'insensitive' } } },
          ],
        }
      : {}),
  } satisfies Prisma.CatalogVariantWhereInput
  const deSucursal = f.sucursalId ? { locationId: f.sucursalId } : {}

  const filas = await tx.inventoryLevel.findMany({
    where: { companyId, ...deSucursal, targetStock: { gt: 0 }, location: { activa: true }, variant: variante },
    select: {
      id: true,
      locationId: true,
      onHand: true,
      reserved: true,
      lowStockThreshold: true,
      targetStock: true,
      location: { select: { nombre: true } },
      variant: { select: { id: true, sku: true, barcode: true, name: true, isDefault: true, item: { select: { name: true } } } },
    },
    orderBy: [{ id: 'asc' }],
    take: maxNiveles + 1,
  })
  const truncado = filas.length > maxNiveles
  const niveles: NivelParaReposicion[] = filas.slice(0, maxNiveles).map((n) => ({
    nivelId: n.id,
    varianteId: n.variant.id,
    sucursalId: n.locationId,
    sucursalNombre: n.location.nombre,
    sku: n.variant.sku,
    barcode: n.variant.barcode,
    producto: n.variant.item.name,
    nombreVariante: n.variant.name,
    esDefault: n.variant.isDefault,
    onHand: n.onHand,
    reserved: n.reserved,
    umbral: n.lowStockThreshold,
    llenarHasta: n.targetStock,
  }))

  const [pedidoFilas, caminoFilas, borradorFilas, borradores, sinObjetivo] = await Promise.all([
    // Lo pedido a proveedores y todavía no recibido (ni dado por faltante), por producto y sucursal que recibe.
    tx.$queryRaw<CantidadPorNivel[]>`
      SELECT l."catalogVariantId" AS "varianteId", o."locationId" AS "sucursalId",
             SUM(l."quantityOrdered" - l."quantityReceived" - l."quantityCancelled")::int AS "cantidad"
        FROM "inventory_purchase_order_lines" l
        JOIN "inventory_purchase_orders" o ON o."id" = l."orderId" AND o."companyId" = l."companyId"
       WHERE l."companyId" = ${companyId} AND o."status" IN ('ORDERED', 'PARTIAL')
       GROUP BY l."catalogVariantId", o."locationId"
      HAVING SUM(l."quantityOrdered" - l."quantityReceived" - l."quantityCancelled") > 0`,
    // Lo enviado desde otra sucursal que todavía no llega (ni volvió, ni se dio por perdido), por producto y sucursal destino.
    tx.$queryRaw<CantidadPorNivel[]>`
      SELECT tl."catalogVariantId" AS "varianteId", t."toLocationId" AS "sucursalId",
             SUM(tl."quantitySent" - tl."quantityReceived" - tl."quantityReturned" - tl."quantityLost")::int AS "cantidad"
        FROM "inventory_transfer_lines" tl
        JOIN "inventory_transfers" t ON t."id" = tl."transferId" AND t."companyId" = tl."companyId"
       WHERE tl."companyId" = ${companyId} AND t."status" IN ('SENT', 'PARTIAL')
       GROUP BY tl."catalogVariantId", t."toLocationId"
      HAVING SUM(tl."quantitySent" - tl."quantityReceived" - tl."quantityReturned" - tl."quantityLost") > 0`,
    // Lo que ya está en borradores de orden: se enseña, pero no cuenta como pedido (un borrador no es un compromiso).
    tx.$queryRaw<CantidadPorNivel[]>`
      SELECT l."catalogVariantId" AS "varianteId", o."locationId" AS "sucursalId", SUM(l."quantityOrdered")::int AS "cantidad"
        FROM "inventory_purchase_order_lines" l
        JOIN "inventory_purchase_orders" o ON o."id" = l."orderId" AND o."companyId" = l."companyId"
       WHERE l."companyId" = ${companyId} AND o."status" = 'DRAFT'
       GROUP BY l."catalogVariantId", o."locationId"`,
    tx.inventoryPurchaseOrder.findMany({
      where: { companyId, status: 'DRAFT' },
      select: { id: true, number: true, supplierId: true, locationId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
    // Alertas de stock bajo sin «llenar hasta»: es lo que más se pregunta («¿por qué mi alerta no sale en Reposición?»).
    tx.inventoryLevel.findMany({
      where: { companyId, ...deSucursal, targetStock: 0, lowStockThreshold: { gt: 0 }, location: { activa: true }, variant: variante },
      select: { onHand: true, reserved: true, lowStockThreshold: true },
      orderBy: [{ id: 'asc' }],
      take: maxNiveles,
    }),
  ])
  const pedido = aMapa(pedidoFilas)
  const enCamino = aMapa(caminoFilas)
  const enBorrador = aMapa(borradorFilas)

  // Los proveedores, solo de los productos que van a salir en la propuesta.
  const porReponer = [
    ...new Set(
      niveles
        .filter((n) => {
          const k = claveDeNivel(n.varianteId, n.sucursalId)
          const s = sugerenciaDeReposicion({ umbral: n.umbral, llenarHasta: n.llenarHasta }, posicionDeStock({ disponible: n.onHand - n.reserved, pedido: pedido.get(k) ?? 0, enCamino: enCamino.get(k) ?? 0 }))
          return s.estado === 'REPONER'
        })
        .map((n) => n.varianteId)
    ),
  ]
  const links =
    porReponer.length === 0
      ? []
      : await tx.inventoryVariantSupplier.findMany({
          where: { companyId, catalogVariantId: { in: porReponer } },
          select: { catalogVariantId: true, supplierId: true, preferred: true, lastCost: true, supplier: { select: { name: true, active: true } } },
        })
  const vinculos = new Map<string, VinculoReposicion[]>()
  for (const l of links) {
    const lista = vinculos.get(l.catalogVariantId) ?? []
    lista.push({ proveedorId: l.supplierId, proveedorNombre: l.supplier.name, activo: l.supplier.active, preferido: l.preferred, ultimoCosto: l.lastCost ? cargo(l.lastCost) : null })
    vinculos.set(l.catalogVariantId, lista)
  }
  const borradoresPorGrupo = new Map<string, BorradorExistente[]>()
  for (const b of borradores) {
    const k = claveDeBorradores(b.supplierId, b.locationId)
    const lista = borradoresPorGrupo.get(k) ?? []
    lista.push({ id: b.id, numero: b.number })
    borradoresPorGrupo.set(k, lista)
  }

  const armada = armarReposicion({ niveles, pedido, enCamino, enBorrador, vinculos, borradores: borradoresPorGrupo })
  const grupos = f.proveedorId ? armada.grupos.filter((g) => (f.proveedorId === 'sin' ? g.proveedor === null : g.proveedor?.id === f.proveedorId)) : armada.grupos
  return {
    grupos,
    resumen: resumirReposicion(grupos),
    alDia: armada.alDia,
    conObjetivo: armada.conObjetivo,
    alertasSinObjetivo: sinObjetivo.filter((n) => estadoDeStock(n) !== 'OK').length,
    truncado,
  }
}
