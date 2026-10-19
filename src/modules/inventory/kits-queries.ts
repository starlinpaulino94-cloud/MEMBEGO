import type { Tx } from '@/lib/tenant'
import { normalizarCapacidades } from '@/modules/catalog/domain'
import { disponibilidadDeKit, type ComponenteDeReceta, type DisponibilidadDeKit } from './kits'
import { nombreCompleto } from './formato'

/**
 * COMMERCE CORE · inventario — INV-5d: las LECTURAS de kits (recetas, cuántos alcanzan, dónde entra un producto). Solo lee: lo que escribe una
 * receta o aparta componentes está en `kits-service.ts`.
 */

/** Las recetas de esos kits (los que no tienen receta no aparecen). */
export async function recetasDeKitsEnTx(tx: Tx, companyId: string, kitIds: readonly string[]): Promise<Map<string, ComponenteDeReceta[]>> {
  const salida = new Map<string, ComponenteDeReceta[]>()
  if (kitIds.length === 0) return salida
  const filas = await tx.inventoryKitComponent.findMany({
    where: { companyId, kitVariantId: { in: [...kitIds] } },
    select: { kitVariantId: true, componentVariantId: true, quantity: true },
    orderBy: [{ kitVariantId: 'asc' }, { componentVariantId: 'asc' }],
  })
  for (const f of filas) salida.set(f.kitVariantId, [...(salida.get(f.kitVariantId) ?? []), { varianteId: f.componentVariantId, cantidad: f.quantity }])
  return salida
}

/** Lo disponible (lo que hay menos lo apartado) de cada variante en UNA sucursal. */
async function disponiblesEn(tx: Tx, companyId: string, varianteIds: readonly string[], sucursalId: string): Promise<Map<string, number>> {
  const niveles = await tx.inventoryLevel.findMany({
    where: { companyId, locationId: sucursalId, catalogVariantId: { in: [...varianteIds] } },
    select: { catalogVariantId: true, onHand: true, reserved: true },
  })
  return new Map(niveles.map((n) => [n.catalogVariantId, Math.max(0, n.onHand - n.reserved)]))
}

/** Cuántos kits alcanzan en una sucursal, por kit (solo los que tienen receta). */
export async function disponibilidadDeKitsEnTx(tx: Tx, companyId: string, kitIds: readonly string[], sucursalId: string): Promise<Map<string, DisponibilidadDeKit>> {
  const recetas = await recetasDeKitsEnTx(tx, companyId, kitIds)
  const salida = new Map<string, DisponibilidadDeKit>()
  if (recetas.size === 0) return salida
  const componentes = [...new Set([...recetas.values()].flatMap((r) => r.map((c) => c.varianteId)))]
  const disponibles = await disponiblesEn(tx, companyId, componentes, sucursalId)
  for (const [kitId, receta] of recetas) salida.set(kitId, disponibilidadDeKit(receta, disponibles))
  return salida
}

export interface ComponenteVista {
  varianteId: string
  sku: string
  nombre: string
  cantidad: number
}

export interface KitVista {
  varianteId: string
  sku: string
  nombre: string
  precio: string
  componentes: ComponenteVista[]
  /** Cuántos kits alcanzan en cada sucursal activa. */
  porSucursal: { sucursalId: string; sucursal: string; kits: number; limitante: string | null }[]
}

/** Los nombres de variantes, de golpe. */
async function nombresDe(tx: Tx, companyId: string, ids: readonly string[]) {
  const filas = await tx.catalogVariant.findMany({
    where: { companyId, id: { in: [...ids] } },
    select: { id: true, sku: true, name: true, isDefault: true, price: true, item: { select: { name: true } } },
  })
  return new Map(filas.map((v) => [v.id, { sku: v.sku, nombre: nombreCompleto(v.item.name, v.name, v.isDefault), precio: v.price.toFixed(2) }]))
}

/** Todos los kits de la empresa con su receta y cuántos alcanzan en cada sucursal activa. */
export async function kitsDeLaEmpresaEnTx(tx: Tx, companyId: string): Promise<KitVista[]> {
  const filas = await tx.inventoryKitComponent.findMany({ where: { companyId }, select: { kitVariantId: true, componentVariantId: true, quantity: true }, orderBy: [{ kitVariantId: 'asc' }, { componentVariantId: 'asc' }] })
  if (filas.length === 0) return []
  const recetas = new Map<string, ComponenteDeReceta[]>()
  for (const f of filas) recetas.set(f.kitVariantId, [...(recetas.get(f.kitVariantId) ?? []), { varianteId: f.componentVariantId, cantidad: f.quantity }])
  const nombres = await nombresDe(tx, companyId, [...new Set(filas.flatMap((f) => [f.kitVariantId, f.componentVariantId]))])
  const sucursales = await tx.sucursal.findMany({ where: { companyId, activa: true }, select: { id: true, nombre: true }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }] })
  const componentes = [...new Set(filas.map((f) => f.componentVariantId))]
  const porSucursal = new Map<string, Map<string, number>>()
  for (const s of sucursales) porSucursal.set(s.id, await disponiblesEn(tx, companyId, componentes, s.id))
  const vistas = [...recetas.entries()].map(([kitId, receta]): KitVista => {
    const n = nombres.get(kitId)
    return {
      varianteId: kitId,
      sku: n?.sku ?? '',
      nombre: n?.nombre ?? 'Producto que ya no existe',
      precio: n?.precio ?? '0.00',
      componentes: receta.map((c) => ({ varianteId: c.varianteId, sku: nombres.get(c.varianteId)?.sku ?? '', nombre: nombres.get(c.varianteId)?.nombre ?? 'Producto que ya no existe', cantidad: c.cantidad })),
      porSucursal: sucursales.map((s) => {
        const d = disponibilidadDeKit(receta, porSucursal.get(s.id)!)
        return { sucursalId: s.id, sucursal: s.nombre, kits: d.kits, limitante: d.limitante ? (nombres.get(d.limitante)?.nombre ?? null) : null }
      }),
    }
  })
  return vistas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || (a.varianteId < b.varianteId ? -1 : 1))
}

/** La receta de UN kit con los nombres de sus componentes, o null si no tiene. */
export async function recetaVistaDeKitEnTx(tx: Tx, companyId: string, kitId: string): Promise<{ nombre: string; sku: string; componentes: ComponenteVista[] } | null> {
  const recetas = await recetasDeKitsEnTx(tx, companyId, [kitId])
  const receta = recetas.get(kitId)
  if (!receta) return null
  const nombres = await nombresDe(tx, companyId, [kitId, ...receta.map((c) => c.varianteId)])
  return {
    nombre: nombres.get(kitId)?.nombre ?? '',
    sku: nombres.get(kitId)?.sku ?? '',
    componentes: receta.map((c) => ({ varianteId: c.varianteId, sku: nombres.get(c.varianteId)?.sku ?? '', nombre: nombres.get(c.varianteId)?.nombre ?? '', cantidad: c.cantidad })),
  }
}

/** En qué kits entra un producto (para avisarlo en su ficha). */
export async function kitsDondeEntraEnTx(tx: Tx, companyId: string, varianteId: string): Promise<{ varianteId: string; sku: string; nombre: string; cantidad: number }[]> {
  const filas = await tx.inventoryKitComponent.findMany({ where: { companyId, componentVariantId: varianteId }, select: { kitVariantId: true, quantity: true } })
  if (filas.length === 0) return []
  const nombres = await nombresDe(tx, companyId, filas.map((f) => f.kitVariantId))
  return filas
    .map((f) => ({ varianteId: f.kitVariantId, sku: nombres.get(f.kitVariantId)?.sku ?? '', nombre: nombres.get(f.kitVariantId)?.nombre ?? '', cantidad: f.quantity }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export interface CandidatoDeKit {
  varianteId: string
  sku: string
  nombre: string
}

/**
 * Productos que se pueden convertir en kit: variantes de la empresa (de las que ella creó) que NO controlan inventario por su cuenta y que no
 * son componente de ningún kit. Se busca por nombre o SKU. Tope pequeño: es un buscador, no una lista.
 */
export async function candidatosAKitEnTx(tx: Tx, companyId: string, q: string, limite = 15): Promise<CandidatoDeKit[]> {
  const t = typeof q === 'string' ? q.trim().slice(0, 80) : ''
  if (t.length < 2) return []
  const filas = await tx.catalogVariant.findMany({
    where: {
      companyId,
      kitsDondeEntra: { none: {} },
      item: { source: 'MERCHANT', status: { not: 'ARCHIVED' } },
      OR: [{ sku: { contains: t, mode: 'insensitive' } }, { name: { contains: t, mode: 'insensitive' } }, { item: { name: { contains: t, mode: 'insensitive' } } }],
    },
    select: { id: true, sku: true, name: true, isDefault: true, item: { select: { name: true, type: true, capabilities: true } } },
    orderBy: [{ item: { name: 'asc' } }, { id: 'asc' }],
    take: 60,
  })
  return filas
    .filter((v) => !normalizarCapacidades(v.item.type, v.item.capabilities).trackInventory)
    .slice(0, limite)
    .map((v) => ({ varianteId: v.id, sku: v.sku, nombre: nombreCompleto(v.item.name, v.name, v.isDefault) }))
}
