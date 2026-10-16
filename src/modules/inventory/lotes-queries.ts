import type { Tx } from '@/lib/tenant'
import { diaLocal } from '@/modules/reportes/rango'
import { disponibleDeLote, estadoDeLote, ordenFefo, textoVencimiento, type EstadoLote, type LoteConSaldo } from './lotes'

/**
 * COMMERCE CORE · inventario — INV-5a: las LECTURAS de lotes para la ficha del producto y su historial. Solo lee: lo que mueve lotes
 * está en `service.ts`.
 */

/** Un lote con lo que hay de él en UNA sucursal. */
export interface LoteVista {
  loteId: string
  codigo: string
  /** `YYYY-MM-DD` o null (no vence). */
  vencimiento: string | null
  legado: boolean
  estado: EstadoLote
  /** «Vence en 12 días», «Venció ayer», «No vence». */
  textoVencimiento: string
  onHand: number
  reserved: number
  damaged: number
  /** Lo que se puede vender: lo que hay menos lo apartado (los vencidos no se venden aunque aparezcan aquí). */
  disponible: number
}

/** Un lote del producto (para elegirlo como destino de un movimiento, tenga o no existencias en la sucursal). */
export interface LoteDelCatalogo {
  loteId: string
  codigo: string
  vencimiento: string | null
  legado: boolean
  estado: EstadoLote
  textoVencimiento: string
}

export interface LotesDeVariante {
  /** ¿El producto lleva lotes? Si no, todo lo demás va vacío. */
  lleva: boolean
  exigeVencimiento: boolean
  /** El día de hoy en el calendario de la empresa. */
  hoy: string
  catalogo: LoteDelCatalogo[]
  /** Por sucursal: los lotes que tienen existencias (hay o dañado), de lo que antes vence a lo que no vence. */
  porSucursal: Record<string, LoteVista[]>
}

/** Los lotes de un producto: los suyos, y cuánto hay de cada uno en cada sucursal. */
export async function lotesDeVarianteEnTx(tx: Tx, companyId: string, varianteId: string, ahora: Date = new Date()): Promise<LotesDeVariante> {
  const [seguimiento, empresa] = await Promise.all([
    tx.inventoryLotTracking.findFirst({ where: { companyId, catalogVariantId: varianteId }, select: { requiresExpiry: true } }),
    tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } }),
  ])
  const hoy = diaLocal(ahora, empresa?.zonaHoraria ?? '')
  if (!seguimiento) return { lleva: false, exigeVencimiento: false, hoy, catalogo: [], porSucursal: {} }

  const filas = await tx.$queryRaw<
    { loteId: string; codigo: string; vencimiento: string | null; legado: boolean; creadoEn: number; sucursalId: string | null; onHand: number | null; reserved: number | null; damaged: number | null }[]
  >`
    SELECT l."id" AS "loteId", l."code" AS "codigo", l."expiresOn"::text AS "vencimiento", l."legacy" AS "legado",
           (EXTRACT(EPOCH FROM l."createdAt") * 1000)::float8 AS "creadoEn",
           lv."locationId" AS "sucursalId", b."onHand", b."reserved", b."damaged"
      FROM "inventory_lots" l
      LEFT JOIN "inventory_lot_balances" b ON b."lotId" = l."id"
      LEFT JOIN "inventory_levels" lv ON lv."id" = b."inventoryLevelId"
     WHERE l."companyId" = ${companyId} AND l."catalogVariantId" = ${varianteId}`

  const comoLote = (f: (typeof filas)[number]): LoteConSaldo => ({
    loteId: f.loteId,
    codigo: f.codigo,
    vencimiento: f.vencimiento,
    legado: f.legado,
    creadoEn: Number(f.creadoEn),
    onHand: f.onHand ?? 0,
    reserved: f.reserved ?? 0,
    damaged: f.damaged ?? 0,
  })
  const vista = (l: LoteConSaldo): LoteVista => ({
    loteId: l.loteId,
    codigo: l.codigo,
    vencimiento: l.vencimiento,
    legado: l.legado,
    estado: estadoDeLote(l.vencimiento, hoy),
    textoVencimiento: textoVencimiento(l.vencimiento, hoy),
    onHand: l.onHand,
    reserved: l.reserved,
    damaged: l.damaged,
    disponible: disponibleDeLote(l),
  })

  const unicos = new Map<string, LoteConSaldo>()
  for (const f of filas) if (!unicos.has(f.loteId)) unicos.set(f.loteId, comoLote({ ...f, onHand: 0, reserved: 0, damaged: 0 }))
  const catalogo = [...unicos.values()].sort(ordenFefo).map((l): LoteDelCatalogo => {
    const v = vista(l)
    return { loteId: v.loteId, codigo: v.codigo, vencimiento: v.vencimiento, legado: v.legado, estado: v.estado, textoVencimiento: v.textoVencimiento }
  })

  const porSucursal: Record<string, LoteVista[]> = {}
  const crudos = new Map<string, LoteConSaldo[]>()
  for (const f of filas) {
    if (!f.sucursalId || ((f.onHand ?? 0) <= 0 && (f.damaged ?? 0) <= 0)) continue
    crudos.set(f.sucursalId, [...(crudos.get(f.sucursalId) ?? []), comoLote(f)])
  }
  for (const [sucursalId, lotes] of crudos) porSucursal[sucursalId] = lotes.sort(ordenFefo).map(vista)
  return { lleva: true, exigeVencimiento: seguimiento.requiresExpiry, hoy, catalogo, porSucursal }
}

/**
 * De qué lotes es cada movimiento, por CÓDIGO: movimiento → (código → cantidad). Los movimientos de productos sin lotes no aparecen. Es lo
 * que compara una clave de idempotencia repetida (entrada, recepción de una orden) con lo que ya quedó registrado.
 */
export async function repartosPorCodigoEnTx(tx: Tx, companyId: string, movimientoIds: readonly string[]): Promise<Map<string, Map<string, number>>> {
  const salida = new Map<string, Map<string, number>>()
  if (movimientoIds.length === 0) return salida
  const filas = await tx.inventoryMovementLot.findMany({
    where: { companyId, movementId: { in: [...movimientoIds] } },
    select: { movementId: true, quantity: true, balance: { select: { lot: { select: { code: true } } } } },
  })
  for (const f of filas) {
    const por = salida.get(f.movementId) ?? new Map<string, number>()
    por.set(f.balance.lot.code, f.quantity)
    salida.set(f.movementId, por)
  }
  return salida
}

/** «A-1 ×4, B ×2»: de qué lotes es cada movimiento (uno por id). Los movimientos de productos sin lotes no aparecen. */
export async function lotesDeMovimientosEnTx(tx: Tx, companyId: string, movimientoIds: readonly string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>()
  if (movimientoIds.length === 0) return salida
  const filas = await tx.inventoryMovementLot.findMany({
    where: { companyId, movementId: { in: [...movimientoIds] } },
    select: { movementId: true, quantity: true, balance: { select: { lot: { select: { code: true } } } } },
    orderBy: [{ movementId: 'asc' }, { quantity: 'desc' }, { lotId: 'asc' }],
  })
  const por = new Map<string, string[]>()
  for (const f of filas) por.set(f.movementId, [...(por.get(f.movementId) ?? []), `${f.balance.lot.code} ×${f.quantity}`])
  for (const [id, partes] of por) salida.set(id, partes.join(', '))
  return salida
}
