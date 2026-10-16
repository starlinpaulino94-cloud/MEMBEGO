import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { diaLocal, limiteDiaLocal, sumarDias } from '@/modules/reportes/rango'
import { costoDeDecimal } from './costos'
import { nombreCompleto } from './formato'
import { patronContiene } from './valor'
import { FILAS_POR_PAGINA_REPORTES } from './reportes'
import {
  CIFRAS_VACIAS,
  esClaseDeVenta,
  excluidasVacias,
  filaDeMargen,
  totalDeMargen,
  type FilaMargen,
  type FiltrosMargen,
  type OrdenMargen,
  type TotalMargen,
  type VentasExcluidas,
} from './margen'

/**
 * COMMERCE CORE · inventario — INV-4c: lecturas del margen real.
 *
 * Solo lectura, siempre dentro de `conEmpresa` y con el `companyId` escrito en cada consulta y en cada unión. ESTAS LECTURAS SIEMPRE
 * LEEN COSTOS: quien las llama (la pantalla, el archivo, la tarjeta del dashboard) tiene que haber comprobado antes que la persona
 * tiene la función `costos`. Un margen sin costo no existe, así que no hay una versión «sin costos» que esconda cifras.
 *
 * DE DÓNDE SALE CADA COSA. El ledger no guarda el precio, y el pedido no guarda el costo; se unen por lo que los dos comparten:
 *   · la VENTA es un movimiento `SALE` del ledger (con el costo promedio que congeló, INV-3a) cuya referencia es el pedido;
 *   · el INGRESO es lo que dice la línea de ese pedido para esa variante (`lineTotal`: cantidad × precio − descuento).
 * Se agrupan por (pedido, variante) antes de unirlos para que una variante repetida en un pedido no multiplique filas.
 */

/** Filas del detalle en el archivo. */
export const TOPE_FILAS_MARGEN_CSV = 20_000

export interface MargenVista {
  /** Días LOCALES de la empresa, ambos incluidos. */
  desde: string
  hasta: string
  /** La moneda de la empresa: lo único que entra al margen. */
  moneda: string
  /** Todo lo que entra al margen (todas las páginas). */
  totales: TotalMargen
  /** Un producto por fila, en el orden pedido. */
  filas: FilaMargen[]
  /** Lo vendido que NO entra al margen, por qué clase (siempre las tres, con ceros si no hubo). */
  excluidas: VentasExcluidas[]
  pagina: number
  porPagina: number
}

interface ParametrosVentas {
  companyId: string
  moneda: string
  gte: Date
  lt: Date
  sucursalId?: string
  q?: string
}

/**
 * Las ventas del rango, una fila por (pedido, variante), CLASIFICADAS: `MARGEN` (pedido completado, en la moneda de la empresa) o
 * la razón por la que no entra. `ingreso` = lo que dice la línea del pedido, en la proporción de las unidades de ese movimiento
 * (en el caso normal, la línea completa).
 */
function ventasClasificadasSql(p: ParametrosVentas): Prisma.Sql {
  const filtroSucursal = p.sucursalId ? Prisma.sql`AND l."locationId" = ${p.sucursalId}` : Prisma.empty
  const busqueda = p.q
    ? Prisma.sql`AND (i."name" ILIKE ${patronContiene(p.q)} OR v."name" ILIKE ${patronContiene(p.q)} OR v."sku" ILIKE ${patronContiene(p.q)} OR v."barcode" ILIKE ${patronContiene(p.q)})`
    : Prisma.empty
  return Prisma.sql`
    WITH ventas AS (
      SELECT l."catalogVariantId" AS "varianteId", m."quantity" AS "cantidad", m."unitCost" AS "costo",
             CASE WHEN m."referenceType" = 'ORDER' THEN m."referenceId" END AS "pedidoId"
        FROM "inventory_movements" m
        JOIN "inventory_levels" l ON l."id" = m."inventoryLevelId" AND l."companyId" = m."companyId"
        JOIN "catalog_variants" v ON v."id" = l."catalogVariantId" AND v."companyId" = l."companyId"
        JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
       WHERE m."companyId" = ${p.companyId} AND m."type" = 'SALE' AND m."createdAt" >= ${p.gte} AND m."createdAt" < ${p.lt}
         ${filtroSucursal} ${busqueda}
    ), por_pedido AS (
      SELECT x."varianteId", x."pedidoId", SUM(x."cantidad") AS "cantidad",
             SUM(CASE WHEN x."costo" IS NULL THEN x."cantidad" ELSE 0 END) AS "sinCosto",
             SUM(x."cantidad" * x."costo") AS "costo"
        FROM ventas x
       GROUP BY x."varianteId", x."pedidoId"
    ), lineas AS (
      SELECT ol."orderId" AS "pedidoId", ol."catalogVariantId" AS "varianteId", SUM(ol."quantity") AS "cantidad", SUM(ol."lineTotal") AS "total"
        FROM "membego_order_lines" ol
       WHERE ol."companyId" = ${p.companyId} AND ol."orderId" IN (SELECT y."pedidoId" FROM por_pedido y WHERE y."pedidoId" IS NOT NULL)
       GROUP BY ol."orderId", ol."catalogVariantId"
    ), clasificadas AS (
      SELECT p."varianteId", p."cantidad", p."sinCosto", p."costo",
             CASE WHEN o."id" IS NULL OR ln."pedidoId" IS NULL OR o."status" NOT IN ('COMPLETED', 'REFUNDED') THEN 'SIN_INGRESO'
                  WHEN o."status" = 'REFUNDED' THEN 'REEMBOLSADO'
                  WHEN o."currency" <> ${p.moneda} THEN 'OTRA_MONEDA'
                  ELSE 'MARGEN' END AS "clase",
             ln."total" * p."cantidad" / NULLIF(ln."cantidad", 0) AS "ingreso"
        FROM por_pedido p
        LEFT JOIN "membego_orders" o ON o."id" = p."pedidoId" AND o."companyId" = ${p.companyId}
        LEFT JOIN lineas ln ON ln."pedidoId" = p."pedidoId" AND ln."varianteId" = p."varianteId"
    )`
}

/** La moneda en que la empresa lleva sus costos y sus precios. */
async function monedaDeLaEmpresa(tx: Tx, companyId: string): Promise<string> {
  const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { moneda: true } })
  return empresa?.moneda ?? 'DOP'
}

/**
 * El margen de TODO lo vendido en un rango (`gte` incluido, `lt` excluido), sin paginar, y lo que no entra y por qué. Es lo que
 * suman las filas del informe y lo que enseña la tarjeta del dashboard: la misma cuenta, una sola vez.
 */
export async function totalesDeMargenEnTx(
  tx: Tx,
  companyId: string,
  rango: { gte: Date; lt: Date },
  opciones: { sucursalId?: string; q?: string } = {}
): Promise<{ moneda: string; totales: TotalMargen; excluidas: VentasExcluidas[] }> {
  const moneda = await monedaDeLaEmpresa(tx, companyId)
  const filas = await tx.$queryRaw<
    { clase: string; productos: number; unidades: number; sinCosto: number; costo: Prisma.Decimal; ingresos: Prisma.Decimal; ingresosSinCosto: Prisma.Decimal }[]
  >`
    ${ventasClasificadasSql({ companyId, moneda, gte: rango.gte, lt: rango.lt, sucursalId: opciones.sucursalId, q: opciones.q })}
    SELECT c."clase", COUNT(DISTINCT c."varianteId")::int AS "productos", COALESCE(SUM(c."cantidad"), 0)::int AS "unidades",
           COALESCE(SUM(c."sinCosto"), 0)::int AS "sinCosto", COALESCE(SUM(c."costo"), 0) AS "costo",
           COALESCE(SUM(c."ingreso"), 0) AS "ingresos",
           COALESCE(SUM(c."ingreso" * c."sinCosto" / NULLIF(c."cantidad", 0)), 0) AS "ingresosSinCosto"
      FROM clasificadas c
     GROUP BY c."clase"`

  let totales = totalDeMargen(CIFRAS_VACIAS, 0)
  const excluidas = excluidasVacias()
  for (const f of filas) {
    const clase: string = f.clase
    if (!esClaseDeVenta(clase)) continue
    if (clase === 'MARGEN') {
      totales = totalDeMargen(
        {
          unidades: Number(f.unidades),
          ingresos: costoDeDecimal(f.ingresos),
          costo: costoDeDecimal(f.costo),
          unidadesSinCosto: Number(f.sinCosto),
          ingresosSinCosto: costoDeDecimal(f.ingresosSinCosto),
        },
        Number(f.productos)
      )
    } else {
      const e = excluidas.find((x) => x.clase === clase)!
      e.unidades = Number(f.unidades)
      e.costo = costoDeDecimal(f.costo)
      e.unidadesSinCosto = Number(f.sinCosto)
    }
  }
  return { moneda, totales, excluidas }
}

/** El `ORDER BY` de cada orden. Son fragmentos fijos: lo que llega de la URL solo elige uno, nunca se concatena. */
const ORDEN_SQL: Record<OrdenMargen, Prisma.Sql> = {
  margen: Prisma.sql`x."margen" DESC`,
  peor: Prisma.sql`x."margen" ASC`,
  porcentaje: Prisma.sql`x."porcentaje" DESC NULLS LAST`,
  ingresos: Prisma.sql`x."ingresos" DESC`,
  unidades: Prisma.sql`x."unidades" DESC`,
}

/**
 * El margen real de un rango de días, producto por producto: lo que se vendió (menos lo reembolsado), lo que se cobró por ello, lo
 * que costó con el costo de aquel día y lo que quedó. Por defecto, los últimos 30 días.
 */
export async function margenEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosMargen,
  opciones: { zonaHoraria: string; todas?: boolean; ahora?: Date }
): Promise<MargenVista> {
  const hoy = diaLocal(opciones.ahora ?? new Date(), opciones.zonaHoraria)
  const hasta = f.hasta ?? hoy
  const desde = f.desde ?? sumarDias(hasta, -29)
  const gte = limiteDiaLocal(desde, opciones.zonaHoraria, false)
  const lt = limiteDiaLocal(hasta, opciones.zonaHoraria, true)

  const { moneda, totales, excluidas } = await totalesDeMargenEnTx(tx, companyId, { gte, lt }, { sucursalId: f.sucursalId, q: f.q })

  const porPagina = opciones.todas ? TOPE_FILAS_MARGEN_CSV : FILAS_POR_PAGINA_REPORTES
  const pagina = opciones.todas ? 1 : f.pagina
  const filasDb = await tx.$queryRaw<
    {
      varianteId: string
      itemNombre: string
      varianteNombre: string
      esDefault: boolean
      sku: string
      unidades: number
      ingresos: Prisma.Decimal
      costo: Prisma.Decimal
      sinCosto: number
      ingresosSinCosto: Prisma.Decimal
    }[]
  >`
    ${ventasClasificadasSql({ companyId, moneda, gte, lt, sucursalId: f.sucursalId, q: f.q })}
    SELECT x."varianteId", x."itemNombre", x."varianteNombre", x."esDefault", x."sku", x."unidades", x."ingresos", x."costo", x."sinCosto", x."ingresosSinCosto"
      FROM (
        SELECT c."varianteId", i."name" AS "itemNombre", v."name" AS "varianteNombre", v."isDefault" AS "esDefault", v."sku",
               SUM(c."cantidad")::int AS "unidades", COALESCE(SUM(c."ingreso"), 0) AS "ingresos", COALESCE(SUM(c."costo"), 0) AS "costo",
               COALESCE(SUM(c."sinCosto"), 0)::int AS "sinCosto",
               COALESCE(SUM(c."ingreso" * c."sinCosto" / NULLIF(c."cantidad", 0)), 0) AS "ingresosSinCosto",
               COALESCE(SUM(c."ingreso"), 0) - COALESCE(SUM(c."ingreso" * c."sinCosto" / NULLIF(c."cantidad", 0)), 0) - COALESCE(SUM(c."costo"), 0) AS "margen",
               (COALESCE(SUM(c."ingreso"), 0) - COALESCE(SUM(c."ingreso" * c."sinCosto" / NULLIF(c."cantidad", 0)), 0) - COALESCE(SUM(c."costo"), 0))
                 / NULLIF(COALESCE(SUM(c."ingreso"), 0) - COALESCE(SUM(c."ingreso" * c."sinCosto" / NULLIF(c."cantidad", 0)), 0), 0) AS "porcentaje"
          FROM clasificadas c
          JOIN "catalog_variants" v ON v."id" = c."varianteId" AND v."companyId" = ${companyId}
          JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = ${companyId}
         WHERE c."clase" = 'MARGEN'
         GROUP BY c."varianteId", i."name", v."name", v."isDefault", v."sku"
      ) x
     ORDER BY ${ORDEN_SQL[f.orden]}, x."sku" ASC, x."varianteId" ASC
     LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`

  const filas = filasDb.map((x) =>
    filaDeMargen({
      varianteId: x.varianteId,
      producto: nombreCompleto(x.itemNombre, x.varianteNombre, x.esDefault),
      sku: x.sku,
      unidades: Number(x.unidades),
      ingresos: costoDeDecimal(x.ingresos),
      costo: costoDeDecimal(x.costo),
      unidadesSinCosto: Number(x.sinCosto),
      ingresosSinCosto: costoDeDecimal(x.ingresosSinCosto),
    })
  )
  return { desde, hasta, moneda, totales, filas, excluidas, pagina, porPagina }
}
