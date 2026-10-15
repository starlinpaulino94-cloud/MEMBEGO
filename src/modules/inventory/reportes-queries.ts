import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { diaLocal, limiteDiaLocal, sumarDias } from '@/modules/reportes/rango'
import { costoDeDecimal, type Costo } from './costos'
import { nombreCompleto } from './formato'
import { nombresDeUsuarios } from './queries'
import {
  FILAS_POR_PAGINA_REPORTES,
  armarKardex,
  calcularRotacion,
  compararCobertura,
  corteDeDias,
  diasDeInventario,
  diasDesde,
  type Cubeta,
  type EstadoCobertura,
  type FilaKardex,
  type FiltrosKardex,
  type FiltrosRotacion,
  type FiltrosSinVentas,
  type MovimientoParaKardex,
  type Rotacion,
  type TotalesKardex,
} from './reportes'
import { costoDeVentasEnRangoEnTx, patronContiene, valorTotalEnTx } from './valor'

/**
 * COMMERCE CORE · inventario — INV-4a: lecturas de los informes de existencias (kardex, stock sin ventas, rotación y cobertura).
 *
 * Solo lectura, siempre dentro de `conEmpresa` y con el `companyId` escrito en cada consulta. NUNCA leen costos si quien pide
 * el informe no tiene la función `costos` (`conCostos` en falso): el costo no se esconde en la pantalla, ni siquiera se lee.
 */

// ── Kardex ───────────────────────────────────────────────────────────────────

/** Filas del kardex en pantalla y en el archivo. */
export const TOPE_FILAS_KARDEX = 1_000
export const TOPE_FILAS_KARDEX_CSV = 20_000

export interface KardexVista {
  variante: { id: string; nombre: string; sku: string; barcode: string | null }
  sucursal: { id: string; nombre: string } | null
  /** Días LOCALES de la empresa, ambos incluidos. */
  desde: string
  hasta: string
  /** La existencia física (vendible + apartado + dañado) justo antes del primer día. */
  apertura: number
  /** La existencia física al terminar el último día. */
  cierre: number
  filas: FilaKardex[]
  totales: TotalesKardex
  /** Había más movimientos que filas: lo de abajo es el comienzo del periodo; el cierre es el del periodo completo. */
  truncado: boolean
  conCostos: boolean
}

/**
 * El kardex de UN producto (en una sucursal o en todas): cada movimiento que entró o salió de la existencia física —y los que
 * solo la cambiaron de cubeta—, en orden, con el saldo que dejó. Las reservas no se incluyen: no mueven nada. El saldo sale de
 * restar, hacia atrás desde lo que hay hoy, lo que se movió después: si el ledger y los saldos concuerdan (y las pruebas lo
 * vigilan), apertura + entradas − salidas = cierre sin que nada se guarde aparte.
 */
export async function kardexEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosKardex & { varianteId: string },
  opciones: { zonaHoraria: string; conCostos: boolean; limite?: number; ahora?: Date }
): Promise<KardexVista | null> {
  const variante = await tx.catalogVariant.findFirst({
    where: { id: f.varianteId, companyId },
    select: { id: true, sku: true, barcode: true, name: true, isDefault: true, item: { select: { name: true } } },
  })
  if (!variante) return null
  const hoy = diaLocal(opciones.ahora ?? new Date(), opciones.zonaHoraria)
  const hasta = f.hasta ?? hoy
  const desde = f.desde ?? sumarDias(hasta, -29)
  const gte = limiteDiaLocal(desde, opciones.zonaHoraria, false)
  const lt = limiteDiaLocal(hasta, opciones.zonaHoraria, true)
  const limite = opciones.limite ?? TOPE_FILAS_KARDEX

  // Una sucursal que no es de la empresa no filtra (igual que en las pantallas): el kardex sería el de todas.
  const sucursal = f.sucursalId ? await tx.sucursal.findFirst({ where: { id: f.sucursalId, companyId }, select: { id: true, nombre: true } }) : null
  const niveles = await tx.inventoryLevel.findMany({
    where: { companyId, catalogVariantId: variante.id, ...(sucursal ? { locationId: sucursal.id } : {}) },
    select: { id: true, locationId: true, onHand: true, damaged: true, location: { select: { nombre: true } } },
    orderBy: [{ id: 'asc' }],
  })
  const vacio: KardexVista = {
    variante: { id: variante.id, nombre: nombreCompleto(variante.item.name, variante.name, variante.isDefault), sku: variante.sku, barcode: variante.barcode },
    sucursal,
    desde,
    hasta,
    apertura: 0,
    cierre: 0,
    filas: [],
    totales: armarKardex(0, [], opciones.conCostos).totales,
    truncado: false,
    conCostos: opciones.conCostos,
  }
  if (niveles.length === 0) return vacio

  const ids = niveles.map((n) => n.id)
  const fisicoHoy = niveles.reduce((t, n) => t + n.onHand + n.damaged, 0)
  // Lo que cambió la existencia física desde el inicio del rango y desde el final, para llegar hacia atrás a la apertura y al cierre.
  const efectos = await tx.$queryRaw<{ desdeInicio: number; desdeFin: number }[]>`
    SELECT COALESCE(SUM(x."efecto"), 0)::int AS "desdeInicio",
           COALESCE(SUM(x."efecto") FILTER (WHERE x."createdAt" >= ${lt}), 0)::int AS "desdeFin"
      FROM (
        SELECT m."createdAt",
               CASE WHEN m."sourceBucket" IS NULL AND m."destinationBucket" IS NOT NULL THEN m."quantity"
                    WHEN m."sourceBucket" IS NOT NULL AND m."destinationBucket" IS NULL THEN -m."quantity"
                    ELSE 0 END AS "efecto"
          FROM "inventory_movements" m
         WHERE m."companyId" = ${companyId} AND m."inventoryLevelId" IN (${Prisma.join(ids)}) AND m."createdAt" >= ${gte}
      ) x`
  const apertura = fisicoHoy - Number(efectos[0]?.desdeInicio ?? 0)
  const cierre = fisicoHoy - Number(efectos[0]?.desdeFin ?? 0)

  const filasDb = await tx.inventoryMovement.findMany({
    where: { companyId, inventoryLevelId: { in: ids }, type: { notIn: ['RESERVATION', 'RESERVATION_RELEASE'] }, createdAt: { gte, lt } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limite + 1,
    select: {
      id: true,
      createdAt: true,
      type: true,
      quantity: true,
      sourceBucket: true,
      destinationBucket: true,
      reason: true,
      referenceType: true,
      referenceId: true,
      userId: true,
      inventoryLevelId: true,
      ...(opciones.conCostos ? { unitCost: true } : {}),
    },
  })
  const truncado = filasDb.length > limite
  const visibles = filasDb.slice(0, limite)
  const nombres = await nombresDeUsuarios(tx, visibles.map((x) => x.userId))
  const sucursalDeNivel = new Map(niveles.map((n) => [n.id, { id: n.locationId, nombre: n.location.nombre }]))
  const movimientos: MovimientoParaKardex[] = visibles.map((m) => {
    const suc = sucursalDeNivel.get(m.inventoryLevelId)
    const costo = 'unitCost' in m && m.unitCost ? costoDeDecimal(m.unitCost) : null
    return {
      id: m.id,
      creadoEn: m.createdAt,
      sucursalId: suc?.id ?? '',
      sucursalNombre: suc?.nombre ?? '',
      tipo: m.type,
      cantidad: m.quantity,
      origen: m.sourceBucket as Cubeta | null,
      destino: m.destinationBucket as Cubeta | null,
      motivo: m.reason,
      referenciaTipo: m.referenceType,
      referenciaId: m.referenceId,
      usuarioNombre: m.userId ? (nombres.get(m.userId) ?? null) : null,
      costo,
    }
  })
  const k = armarKardex(apertura, movimientos, opciones.conCostos)
  return { ...vacio, apertura, cierre, filas: k.filas, totales: k.totales, truncado }
}

/** Resultados de la búsqueda de producto del kardex. */
export const TOPE_BUSQUEDA_KARDEX = 15

export interface ProductoDelKardex {
  id: string
  nombre: string
  sku: string
  barcode: string | null
  /** Vendible + apartado + dañado en todas las sucursales. */
  existencia: number
}

/**
 * Los productos con los que se puede abrir un kardex: cualquiera que tenga (o haya tenido) un saldo, descontinuado o no —su
 * historia sigue ahí—. La coincidencia exacta de SKU o código de barras va primero: es lo que escribe un lector.
 */
export async function buscarProductosParaKardexEnTx(tx: Tx, companyId: string, q: string): Promise<ProductoDelKardex[]> {
  const t = q.trim().slice(0, 80)
  if (t === '') return []
  // Prisma no neutraliza los comodines (ni en `contains` ni en un `equals` insensible, que es un ILIKE): un «%» sería «todo». Se escapan igual que en el resto de los informes.
  const trozo = t.replace(/[\\%_]/g, '\\$&')
  const select = {
    id: true,
    sku: true,
    barcode: true,
    name: true,
    isDefault: true,
    item: { select: { name: true } },
    inventoryLevels: { where: { companyId }, select: { onHand: true, damaged: true } },
  } satisfies Prisma.CatalogVariantSelect
  // Lo común a las dos consultas; la empresa va ESCRITA en cada `where` (el guardia de aislamiento la busca ahí).
  const comun = { inventoryLevels: { some: { companyId } } } satisfies Prisma.CatalogVariantWhereInput
  const [exactas, parciales] = await Promise.all([
    tx.catalogVariant.findMany({ where: { companyId, ...comun, OR: [{ sku: { equals: trozo, mode: 'insensitive' } }, { barcode: { equals: trozo, mode: 'insensitive' } }] }, select, take: TOPE_BUSQUEDA_KARDEX }),
    tx.catalogVariant.findMany({
      where: {
        companyId,
        ...comun,
        OR: [{ sku: { contains: trozo, mode: 'insensitive' } }, { barcode: { contains: trozo, mode: 'insensitive' } }, { name: { contains: trozo, mode: 'insensitive' } }, { item: { name: { contains: trozo, mode: 'insensitive' } } }],
      },
      select,
      orderBy: [{ item: { name: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
      take: TOPE_BUSQUEDA_KARDEX,
    }),
  ])
  const vistos = new Set<string>()
  const filas: ProductoDelKardex[] = []
  for (const v of [...exactas, ...parciales]) {
    if (vistos.has(v.id)) continue
    vistos.add(v.id)
    filas.push({
      id: v.id,
      nombre: nombreCompleto(v.item.name, v.name, v.isDefault),
      sku: v.sku,
      barcode: v.barcode,
      existencia: v.inventoryLevels.reduce((t2, n) => t2 + n.onHand + n.damaged, 0),
    })
  }
  return filas.slice(0, TOPE_BUSQUEDA_KARDEX)
}

// ── Stock sin ventas ─────────────────────────────────────────────────────────

export const TOPE_FILAS_SIN_VENTAS_CSV = 20_000

export interface FilaSinVentas {
  nivelId: string
  varianteId: string
  itemId: string
  nombre: string
  sku: string
  sucursalId: string
  sucursalNombre: string
  sucursalActiva: boolean
  /** Vendible + apartado. */
  existencia: number
  ultimaVenta: Date | null
  /** Días completos desde la última venta; null = nunca se ha vendido. */
  diasSinVender: number | null
  ultimaEntrada: Date | null
  /** El costo vigente (promedio o de referencia); null = sin costo (o no se pueden ver costos). */
  costo: Costo | null
  /** existencia × costo; null = sin costo (o no se pueden ver costos). */
  valor: Costo | null
}

export interface SinVentasVista {
  dias: number
  filas: FilaSinVentas[]
  /** Saldos que cumplen los filtros (todas las páginas). */
  total: number
  pagina: number
  porPagina: number
  resumen: {
    saldos: number
    unidades: number
    /** Lo que vale lo inmovilizado; null si no se pueden ver costos. */
    valor: Costo | null
    /** Unidades inmovilizadas sin costo conocido; null si no se pueden ver costos. */
    unidadesSinCosto: number | null
  }
}

/**
 * Los saldos con existencia que llevan `dias` días sin una venta (o que nunca vendieron), por producto y sucursal, de lo que
 * más dinero inmoviliza a lo que menos. Un saldo creado dentro del periodo no cuenta: no ha tenido tiempo de venderse. Las
 * devoluciones, las entradas y las transferencias no son ventas.
 */
export async function sinVentasEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosSinVentas,
  opciones: { conCostos: boolean; todas?: boolean; ahora?: Date }
): Promise<SinVentasVista> {
  const ahora = opciones.ahora ?? new Date()
  const corte = corteDeDias(ahora, f.dias)
  const filtroSucursal = f.sucursalId ? Prisma.sql`AND l."locationId" = ${f.sucursalId}` : Prisma.empty
  const busqueda = f.q
    ? Prisma.sql`AND (i."name" ILIKE ${patronContiene(f.q)} OR v."name" ILIKE ${patronContiene(f.q)} OR v."sku" ILIKE ${patronContiene(f.q)} OR v."barcode" ILIKE ${patronContiene(f.q)})`
    : Prisma.empty
  // El costo solo se lee con la función `costos`: sin ella la columna es un NULL constante y la tabla de costos ni se une.
  const costoSql = opciones.conCostos ? Prisma.sql`COALESCE(c."averageCost", v."cost")` : Prisma.sql`NULL::numeric`
  const unirCostos = opciones.conCostos ? Prisma.sql`LEFT JOIN "inventory_variant_costs" c ON c."catalogVariantId" = v."id" AND c."companyId" = v."companyId"` : Prisma.empty
  const desde = Prisma.sql`
    FROM "inventory_levels" l
    JOIN "catalog_variants" v ON v."id" = l."catalogVariantId" AND v."companyId" = l."companyId"
    JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
    JOIN "sucursales" s ON s."id" = l."locationId" AND s."companyId" = l."companyId"
    ${unirCostos}
    WHERE l."companyId" = ${companyId} AND l."onHand" > 0 AND l."createdAt" < ${corte}
      AND NOT EXISTS (
        SELECT 1 FROM "inventory_movements" m
         WHERE m."inventoryLevelId" = l."id" AND m."companyId" = l."companyId" AND m."type" = 'SALE' AND m."createdAt" >= ${corte}
      )
      ${filtroSucursal} ${busqueda}`

  const resumenFilas = await tx.$queryRaw<{ saldos: number; unidades: number; sinCosto: number; valor: Prisma.Decimal }[]>`
    SELECT COUNT(*)::int AS "saldos",
           COALESCE(SUM(l."onHand"), 0)::int AS "unidades",
           COALESCE(SUM(CASE WHEN ${costoSql} IS NULL THEN l."onHand" ELSE 0 END), 0)::int AS "sinCosto",
           COALESCE(SUM(l."onHand" * ${costoSql}), 0) AS "valor"
    ${desde}`
  const r = resumenFilas[0]
  const total = Number(r?.saldos ?? 0)
  const porPagina = opciones.todas ? TOPE_FILAS_SIN_VENTAS_CSV : FILAS_POR_PAGINA_REPORTES
  const pagina = opciones.todas ? 1 : f.pagina

  const filasDb = await tx.$queryRaw<
    {
      nivelId: string
      varianteId: string
      itemId: string
      itemNombre: string
      varianteNombre: string
      esDefault: boolean
      sku: string
      sucursalId: string
      sucursalNombre: string
      sucursalActiva: boolean
      existencia: number
      ultimaVenta: Date | null
      ultimaEntrada: Date | null
      costo: Prisma.Decimal | null
    }[]
  >`
    SELECT l."id" AS "nivelId", v."id" AS "varianteId", i."id" AS "itemId", i."name" AS "itemNombre", v."name" AS "varianteNombre", v."isDefault" AS "esDefault", v."sku",
           s."id" AS "sucursalId", s."nombre" AS "sucursalNombre", s."activa" AS "sucursalActiva", l."onHand" AS "existencia",
           (SELECT MAX(m."createdAt") FROM "inventory_movements" m WHERE m."inventoryLevelId" = l."id" AND m."companyId" = l."companyId" AND m."type" = 'SALE') AS "ultimaVenta",
           (SELECT MAX(m."createdAt") FROM "inventory_movements" m WHERE m."inventoryLevelId" = l."id" AND m."companyId" = l."companyId" AND m."type" IN ('PURCHASE', 'TRANSFER_IN')) AS "ultimaEntrada",
           ${costoSql} AS "costo"
    ${desde}
    ORDER BY ${opciones.conCostos ? Prisma.sql`(l."onHand" * ${costoSql}) DESC NULLS LAST,` : Prisma.empty} l."onHand" DESC, i."name", l."id"
    LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`
  const filas: FilaSinVentas[] = filasDb.map((x) => {
    const costo = x.costo !== null ? costoDeDecimal(x.costo) : null
    return {
      nivelId: x.nivelId,
      varianteId: x.varianteId,
      itemId: x.itemId,
      nombre: nombreCompleto(x.itemNombre, x.varianteNombre, x.esDefault),
      sku: x.sku,
      sucursalId: x.sucursalId,
      sucursalNombre: x.sucursalNombre,
      sucursalActiva: x.sucursalActiva,
      existencia: Number(x.existencia),
      ultimaVenta: x.ultimaVenta,
      diasSinVender: diasDesde(x.ultimaVenta, ahora),
      ultimaEntrada: x.ultimaEntrada,
      costo,
      valor: costo === null ? null : BigInt(Number(x.existencia)) * costo,
    }
  })
  return {
    dias: f.dias,
    filas,
    total,
    pagina,
    porPagina,
    resumen: {
      saldos: total,
      unidades: Number(r?.unidades ?? 0),
      valor: opciones.conCostos ? costoDeDecimal(r?.valor ?? 0) : null,
      unidadesSinCosto: opciones.conCostos ? Number(r?.sinCosto ?? 0) : null,
    },
  }
}

// ── Rotación y cobertura ─────────────────────────────────────────────────────

export const TOPE_PRODUCTOS_ROTACION = 5_000
export const TOPE_FILAS_ROTACION_CSV = 20_000

export interface FilaRotacion extends Rotacion {
  varianteId: string
  itemId: string
  nombre: string
  sku: string
  /** Vendible + apartado hoy. */
  existencia: number
  /** Vendible sin lo apartado. */
  disponible: number
  /** La última venta dentro del periodo; null = no hubo. */
  ultimaVenta: Date | null
}

export interface RotacionVista {
  dias: number
  filas: FilaRotacion[]
  /** Productos que cumplen los filtros (todas las páginas). */
  total: number
  pagina: number
  porPagina: number
  /** Cuántos productos hay en cada estado, con los filtros de sucursal y texto (sin el de estado). */
  porEstado: Record<EstadoCobertura, number>
  /** Unidades vendidas (menos devueltas) de todos los productos que cumplen los filtros de sucursal y texto. */
  unidadesVendidas: number
  /** Había más productos que el tope: la lista está cortada (se leen primero los que más venden). */
  truncado: boolean
  /** Solo con la función `costos`: lo que costó lo vendido en el periodo, lo que vale todo el inventario y cuántos días cubre. */
  valorado: { costoDeVentas: Costo; unidadesSinCosto: number; valorInventario: Costo; diasDeInventario: number | null } | null
}

/**
 * Para cada producto con existencias o con ventas en el periodo: cuánto se vendió (menos lo devuelto), a qué ritmo, cuántas veces
 * rotó la existencia promedio y para cuántos días alcanza lo que se puede vender hoy. La existencia al empezar el periodo sale
 * de restar a la de hoy lo que cambió desde entonces (el ledger lo guarda todo), así que no hace falta ninguna foto diaria.
 * Primero lo más urgente: lo agotado y lo que se acaba pronto; lo que no vende, al final.
 */
export async function rotacionEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosRotacion,
  opciones: { conCostos: boolean; todas?: boolean; ahora?: Date; /** Solo para pruebas: cuántos productos se leen como máximo. */ tope?: number }
): Promise<RotacionVista> {
  const ahora = opciones.ahora ?? new Date()
  const tope = opciones.tope ?? TOPE_PRODUCTOS_ROTACION
  const corte = corteDeDias(ahora, f.dias)
  const filtroSucursalNivel = f.sucursalId ? Prisma.sql`AND l."locationId" = ${f.sucursalId}` : Prisma.empty
  const busqueda = f.q
    ? Prisma.sql`AND (i."name" ILIKE ${patronContiene(f.q)} OR v."name" ILIKE ${patronContiene(f.q)} OR v."sku" ILIKE ${patronContiene(f.q)} OR v."barcode" ILIKE ${patronContiene(f.q)})`
    : Prisma.empty

  const filasDb = await tx.$queryRaw<
    {
      varianteId: string
      itemId: string
      itemNombre: string
      varianteNombre: string
      esDefault: boolean
      sku: string
      existencia: number
      disponible: number
      vendidas: number
      efecto: number
      ultimaVenta: Date | null
    }[]
  >`
    SELECT v."id" AS "varianteId", i."id" AS "itemId", i."name" AS "itemNombre", v."name" AS "varianteNombre", v."isDefault" AS "esDefault", v."sku",
           COALESCE(e."existencia", 0)::int AS "existencia", COALESCE(e."disponible", 0)::int AS "disponible",
           COALESCE(m."vendidas", 0)::int AS "vendidas", COALESCE(m."efecto", 0)::int AS "efecto", m."ultimaVenta"
      FROM "catalog_variants" v
      JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
      LEFT JOIN (
        SELECT l."catalogVariantId", SUM(l."onHand") AS "existencia", SUM(l."onHand" - l."reserved") AS "disponible"
          FROM "inventory_levels" l
         WHERE l."companyId" = ${companyId} ${filtroSucursalNivel}
         GROUP BY l."catalogVariantId"
      ) e ON e."catalogVariantId" = v."id"
      LEFT JOIN (
        SELECT l."catalogVariantId",
               SUM(CASE WHEN m."type" = 'SALE' THEN m."quantity" WHEN m."type" = 'RETURN' THEN -m."quantity" ELSE 0 END) AS "vendidas",
               SUM(m."newOnHand" - m."previousOnHand") AS "efecto",
               MAX(CASE WHEN m."type" = 'SALE' THEN m."createdAt" END) AS "ultimaVenta"
          FROM "inventory_movements" m
          JOIN "inventory_levels" l ON l."id" = m."inventoryLevelId" AND l."companyId" = m."companyId"
         WHERE m."companyId" = ${companyId} AND m."createdAt" >= ${corte} ${filtroSucursalNivel}
         GROUP BY l."catalogVariantId"
      ) m ON m."catalogVariantId" = v."id"
     WHERE v."companyId" = ${companyId} AND (COALESCE(e."existencia", 0) > 0 OR COALESCE(m."vendidas", 0) > 0) ${busqueda}
     ORDER BY COALESCE(m."vendidas", 0) DESC, i."name", v."id"
     LIMIT ${tope + 1}`
  const truncado = filasDb.length > tope
  const todas: FilaRotacion[] = filasDb.slice(0, tope).map((x) => {
    const existencia = Number(x.existencia)
    const r = calcularRotacion({
      vendidas: Number(x.vendidas),
      // Lo que había al empezar el periodo: lo de hoy menos lo que cambió desde entonces.
      existenciaInicial: existencia - Number(x.efecto),
      existenciaFinal: existencia,
      disponible: Number(x.disponible),
      dias: f.dias,
    })
    return { ...r, varianteId: x.varianteId, itemId: x.itemId, nombre: nombreCompleto(x.itemNombre, x.varianteNombre, x.esDefault), sku: x.sku, existencia, disponible: Number(x.disponible), ultimaVenta: x.ultimaVenta }
  })
  const porEstado: Record<EstadoCobertura, number> = { AGOTADO: 0, POCA: 0, NORMAL: 0, EXCESO: 0, SIN_VENTAS: 0 }
  let unidadesVendidas = 0
  for (const x of todas) {
    porEstado[x.estado]++
    unidadesVendidas += x.vendidas
  }
  const filtradas = (f.estado ? todas.filter((x) => x.estado === f.estado) : todas).sort(
    (a, b) => compararCobertura(a, b) || b.vendidas - a.vendidas || a.nombre.localeCompare(b.nombre, 'es') || (a.varianteId < b.varianteId ? -1 : 1)
  )
  const porPagina = opciones.todas ? TOPE_FILAS_ROTACION_CSV : FILAS_POR_PAGINA_REPORTES
  const pagina = opciones.todas ? 1 : f.pagina

  let valorado: RotacionVista['valorado'] = null
  if (opciones.conCostos) {
    const costoVentas = await costoDeVentasEnRangoEnTx(tx, companyId, { gte: corte, lt: new Date(ahora.getTime() + 1) }, f.sucursalId)
    const inventario = await valorTotalEnTx(tx, companyId, f.sucursalId)
    valorado = {
      costoDeVentas: costoVentas.costo,
      unidadesSinCosto: costoVentas.unidadesSinCosto,
      valorInventario: inventario.valor,
      diasDeInventario: diasDeInventario(inventario.valor, costoVentas.costo, f.dias),
    }
  }
  return {
    dias: f.dias,
    filas: filtradas.slice((pagina - 1) * porPagina, pagina * porPagina),
    total: filtradas.length,
    pagina,
    porPagina,
    porEstado,
    unidadesVendidas,
    truncado,
    valorado,
  }
}
