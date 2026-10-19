import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { diaLocal } from '@/modules/reportes/rango'
import { costoDeDecimal, type Costo } from './costos'
import { nombreCompleto } from './formato'
import { diasEntre, textoVencimiento } from './lotes'
import {
  DIAS_URGENTE,
  FILAS_POR_PAGINA_VENCIMIENTOS,
  VENTANA_POR_DEFECTO,
  claseDeVencimiento,
  limiteDeVentana,
  urgenciaDe,
  type ClaseVencimiento,
  type FiltrosVencimientos,
  type Urgencia,
} from './vencimientos'
import { patronContiene } from './valor'

/**
 * COMMERCE CORE · inventario — INV-5b1: lecturas de «lo que vence pronto» (el informe, y el resumen que usan la tarjeta del dashboard
 * y el aviso del barrido).
 *
 * Solo lectura, siempre dentro de `conEmpresa` y con el `companyId` escrito en cada consulta. NUNCA leen costos si quien pide el
 * informe no tiene la función `costos` (`conCostos` en falso): el costo no se esconde en la pantalla, ni siquiera se lee.
 *
 * Una fila es un lote EN UNA SUCURSAL con existencias (vendibles o apartadas) cuyo vencimiento ya pasó o cae dentro de la ventana.
 * Lo dañado no cuenta (ya salió de lo vendible) y un lote sin fecha de vencimiento nunca aparece.
 */

export const TOPE_FILAS_VENCIMIENTOS_CSV = 20_000

export interface FilaVencimiento {
  /** El saldo por lote (el lote en esa sucursal). */
  saldoPorLoteId: string
  loteId: string
  codigo: string
  /** `YYYY-MM-DD`. */
  vencimiento: string
  clase: ClaseVencimiento
  urgencia: Urgencia
  /** Negativo si ya venció; 0 si vence hoy. */
  diasRestantes: number
  /** «Vence en 12 días», «Venció ayer». */
  texto: string
  varianteId: string
  itemId: string
  nombre: string
  sku: string
  sucursalId: string
  sucursalNombre: string
  sucursalActiva: boolean
  /** Lo que hay menos lo apartado: lo que todavía se puede vender o mover. */
  vendible: number
  apartado: number
  danado: number
  /** El costo vigente (promedio o de referencia); null = sin costo (o no se pueden ver costos). */
  costo: Costo | null
  /** vendible × costo; null = sin costo (o no se pueden ver costos). */
  valor: Costo | null
}

export interface VencimientosVista {
  dias: number
  /** El día de hoy en el calendario de la empresa. */
  hoy: string
  filas: FilaVencimiento[]
  /** Lotes en sucursal que cumplen los filtros (todas las páginas). */
  total: number
  pagina: number
  porPagina: number
  resumen: {
    /** Lotes distintos (un lote en dos sucursales cuenta una vez). */
    lotes: number
    lotesVencidos: number
    /** Unidades vendibles de todo lo que cumple los filtros. */
    unidades: number
    /** Lo que vale lo vendible que vence; null si no se pueden ver costos. */
    valor: Costo | null
    /** Unidades vendibles sin costo conocido; null si no se pueden ver costos. */
    unidadesSinCosto: number | null
  }
}

/**
 * Los lotes con existencias que ya vencieron o vencen dentro de `f.dias` días, por sucursal, de lo que antes vence a lo que después
 * (lo vencido, primero). «Hoy» es el día de la empresa. Un lote que vence hoy es «por vencer»: todavía se vende.
 */
export async function vencimientosEnTx(
  tx: Tx,
  companyId: string,
  f: FiltrosVencimientos,
  opciones: { zonaHoraria: string; conCostos: boolean; todas?: boolean; ahora?: Date }
): Promise<VencimientosVista> {
  const hoy = diaLocal(opciones.ahora ?? new Date(), opciones.zonaHoraria)
  const limite = limiteDeVentana(hoy, f.dias)
  const filtroClase = f.clase === 'VENCIDO' ? Prisma.sql`AND l."expiresOn" < ${hoy}::date` : f.clase === 'POR_VENCER' ? Prisma.sql`AND l."expiresOn" >= ${hoy}::date` : Prisma.empty
  const filtroSucursal = f.sucursalId ? Prisma.sql`AND lv."locationId" = ${f.sucursalId}` : Prisma.empty
  const busqueda = f.q
    ? Prisma.sql`AND (i."name" ILIKE ${patronContiene(f.q)} OR v."name" ILIKE ${patronContiene(f.q)} OR v."sku" ILIKE ${patronContiene(f.q)} OR v."barcode" ILIKE ${patronContiene(f.q)} OR l."code" ILIKE ${patronContiene(f.q)})`
    : Prisma.empty
  // El costo solo se lee con la función `costos`: sin ella la columna es un NULL constante y la tabla de costos ni se une.
  const costoSql = opciones.conCostos ? Prisma.sql`COALESCE(c."averageCost", v."cost")` : Prisma.sql`NULL::numeric`
  const unirCostos = opciones.conCostos ? Prisma.sql`LEFT JOIN "inventory_variant_costs" c ON c."catalogVariantId" = v."id" AND c."companyId" = v."companyId"` : Prisma.empty
  const desde = Prisma.sql`
    FROM "inventory_lot_balances" b
    JOIN "inventory_lots" l ON l."id" = b."lotId" AND l."companyId" = b."companyId"
    JOIN "inventory_levels" lv ON lv."id" = b."inventoryLevelId" AND lv."companyId" = b."companyId"
    JOIN "catalog_variants" v ON v."id" = b."catalogVariantId" AND v."companyId" = b."companyId"
    JOIN "catalog_items" i ON i."id" = v."catalogItemId" AND i."companyId" = v."companyId"
    JOIN "sucursales" s ON s."id" = lv."locationId" AND s."companyId" = lv."companyId"
    ${unirCostos}
    WHERE b."companyId" = ${companyId} AND b."onHand" > 0 AND l."expiresOn" IS NOT NULL AND l."expiresOn" <= ${limite}::date
      ${filtroClase} ${filtroSucursal} ${busqueda}`

  const resumenFilas = await tx.$queryRaw<{ filas: number; lotes: number; vencidos: number; unidades: number; sinCosto: number; valor: Prisma.Decimal }[]>`
    SELECT COUNT(*)::int AS "filas",
           COUNT(DISTINCT l."id")::int AS "lotes",
           COUNT(DISTINCT l."id") FILTER (WHERE l."expiresOn" < ${hoy}::date)::int AS "vencidos",
           COALESCE(SUM(b."onHand" - b."reserved"), 0)::int AS "unidades",
           COALESCE(SUM(CASE WHEN ${costoSql} IS NULL THEN b."onHand" - b."reserved" ELSE 0 END), 0)::int AS "sinCosto",
           COALESCE(SUM((b."onHand" - b."reserved") * ${costoSql}), 0) AS "valor"
    ${desde}`
  const r = resumenFilas[0]
  const total = Number(r?.filas ?? 0)
  const porPagina = opciones.todas ? TOPE_FILAS_VENCIMIENTOS_CSV : FILAS_POR_PAGINA_VENCIMIENTOS
  const pagina = opciones.todas ? 1 : f.pagina

  const filasDb = await tx.$queryRaw<
    {
      saldoPorLoteId: string
      loteId: string
      codigo: string
      vencimiento: string
      varianteId: string
      itemId: string
      itemNombre: string
      varianteNombre: string
      esDefault: boolean
      sku: string
      sucursalId: string
      sucursalNombre: string
      sucursalActiva: boolean
      onHand: number
      reserved: number
      damaged: number
      costo: Prisma.Decimal | null
    }[]
  >`
    SELECT b."id" AS "saldoPorLoteId", l."id" AS "loteId", l."code" AS "codigo", l."expiresOn"::text AS "vencimiento",
           v."id" AS "varianteId", i."id" AS "itemId", i."name" AS "itemNombre", v."name" AS "varianteNombre", v."isDefault" AS "esDefault", v."sku",
           s."id" AS "sucursalId", s."nombre" AS "sucursalNombre", s."activa" AS "sucursalActiva",
           b."onHand", b."reserved", b."damaged", ${costoSql} AS "costo"
    ${desde}
    ORDER BY l."expiresOn" ASC, i."name", v."sku", l."code", s."nombre", b."id"
    LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`
  const filas: FilaVencimiento[] = filasDb.map((x) => {
    const costo = x.costo !== null ? costoDeDecimal(x.costo) : null
    const vendible = Math.max(0, Number(x.onHand) - Number(x.reserved))
    const diasRestantes = diasEntre(hoy, x.vencimiento)
    return {
      saldoPorLoteId: x.saldoPorLoteId,
      loteId: x.loteId,
      codigo: x.codigo,
      vencimiento: x.vencimiento,
      clase: claseDeVencimiento(x.vencimiento, hoy, f.dias) ?? 'POR_VENCER',
      urgencia: urgenciaDe(diasRestantes),
      diasRestantes,
      texto: textoVencimiento(x.vencimiento, hoy),
      varianteId: x.varianteId,
      itemId: x.itemId,
      nombre: nombreCompleto(x.itemNombre, x.varianteNombre, x.esDefault),
      sku: x.sku,
      sucursalId: x.sucursalId,
      sucursalNombre: x.sucursalNombre,
      sucursalActiva: x.sucursalActiva,
      vendible,
      apartado: Number(x.reserved),
      danado: Number(x.damaged),
      costo,
      valor: costo === null ? null : BigInt(vendible) * costo,
    }
  })
  return {
    dias: f.dias,
    hoy,
    filas,
    total,
    pagina,
    porPagina,
    resumen: {
      lotes: Number(r?.lotes ?? 0),
      lotesVencidos: Number(r?.vencidos ?? 0),
      unidades: Number(r?.unidades ?? 0),
      valor: opciones.conCostos ? costoDeDecimal(r?.valor ?? 0) : null,
      unidadesSinCosto: opciones.conCostos ? Number(r?.sinCosto ?? 0) : null,
    },
  }
}

/**
 * Lo que enseñan la tarjeta del dashboard y el aviso del barrido: cuántos lotes (distintos) vencen dentro de la ventana, cuántos de
 * ellos en `DIAS_URGENTE` días o menos, cuántos ya vencieron y siguen con existencias, y cuántas unidades vendibles hay en cada caso.
 * Es una sola consulta de agregados (nunca filas) y NO lee costos.
 */
export interface ResumenVencimientos {
  hoy: string
  dias: number
  /** ¿Algún producto de la empresa lleva lotes? Si no, no hay nada que vigilar y la tarjeta ni se ofrece. */
  llevaLotes: boolean
  porVencer: { lotes: number; urgentes: number; unidades: number }
  vencidos: { lotes: number; unidades: number }
}

export async function resumenVencimientosEnTx(tx: Tx, companyId: string, opciones: { zonaHoraria: string; dias?: number; ahora?: Date }): Promise<ResumenVencimientos> {
  const dias = opciones.dias ?? VENTANA_POR_DEFECTO
  const hoy = diaLocal(opciones.ahora ?? new Date(), opciones.zonaHoraria)
  const limite = limiteDeVentana(hoy, dias)
  const urgente = limiteDeVentana(hoy, DIAS_URGENTE)
  const lleva = await tx.inventoryLotTracking.findFirst({ where: { companyId }, select: { id: true } })
  if (!lleva) return { hoy, dias, llevaLotes: false, porVencer: { lotes: 0, urgentes: 0, unidades: 0 }, vencidos: { lotes: 0, unidades: 0 } }
  const filas = await tx.$queryRaw<{ porVencer: number; urgentes: number; unidadesPorVencer: number; vencidos: number; unidadesVencidas: number }[]>`
    SELECT COUNT(DISTINCT l."id") FILTER (WHERE l."expiresOn" >= ${hoy}::date)::int AS "porVencer",
           COUNT(DISTINCT l."id") FILTER (WHERE l."expiresOn" >= ${hoy}::date AND l."expiresOn" <= ${urgente}::date)::int AS "urgentes",
           COALESCE(SUM(b."onHand" - b."reserved") FILTER (WHERE l."expiresOn" >= ${hoy}::date), 0)::int AS "unidadesPorVencer",
           COUNT(DISTINCT l."id") FILTER (WHERE l."expiresOn" < ${hoy}::date)::int AS "vencidos",
           COALESCE(SUM(b."onHand" - b."reserved") FILTER (WHERE l."expiresOn" < ${hoy}::date), 0)::int AS "unidadesVencidas"
      FROM "inventory_lot_balances" b
      JOIN "inventory_lots" l ON l."id" = b."lotId" AND l."companyId" = b."companyId"
     WHERE b."companyId" = ${companyId} AND b."onHand" > 0 AND l."expiresOn" IS NOT NULL AND l."expiresOn" <= ${limite}::date`
  const r = filas[0]
  return {
    hoy,
    dias,
    llevaLotes: true,
    porVencer: { lotes: Number(r?.porVencer ?? 0), urgentes: Number(r?.urgentes ?? 0), unidades: Number(r?.unidadesPorVencer ?? 0) },
    vencidos: { lotes: Number(r?.vencidos ?? 0), unidades: Number(r?.unidadesVencidas ?? 0) },
  }
}
