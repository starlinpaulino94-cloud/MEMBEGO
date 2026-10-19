import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { limiteDiaLocal } from '@/modules/reportes/rango'
import { costoDeDecimal, formatearCosto, formatearMonto, valorDe, type Costo } from './costos'
import { FILAS_POR_PAGINA_VALOR, type FiltrosValor } from './filtros'
import { nombreCompleto } from './formato'

/**
 * COMMERCE CORE · inventario — INV-3a: lecturas del VALOR del inventario y del
 * costo de ventas. Solo lectura, siempre dentro de `conEmpresa` y con `companyId`
 * en cada consulta.
 *
 * LO QUE VALE UN PRODUCTO. Su costo promedio; mientras no tiene promedio, el costo
 * de referencia de su ficha del catálogo; si no tiene ninguno, NO TIENE COSTO. Lo
 * que no tiene costo no suma al valor —ni como cero—: se cuenta aparte y se dice.
 *
 * LO QUE CUENTA COMO EXISTENCIA. Vendible + apartado + dañado, en todas las
 * sucursales (también las cerradas): es lo que la empresa tiene y todavía no ha
 * dado de baja. Lo que va EN CAMINO entre sucursales sale de las dos y se enseña
 * aparte.
 *
 * Los montos viajan como TEXTO ya formateado: nada de `bigint` ni `Decimal` cruzando
 * al navegador.
 */

export interface ResumenValorVista {
  /** Valor de lo que tiene costo, ya formateado («12,345.67»). */
  valor: string
  unidades: number
  unidadesConCosto: number
  unidadesSinCosto: number
  productos: number
  productosSinCosto: number
  /** De las unidades, cuántas están dañadas (siguen valiendo hasta darlas de baja). */
  danadas: number
}

export interface SucursalValorVista {
  sucursalId: string
  nombre: string
  activa: boolean
  unidades: number
  unidadesSinCosto: number
  valor: string
}

export interface FilaValorVista {
  varianteId: string
  itemId: string
  nombre: string
  sku: string
  unidades: number
  danadas: number
  /** Costo unitario ya formateado; null = sin costo. */
  costo: string | null
  /** De dónde sale el costo: el promedio de las entradas, o el de referencia del catálogo. */
  fuente: 'PROMEDIO' | 'REFERENCIA' | null
  /** unidades × costo, ya formateado; null = sin costo. */
  valor: string | null
}

export interface EnTransitoValorVista {
  unidades: number
  unidadesSinCosto: number
  valor: string
}

export interface CostoDeVentasVista {
  /** `YYYY-MM` del mes que se mide. */
  mes: string
  /** Costo de lo vendido menos el de lo devuelto, ya formateado. */
  costo: string
  unidadesVendidas: number
  /** Unidades vendidas cuyo costo no se conocía (movimientos anteriores a INV-3a y productos sin costo). */
  unidadesSinCosto: number
  unidadesDevueltas: number
}

export interface ValorDelInventario {
  resumen: ResumenValorVista
  /** TODAS las sucursales con existencias, aunque la tabla esté filtrada a una. */
  porSucursal: SucursalValorVista[]
  /** null si no se pudo leer (la migración de transferencias aún no se aplicó). */
  enTransito: EnTransitoValorVista | null
  costoDeVentas: CostoDeVentasVista
  filas: FilaValorVista[]
  /** Productos que cumplen los filtros (todas las páginas). */
  totalFilas: number
  pagina: number
  porPagina: number
}

/** `%texto%` para un `ILIKE`, con los comodines del propio texto neutralizados. */
export function patronContiene(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`
}

const CERO: Costo = BigInt(0)

/** El mes `YYYY-MM` en curso en la zona horaria de la empresa. */
export function mesActual(zonaHoraria: string, ahora: Date = new Date()): string {
  try {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria, year: 'numeric', month: '2-digit' }).formatToParts(ahora)
    const anio = partes.find((p) => p.type === 'year')?.value
    const mes = partes.find((p) => p.type === 'month')?.value
    if (anio && mes) return `${anio}-${mes}`
  } catch {
    // Zona inválida: cae al calendario UTC.
  }
  return ahora.toISOString().slice(0, 7)
}

/** El primer día del mes siguiente a un `YYYY-MM`. */
function mesSiguiente(mes: string): string {
  const anio = Number(mes.slice(0, 4))
  const m = Number(mes.slice(5))
  return m === 12 ? `${anio + 1}-01-01` : `${anio}-${String(m + 1).padStart(2, '0')}-01`
}

/** Los instantes UTC en que empieza y termina un mes, según el calendario de la empresa. */
export function rangoDeMes(mes: string, zonaHoraria: string): { gte: Date; lt: Date } {
  return { gte: limiteDiaLocal(`${mes}-01`, zonaHoraria, false), lt: limiteDiaLocal(mesSiguiente(mes), zonaHoraria, false) }
}

/** El costo de ventas de un periodo, tal cual sale de la base: el costo ya restado y las unidades. */
export interface CostoDeVentasCrudo {
  /** Lo que costó lo vendido menos lo que costó lo devuelto, en diezmilésimas; nunca negativo. */
  costo: Costo
  unidadesVendidas: number
  /** Unidades vendidas cuyo costo no se conocía. */
  unidadesSinCosto: number
  unidadesDevueltas: number
}

/**
 * El costo de ventas de un periodo cualquiera (`gte` incluido, `lt` excluido): lo que costó lo que se vendió, menos lo que
 * costó lo que se devolvió, con el costo que cada movimiento congeló al ocurrir. Lo que no tenía costo no suma: se cuenta aparte.
 */
export async function costoDeVentasEnRangoEnTx(tx: Tx, companyId: string, rango: { gte: Date; lt: Date }, sucursalId?: string): Promise<CostoDeVentasCrudo> {
  const { gte, lt } = rango
  const filtroSucursal = sucursalId ? Prisma.sql`AND l."locationId" = ${sucursalId}` : Prisma.empty
  const filas = await tx.$queryRaw<{ ventas: Prisma.Decimal; devoluciones: Prisma.Decimal; vendidas: number; sinCosto: number; devueltas: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN m."type" = 'SALE' THEN m."quantity" * m."unitCost" END), 0) AS "ventas",
           COALESCE(SUM(CASE WHEN m."type" = 'RETURN' THEN m."quantity" * m."unitCost" END), 0) AS "devoluciones",
           COALESCE(SUM(CASE WHEN m."type" = 'SALE' THEN m."quantity" END), 0)::int AS "vendidas",
           COALESCE(SUM(CASE WHEN m."type" = 'SALE' AND m."unitCost" IS NULL THEN m."quantity" END), 0)::int AS "sinCosto",
           COALESCE(SUM(CASE WHEN m."type" = 'RETURN' THEN m."quantity" END), 0)::int AS "devueltas"
      FROM "inventory_movements" m
      JOIN "inventory_levels" l ON l."id" = m."inventoryLevelId" AND l."companyId" = m."companyId"
     WHERE m."companyId" = ${companyId} AND m."type" IN ('SALE', 'RETURN') AND m."createdAt" >= ${gte} AND m."createdAt" < ${lt}
       ${filtroSucursal}`
  const f = filas[0]
  const neto = costoDeDecimal(f?.ventas ?? 0) - costoDeDecimal(f?.devoluciones ?? 0)
  return {
    costo: neto < CERO ? CERO : neto,
    unidadesVendidas: Number(f?.vendidas ?? 0),
    unidadesSinCosto: Number(f?.sinCosto ?? 0),
    unidadesDevueltas: Number(f?.devueltas ?? 0),
  }
}

/** El costo de ventas de un mes (`YYYY-MM`, en el calendario de la empresa), ya formateado para enseñarlo. */
export async function costoDeVentasEnTx(tx: Tx, companyId: string, mes: string, zonaHoraria: string, sucursalId?: string): Promise<CostoDeVentasVista> {
  const r = await costoDeVentasEnRangoEnTx(tx, companyId, rangoDeMes(mes, zonaHoraria), sucursalId)
  return { mes, costo: formatearMonto(r.costo), unidadesVendidas: r.unidadesVendidas, unidadesSinCosto: r.unidadesSinCosto, unidadesDevueltas: r.unidadesDevueltas }
}

/**
 * Lo que vale TODO el inventario (vendible + apartado + dañado, en todas las sucursales o en una), con lo que no tiene costo
 * contado aparte: mismas reglas que la pantalla de Valor, sin su tabla.
 */
export async function valorTotalEnTx(tx: Tx, companyId: string, sucursalId?: string): Promise<{ valor: Costo; unidades: number; unidadesSinCosto: number }> {
  const filtroSucursal = sucursalId ? Prisma.sql`AND l."locationId" = ${sucursalId}` : Prisma.empty
  const filas = await tx.$queryRaw<{ unidades: number; sinCosto: number; valor: Prisma.Decimal }[]>`
    SELECT COALESCE(SUM(l."onHand" + l."damaged"), 0)::int AS "unidades",
           COALESCE(SUM(CASE WHEN COALESCE(c."averageCost", v."cost") IS NULL THEN l."onHand" + l."damaged" ELSE 0 END), 0)::int AS "sinCosto",
           COALESCE(SUM((l."onHand" + l."damaged") * COALESCE(c."averageCost", v."cost")), 0) AS "valor"
      FROM "inventory_levels" l
      JOIN "catalog_variants" v ON v."id" = l."catalogVariantId" AND v."companyId" = l."companyId"
      LEFT JOIN "inventory_variant_costs" c ON c."catalogVariantId" = v."id" AND c."companyId" = v."companyId"
     WHERE l."companyId" = ${companyId} AND (l."onHand" + l."damaged") > 0 ${filtroSucursal}`
  const f = filas[0]
  return { valor: costoDeDecimal(f?.valor ?? 0), unidades: Number(f?.unidades ?? 0), unidadesSinCosto: Number(f?.sinCosto ?? 0) }
}

/** Lo que vale lo que va EN CAMINO entre sucursales (enviado y todavía no recibido); null si no se puede leer. */
async function enTransitoEnTx(tx: Tx, companyId: string): Promise<EnTransitoValorVista | null> {
  try {
    const filas = await tx.$queryRaw<{ unidades: number; sinCosto: number; valor: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(x."pendiente"), 0)::int AS "unidades",
             COALESCE(SUM(CASE WHEN x."costo" IS NULL THEN x."pendiente" ELSE 0 END), 0)::int AS "sinCosto",
             COALESCE(SUM(x."pendiente" * x."costo"), 0) AS "valor"
        FROM (
          SELECT (tl."quantitySent" - tl."quantityReceived" - tl."quantityReturned" - tl."quantityLost") AS "pendiente",
                 COALESCE(c."averageCost", v."cost") AS "costo"
            FROM "inventory_transfer_lines" tl
            JOIN "inventory_transfers" t ON t."id" = tl."transferId" AND t."companyId" = tl."companyId"
            JOIN "catalog_variants" v ON v."id" = tl."catalogVariantId" AND v."companyId" = tl."companyId"
            LEFT JOIN "inventory_variant_costs" c ON c."catalogVariantId" = v."id" AND c."companyId" = v."companyId"
           WHERE tl."companyId" = ${companyId} AND t."status" IN ('SENT', 'PARTIAL')
        ) x
       WHERE x."pendiente" > 0`
    const f = filas[0]
    return { unidades: Number(f?.unidades ?? 0), unidadesSinCosto: Number(f?.sinCosto ?? 0), valor: formatearMonto(costoDeDecimal(f?.valor ?? 0)) }
  } catch (e) {
    console.error('[inventario-valor] lo que va en camino no está disponible', e instanceof Error ? e.message : e)
    return null
  }
}

export interface OpcionesValor {
  zonaHoraria: string
  /** Para exportar: todas las filas (hasta el tope) en lugar de una página. */
  todas?: boolean
  /** Para pruebas: el «ahora» que decide el mes en curso. */
  ahora?: Date
}

/** Tope de filas de una exportación. */
export const TOPE_FILAS_VALOR = 20_000

/** El valor del inventario con sus filtros: resumen, sucursales, en tránsito, costo de ventas del mes y la tabla de productos. */
export async function valorDelInventarioEnTx(tx: Tx, companyId: string, f: FiltrosValor, opciones: OpcionesValor): Promise<ValorDelInventario> {
  // Las existencias, con su producto, su costo y su sucursal. `{SUCURSAL}` se pone o no según la consulta.
  const desde = Prisma.sql`
    FROM "inventory_levels" l
    JOIN "catalog_variants" v ON v."id" = l."catalogVariantId" AND v."companyId" = l."companyId"
    JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
    JOIN "sucursales" s ON s."id" = l."locationId" AND s."companyId" = l."companyId"
    LEFT JOIN "inventory_variant_costs" c ON c."catalogVariantId" = v."id" AND c."companyId" = v."companyId"`
  const hayExistencias = Prisma.sql`l."companyId" = ${companyId} AND (l."onHand" + l."damaged") > 0`
  const deSucursal = f.sucursalId ? Prisma.sql`AND l."locationId" = ${f.sucursalId}` : Prisma.empty
  const busqueda = f.q
    ? Prisma.sql`AND (i."name" ILIKE ${patronContiene(f.q)} OR v."name" ILIKE ${patronContiene(f.q)} OR v."sku" ILIKE ${patronContiene(f.q)} OR v."barcode" ILIKE ${patronContiene(f.q)})`
    : Prisma.empty
  const soloSinCosto = f.sinCosto ? Prisma.sql`HAVING COALESCE(c."averageCost", v."cost") IS NULL` : Prisma.empty

  // 1) El resumen: por PRODUCTO (uno que está en dos sucursales cuenta una vez), con el filtro de sucursal pero sin el de texto.
  const resumenFilas = await tx.$queryRaw<{ productos: number; unidades: number; danadas: number; sinCosto: number; productosSinCosto: number; valor: Prisma.Decimal }[]>`
    SELECT COUNT(*)::int AS "productos",
           COALESCE(SUM(p."unidades"), 0)::int AS "unidades",
           COALESCE(SUM(p."danadas"), 0)::int AS "danadas",
           COALESCE(SUM(CASE WHEN p."costo" IS NULL THEN p."unidades" ELSE 0 END), 0)::int AS "sinCosto",
           COALESCE(SUM(CASE WHEN p."costo" IS NULL THEN 1 ELSE 0 END), 0)::int AS "productosSinCosto",
           COALESCE(SUM(p."unidades" * p."costo"), 0) AS "valor"
      FROM (
        SELECT SUM(l."onHand" + l."damaged")::int AS "unidades", SUM(l."damaged")::int AS "danadas", COALESCE(c."averageCost", v."cost") AS "costo"
        ${desde}
        WHERE ${hayExistencias} ${deSucursal}
        GROUP BY v."id", c."averageCost", v."cost"
      ) p`
  const rs = resumenFilas[0]
  const resumen: ResumenValorVista = {
    valor: formatearMonto(costoDeDecimal(rs?.valor ?? 0)),
    unidades: Number(rs?.unidades ?? 0),
    unidadesSinCosto: Number(rs?.sinCosto ?? 0),
    unidadesConCosto: Number(rs?.unidades ?? 0) - Number(rs?.sinCosto ?? 0),
    productos: Number(rs?.productos ?? 0),
    productosSinCosto: Number(rs?.productosSinCosto ?? 0),
    danadas: Number(rs?.danadas ?? 0),
  }

  // 2) Por sucursal: todas, aunque la tabla esté filtrada a una.
  const porSucursalFilas = await tx.$queryRaw<{ sucursalId: string; nombre: string; activa: boolean; unidades: number; sinCosto: number; valor: Prisma.Decimal }[]>`
    SELECT l."locationId" AS "sucursalId", s."nombre", s."activa",
           SUM(l."onHand" + l."damaged")::int AS "unidades",
           SUM(CASE WHEN COALESCE(c."averageCost", v."cost") IS NULL THEN l."onHand" + l."damaged" ELSE 0 END)::int AS "sinCosto",
           COALESCE(SUM((l."onHand" + l."damaged") * COALESCE(c."averageCost", v."cost")), 0) AS "valor"
    ${desde}
     WHERE ${hayExistencias}
     GROUP BY l."locationId", s."nombre", s."activa"
     ORDER BY s."nombre"`
  const porSucursal: SucursalValorVista[] = porSucursalFilas.map((x) => ({
    sucursalId: x.sucursalId,
    nombre: x.nombre,
    activa: x.activa,
    unidades: Number(x.unidades),
    unidadesSinCosto: Number(x.sinCosto),
    valor: formatearMonto(costoDeDecimal(x.valor)),
  }))

  // 3) La tabla de productos, con todos los filtros.
  const agrupado = Prisma.sql`
    ${desde}
    WHERE ${hayExistencias} ${deSucursal} ${busqueda}
    GROUP BY v."id", i."id", i."name", v."name", v."isDefault", v."sku", c."averageCost", v."cost"
    ${soloSinCosto}`
  const [{ total }] = await tx.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" FROM (SELECT v."id" ${agrupado}) t`
  const porPagina = opciones.todas ? TOPE_FILAS_VALOR : FILAS_POR_PAGINA_VALOR
  const pagina = opciones.todas ? 1 : f.pagina
  const filasDb = await tx.$queryRaw<
    { varianteId: string; itemId: string; itemNombre: string; varianteNombre: string; esDefault: boolean; sku: string; unidades: number; danadas: number; promedio: Prisma.Decimal | null; referencia: Prisma.Decimal | null }[]
  >`
    SELECT v."id" AS "varianteId", i."id" AS "itemId", i."name" AS "itemNombre", v."name" AS "varianteNombre", v."isDefault" AS "esDefault", v."sku",
           SUM(l."onHand" + l."damaged")::int AS "unidades", SUM(l."damaged")::int AS "danadas",
           c."averageCost" AS "promedio", v."cost" AS "referencia"
    ${agrupado}
    ORDER BY (SUM(l."onHand" + l."damaged") * COALESCE(c."averageCost", v."cost")) DESC NULLS LAST, i."name", v."id"
    LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`
  const filas: FilaValorVista[] = filasDb.map((x) => {
    const costo = x.promedio !== null ? costoDeDecimal(x.promedio) : x.referencia !== null ? costoDeDecimal(x.referencia) : null
    return {
      varianteId: x.varianteId,
      itemId: x.itemId,
      nombre: nombreCompleto(x.itemNombre, x.varianteNombre, x.esDefault),
      sku: x.sku,
      unidades: Number(x.unidades),
      danadas: Number(x.danadas),
      costo: costo === null ? null : formatearCosto(costo),
      fuente: x.promedio !== null ? 'PROMEDIO' : x.referencia !== null ? 'REFERENCIA' : null,
      valor: costo === null ? null : formatearMonto(valorDe(Number(x.unidades), costo)),
    }
  })

  const mes = f.mes ?? mesActual(opciones.zonaHoraria, opciones.ahora)
  return {
    resumen,
    porSucursal,
    enTransito: await enTransitoEnTx(tx, companyId),
    costoDeVentas: await costoDeVentasEnTx(tx, companyId, mes, opciones.zonaHoraria, f.sucursalId),
    filas,
    totalFilas: Number(total),
    pagina,
    porPagina,
  }
}

// ── La ficha de un producto ──────────────────────────────────────────────────

export interface CorreccionDeCostoVista {
  id: string
  creadoEn: Date
  anterior: string | null
  nuevo: string
  unidades: number
  motivo: string
  autor: string | null
}

export interface CostoDeVarianteVista {
  /** Costo vigente ya formateado; null = sin costo. */
  costo: string | null
  fuente: 'PROMEDIO' | 'REFERENCIA' | null
  promedio: string | null
  referencia: string | null
  ultimoCosto: string | null
  ultimoCostoEn: Date | null
  /** Unidades de toda la empresa (vendible + apartado + dañado). */
  unidades: number
  /** unidades × costo; null = sin costo. */
  valor: string | null
  correcciones: CorreccionDeCostoVista[]
}

/** Lo que cuesta un producto y lo que vale lo que hay de él, con sus últimas correcciones de costo. */
export async function costoDeVarianteEnTx(tx: Tx, companyId: string, varianteId: string): Promise<CostoDeVarianteVista> {
  const v = await tx.catalogVariant.findFirst({
    where: { id: varianteId, companyId },
    select: { cost: true, inventoryCost: { select: { averageCost: true, lastCost: true, lastCostAt: true } } },
  })
  const promedio = v?.inventoryCost ? costoDeDecimal(v.inventoryCost.averageCost) : null
  const referencia = v?.cost ? costoDeDecimal(v.cost) : null
  const costo = promedio ?? referencia
  const agregado = await tx.inventoryLevel.aggregate({ where: { companyId, catalogVariantId: varianteId }, _sum: { onHand: true, damaged: true } })
  const unidades = (agregado._sum.onHand ?? 0) + (agregado._sum.damaged ?? 0)
  const correcciones = await tx.inventoryCostAdjustment.findMany({
    where: { companyId, catalogVariantId: varianteId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 5,
    select: { id: true, createdAt: true, previousCost: true, newCost: true, unitsOnHand: true, reason: true, userId: true },
  })
  const autores = new Map<string, string>()
  const ids = [...new Set(correcciones.map((x) => x.userId).filter((x): x is string => Boolean(x)))]
  if (ids.length > 0) for (const u of await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })) autores.set(u.id, u.name || u.email)
  return {
    costo: costo === null ? null : formatearCosto(costo),
    fuente: promedio !== null ? 'PROMEDIO' : referencia !== null ? 'REFERENCIA' : null,
    promedio: promedio === null ? null : formatearCosto(promedio),
    referencia: referencia === null ? null : formatearCosto(referencia),
    ultimoCosto: v?.inventoryCost?.lastCost ? formatearCosto(costoDeDecimal(v.inventoryCost.lastCost)) : null,
    ultimoCostoEn: v?.inventoryCost?.lastCostAt ?? null,
    unidades,
    valor: costo === null ? null : formatearMonto(valorDe(unidades, costo)),
    correcciones: correcciones.map((x) => ({
      id: x.id,
      creadoEn: x.createdAt,
      anterior: x.previousCost ? formatearCosto(costoDeDecimal(x.previousCost)) : null,
      nuevo: formatearCosto(costoDeDecimal(x.newCost)),
      unidades: x.unitsOnHand,
      motivo: x.reason,
      autor: x.userId ? (autores.get(x.userId) ?? null) : null,
    })),
  }
}
