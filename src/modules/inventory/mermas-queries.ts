import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { diaLocal, limiteDiaLocal, sumarDias } from '@/modules/reportes/rango'
import { costoDeDecimal, type Costo } from './costos'
import { nombreCompleto } from './formato'
import { nombresDeUsuarios } from './queries'
import { patronContiene } from './valor'
import { FILAS_POR_PAGINA_REPORTES } from './reportes'
import {
  FILTRO_SIN_MOTIVO,
  GRUPOS_DE_MERMA,
  filaPorMotivo,
  grupoDeClase,
  ordenarPorMotivo,
  totalDeGrupo,
  valorDeMovimiento,
  type FilaPorMotivo,
  type FiltrosMermas,
  type GrupoDeMerma,
  type TotalGrupo,
} from './mermas'
import { detalleDeMotivo, etiquetaDeMotivo, type ClaseDeMotivo } from './motivos'

/**
 * COMMERCE CORE · inventario — INV-4b: lecturas del informe de mermas por motivo.
 *
 * Solo lectura, siempre dentro de `conEmpresa` y con el `companyId` escrito en cada consulta. NUNCA leen costos si quien pide el
 * informe no tiene la función `costos` (`conCostos` en falso): el costo no se esconde en la pantalla, ni siquiera se lee.
 */

/** Filas del detalle en el archivo. */
export const TOPE_FILAS_MERMAS_CSV = 20_000

export interface MovimientoDeMerma {
  id: string
  creadoEn: Date
  clase: ClaseDeMotivo
  grupo: GrupoDeMerma
  /** null = sin motivo codificado. */
  codigo: string | null
  etiquetaMotivo: string
  /** El texto del movimiento, salvo que sea la propia etiqueta del motivo. */
  detalle: string | null
  varianteId: string
  producto: string
  sku: string
  sucursalNombre: string
  unidades: number
  /** El costo congelado en el movimiento; null = sin costo (o no se pueden ver costos). */
  costo: Costo | null
  valor: Costo | null
  usuarioNombre: string | null
}

export interface MermasVista {
  /** Días LOCALES de la empresa, ambos incluidos. */
  desde: string
  hasta: string
  conCostos: boolean
  /** Por grupo: sus filas por motivo, ordenadas de lo que más pesa a lo que menos, y su total. */
  grupos: Record<GrupoDeMerma, { filas: FilaPorMotivo[]; total: TotalGrupo }>
  /** El detalle, del más reciente al más antiguo. */
  movimientos: MovimientoDeMerma[]
  /** Movimientos que cumplen los filtros (todas las páginas). */
  total: number
  pagina: number
  porPagina: number
}

/** La clase de un movimiento, en SQL: la misma regla que `claseDeMovimiento` (una prueba comprueba que coinciden). */
const CLASE_SQL = Prisma.sql`CASE
    WHEN m."type" = 'DAMAGE' AND m."sourceBucket" = 'AVAILABLE' AND m."destinationBucket" = 'DAMAGED' THEN 'DANO'
    WHEN m."type" = 'ADJUSTMENT' AND m."sourceBucket" IS NULL AND m."destinationBucket" IS NOT NULL THEN 'SOBRANTE'
    WHEN m."type" = 'ADJUSTMENT' AND m."sourceBucket" = 'DAMAGED' AND m."destinationBucket" IS NULL THEN 'BAJA'
    WHEN m."type" = 'ADJUSTMENT' AND m."sourceBucket" IS NOT NULL AND m."destinationBucket" IS NULL THEN 'FALTANTE'
  END`

/**
 * Las mermas de un rango de días: lo perdido (faltantes y bajas), los sobrantes y lo dañado, cada uno POR MOTIVO, con unidades y,
 * si se pueden ver costos, lo que valieron; y el detalle movimiento por movimiento. Por defecto, los últimos 30 días.
 *
 * Los movimientos anteriores a INV-4b, o hechos por procesos que no eligen un motivo, salen como «Sin motivo codificado»:
 * el ledger no se reescribe, así que no se inventa un motivo para ellos.
 */
export async function mermasEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosMermas,
  opciones: { zonaHoraria: string; conCostos: boolean; todas?: boolean; ahora?: Date }
): Promise<MermasVista> {
  const hoy = diaLocal(opciones.ahora ?? new Date(), opciones.zonaHoraria)
  const hasta = f.hasta ?? hoy
  const desde = f.desde ?? sumarDias(hasta, -29)
  const gte = limiteDiaLocal(desde, opciones.zonaHoraria, false)
  const lt = limiteDiaLocal(hasta, opciones.zonaHoraria, true)

  const filtroSucursal = f.sucursalId ? Prisma.sql`AND l."locationId" = ${f.sucursalId}` : Prisma.empty
  const filtroMotivo = f.motivo === FILTRO_SIN_MOTIVO ? Prisma.sql`AND m."reasonCode" IS NULL` : f.motivo ? Prisma.sql`AND m."reasonCode" = ${f.motivo}` : Prisma.empty
  const busqueda = f.q
    ? Prisma.sql`AND (i."name" ILIKE ${patronContiene(f.q)} OR v."name" ILIKE ${patronContiene(f.q)} OR v."sku" ILIKE ${patronContiene(f.q)} OR v."barcode" ILIKE ${patronContiene(f.q)})`
    : Prisma.empty
  // El costo solo se lee con la función `costos`: sin ella la columna es un NULL constante.
  const costoSql = opciones.conCostos ? Prisma.sql`m."unitCost"` : Prisma.sql`NULL::numeric`
  const desdeSql = Prisma.sql`
    FROM "inventory_movements" m
    JOIN "inventory_levels" l ON l."id" = m."inventoryLevelId" AND l."companyId" = m."companyId"
    JOIN "catalog_variants" v ON v."id" = l."catalogVariantId" AND v."companyId" = l."companyId"
    JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
    JOIN "sucursales" s ON s."id" = l."locationId" AND s."companyId" = l."companyId"
    WHERE m."companyId" = ${companyId} AND m."type" IN ('ADJUSTMENT', 'DAMAGE') AND m."createdAt" >= ${gte} AND m."createdAt" < ${lt}
      ${filtroSucursal} ${filtroMotivo} ${busqueda}`

  const agregados = await tx.$queryRaw<{ clase: ClaseDeMotivo | null; codigo: string | null; movimientos: number; unidades: number; sinCosto: number; valor: Prisma.Decimal }[]>`
    SELECT x."clase", x."codigo", COUNT(*)::int AS "movimientos", SUM(x."cantidad")::int AS "unidades",
           COALESCE(SUM(CASE WHEN x."costo" IS NULL THEN x."cantidad" ELSE 0 END), 0)::int AS "sinCosto",
           COALESCE(SUM(x."cantidad" * x."costo"), 0) AS "valor"
      FROM (SELECT ${CLASE_SQL} AS "clase", m."reasonCode" AS "codigo", m."quantity" AS "cantidad", ${costoSql} AS "costo" ${desdeSql}) x
     WHERE x."clase" IS NOT NULL
     GROUP BY x."clase", x."codigo"`

  const porGrupo = new Map<GrupoDeMerma, Map<string | null, { movimientos: number; unidades: number; sinCosto: number; valor: Costo }>>(GRUPOS_DE_MERMA.map((g) => [g, new Map()]))
  for (const a of agregados) {
    if (a.clase === null) continue
    const filas = porGrupo.get(grupoDeClase(a.clase))!
    // Faltantes y bajas comparten grupo: con el mismo motivo se suman en una sola fila.
    const previa = filas.get(a.codigo) ?? { movimientos: 0, unidades: 0, sinCosto: 0, valor: BigInt(0) }
    filas.set(a.codigo, {
      movimientos: previa.movimientos + Number(a.movimientos),
      unidades: previa.unidades + Number(a.unidades),
      sinCosto: previa.sinCosto + Number(a.sinCosto),
      valor: previa.valor + costoDeDecimal(a.valor),
    })
  }
  const grupos = Object.fromEntries(
    GRUPOS_DE_MERMA.map((g) => {
      const filas = ordenarPorMotivo(
        [...porGrupo.get(g)!].map(([codigo, c]) =>
          filaPorMotivo({ codigo, movimientos: c.movimientos, unidades: c.unidades, valor: opciones.conCostos ? c.valor : null, unidadesSinCosto: opciones.conCostos ? c.sinCosto : null })
        )
      )
      return [g, { filas, total: totalDeGrupo(filas) }]
    })
  ) as MermasVista['grupos']

  const total = GRUPOS_DE_MERMA.reduce((t, g) => t + grupos[g].total.movimientos, 0)
  const porPagina = opciones.todas ? TOPE_FILAS_MERMAS_CSV : FILAS_POR_PAGINA_REPORTES
  const pagina = opciones.todas ? 1 : f.pagina
  const filasDb = await tx.$queryRaw<
    {
      id: string
      creadoEn: Date
      clase: ClaseDeMotivo
      codigo: string | null
      detalle: string | null
      cantidad: number
      costo: Prisma.Decimal | null
      usuarioId: string | null
      varianteId: string
      itemNombre: string
      varianteNombre: string
      esDefault: boolean
      sku: string
      sucursalNombre: string
    }[]
  >`
    SELECT x.* FROM (
      SELECT m."id", m."createdAt" AS "creadoEn", ${CLASE_SQL} AS "clase", m."reasonCode" AS "codigo", m."reason" AS "detalle", m."quantity" AS "cantidad",
             ${costoSql} AS "costo", m."userId" AS "usuarioId", v."id" AS "varianteId", i."name" AS "itemNombre", v."name" AS "varianteNombre", v."isDefault" AS "esDefault",
             v."sku", s."nombre" AS "sucursalNombre"
        ${desdeSql}
    ) x
    WHERE x."clase" IS NOT NULL
    ORDER BY x."creadoEn" DESC, x."id" DESC
    LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`
  const nombres = await nombresDeUsuarios(tx, filasDb.map((x) => x.usuarioId))
  const movimientos: MovimientoDeMerma[] = filasDb.map((x) => {
    const costo = x.costo !== null ? costoDeDecimal(x.costo) : null
    return {
      id: x.id,
      creadoEn: x.creadoEn,
      clase: x.clase,
      grupo: grupoDeClase(x.clase),
      codigo: x.codigo,
      etiquetaMotivo: etiquetaDeMotivo(x.codigo),
      detalle: detalleDeMotivo(x.codigo, x.detalle),
      varianteId: x.varianteId,
      producto: nombreCompleto(x.itemNombre, x.varianteNombre, x.esDefault),
      sku: x.sku,
      sucursalNombre: x.sucursalNombre,
      unidades: Number(x.cantidad),
      costo,
      valor: valorDeMovimiento(Number(x.cantidad), costo),
      usuarioNombre: x.usuarioId ? (nombres.get(x.usuarioId) ?? null) : null,
    }
  })
  return { desde, hasta, conCostos: opciones.conCostos, grupos, movimientos, total, pagina, porPagina }
}
