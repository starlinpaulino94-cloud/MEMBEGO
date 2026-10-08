import { Prisma, type MembegoAttributionChannel, type MembegoOrderOrigin } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { diasDelRango, type Rango } from '@/modules/reportes/rango'
import {
  aNumero,
  completarSerie,
  costoPorClienteNuevo,
  embudo,
  kpi,
  porcentaje,
  retornoSobreCuota,
  ticketPromedio,
  tomaDeComision,
  type EmbudoDePedidos,
  type FilaDeOfertaAnalitica,
  type FilaPorCanal,
  type Kpi,
  type PuntoDeVentas,
} from './domain'

/**
 * ANALÍTICA DE MEMBEGO · lecturas (Fase 6).
 *
 * SOLO LECTURA y sin tablas nuevas: todo se calcula en el momento sobre los pedidos
 * (`membego_orders`), su atribución, las comisiones de Merchant Billing y las ofertas. Es lo bastante
 * rápido para el volumen de hoy; si el volumen lo exigiera, la salida es una tabla de totales por
 * día, no cambiar las definiciones (ver `domain.ts`).
 *
 * DOS ALCANCES, una sola implementación:
 *  · una EMPRESA (`companyId`): corre en `conEmpresa(companyId, …)` y solo ve lo suyo;
 *  · la PLATAFORMA (`companyId = null`): corre en `sinEmpresa` y deja fuera las empresas de práctica
 *    (`esDemo`), igual que el resto de reportes de plataforma.
 *
 * SEPARACIÓN: este módulo no importa Supply ni sus finanzas. Los pedidos de Supply aparecen como el
 * origen `SUPPLY` de un pedido Membego (lo que son); la economía de Supply (Membego → proveedor) se
 * enseña aparte, desde su propio módulo, en la página que compone las dos cosas.
 *
 * El día se corta en la zona horaria de quien mira, con la conversión doble `UTC → zona` (las columnas
 * son `timestamp` sin zona y guardan UTC).
 */

export interface Alcance {
  companyId: string | null
}

type Origenes = 'MARKETPLACE' | 'TODOS'

const COMISIONABLE: MembegoOrderOrigin = 'MARKETPLACE'

/** Filtro de empresa sobre la columna `col` (una constante del código, nunca texto del usuario). */
function sqlAlcance(a: Alcance, col: string): Prisma.Sql {
  const c = Prisma.raw(col)
  return a.companyId
    ? Prisma.sql`AND ${c} = ${a.companyId}`
    : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "companies" dc WHERE dc."id" = ${c} AND dc."esDemo" = true)`
}

const sqlOrigen = (o: Origenes): Prisma.Sql => (o === 'MARKETPLACE' ? Prisma.sql`AND o."origin" = 'MARKETPLACE'` : Prisma.empty)

// ── Bloques ──────────────────────────────────────────────────────────────────

export interface Agregados {
  pedidos: number
  ventas: number
  comisiones: number
  clientes: number
  empresas: number
}

/** Pedidos completados en el periodo, sus ventas, las comisiones confirmadas de esos mismos pedidos y a cuántos clientes y empresas alcanzan. */
export async function agregadosEnTx(tx: Tx, a: Alcance, origenes: Origenes, desde: Date, hasta: Date): Promise<Agregados> {
  const [f] = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT count(*)::int AS pedidos,
           coalesce(sum(o."commissionableBase"), 0) AS ventas,
           coalesce(sum(m."amount") FILTER (WHERE m."status" = 'CONFIRMED'), 0) AS comisiones,
           count(DISTINCT o."customerId")::int AS clientes,
           count(DISTINCT o."companyId")::int AS empresas
      FROM "membego_orders" o
      LEFT JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE o."status" = 'COMPLETED'
       AND o."completedAt" >= ${desde} AND o."completedAt" < ${hasta}
       ${sqlOrigen(origenes)}
       ${sqlAlcance(a, 'o."companyId"')}`
  return { pedidos: aNumero(f?.pedidos), ventas: aNumero(f?.ventas), comisiones: aNumero(f?.comisiones), clientes: aNumero(f?.clientes), empresas: aNumero(f?.empresas) }
}

/**
 * De los clientes que completaron un pedido del marketplace en el periodo, cuántos NUNCA habían completado uno con esa empresa
 * —de cualquier origen: marketplace, caja o Supply—. Es la misma regla de «solo clientes nuevos» de las ofertas. Solo de una empresa.
 */
export async function clientesNuevosEnTx(tx: Tx, companyId: string, desde: Date, hasta: Date): Promise<{ total: number; nuevos: number }> {
  const [f] = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM "membego_orders" p
              WHERE p."companyId" = c."companyId" AND p."customerId" = c."customerId"
                AND p."status" IN ('COMPLETED', 'REFUNDED') AND p."completedAt" < ${desde}
           ))::int AS nuevos
      FROM (SELECT DISTINCT o."companyId", o."customerId"
              FROM "membego_orders" o
             WHERE o."companyId" = ${companyId} AND o."origin" = 'MARKETPLACE' AND o."status" = 'COMPLETED'
               AND o."completedAt" >= ${desde} AND o."completedAt" < ${hasta}) c`
  return { total: aNumero(f?.total), nuevos: aNumero(f?.nuevos) }
}

export async function reembolsosEnTx(tx: Tx, a: Alcance, origenes: Origenes, desde: Date, hasta: Date): Promise<{ pedidos: number; monto: number }> {
  const [f] = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT count(*)::int AS pedidos, coalesce(sum(o."commissionableBase"), 0) AS monto
      FROM "membego_orders" o
     WHERE o."status" = 'REFUNDED' AND o."refundedAt" >= ${desde} AND o."refundedAt" < ${hasta}
       ${sqlOrigen(origenes)} ${sqlAlcance(a, 'o."companyId"')}`
  return { pedidos: aNumero(f?.pedidos), monto: aNumero(f?.monto) }
}

export async function porCanalEnTx(tx: Tx, a: Alcance, origenes: Origenes, desde: Date, hasta: Date): Promise<FilaPorCanal[]> {
  const filas = await tx.$queryRaw<{ canal: string | null; pedidos: number; ventas: unknown }[]>`
    SELECT a."channel"::text AS canal, count(*)::int AS pedidos, coalesce(sum(o."commissionableBase"), 0) AS ventas
      FROM "membego_orders" o
      LEFT JOIN "order_attributions" a ON a."orderId" = o."id"
     WHERE o."status" = 'COMPLETED' AND o."completedAt" >= ${desde} AND o."completedAt" < ${hasta}
       ${sqlOrigen(origenes)} ${sqlAlcance(a, 'o."companyId"')}
     GROUP BY 1
     ORDER BY ventas DESC, canal`
  return filas.map((f) => ({ canal: (f.canal ?? 'SIN_ATRIBUCION') as MembegoAttributionChannel | 'SIN_ATRIBUCION', pedidos: aNumero(f.pedidos), ventas: aNumero(f.ventas) }))
}

export interface FilaPorOrigen {
  origen: MembegoOrderOrigin
  pedidos: number
  ventas: number
  comisiones: number
}

export async function porOrigenEnTx(tx: Tx, a: Alcance, desde: Date, hasta: Date): Promise<FilaPorOrigen[]> {
  const filas = await tx.$queryRaw<{ origen: string; pedidos: number; ventas: unknown; comisiones: unknown }[]>`
    SELECT o."origin"::text AS origen, count(*)::int AS pedidos, coalesce(sum(o."commissionableBase"), 0) AS ventas,
           coalesce(sum(m."amount") FILTER (WHERE m."status" = 'CONFIRMED'), 0) AS comisiones
      FROM "membego_orders" o
      LEFT JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE o."status" = 'COMPLETED' AND o."completedAt" >= ${desde} AND o."completedAt" < ${hasta}
       ${sqlAlcance(a, 'o."companyId"')}
     GROUP BY 1
     ORDER BY ventas DESC, origen`
  return filas.map((f) => ({ origen: f.origen as MembegoOrderOrigin, pedidos: aNumero(f.pedidos), ventas: aNumero(f.ventas), comisiones: aNumero(f.comisiones) }))
}

export async function serieEnTx(tx: Tx, a: Alcance, origenes: Origenes, rango: Rango, timeZone: string): Promise<PuntoDeVentas[]> {
  const filas = await tx.$queryRaw<{ dia: string; pedidos: number; ventas: unknown }[]>`
    SELECT to_char((o."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
           count(*)::int AS pedidos, coalesce(sum(o."commissionableBase"), 0) AS ventas
      FROM "membego_orders" o
     WHERE o."status" = 'COMPLETED' AND o."completedAt" >= ${rango.desde} AND o."completedAt" < ${rango.hasta}
       ${sqlOrigen(origenes)} ${sqlAlcance(a, 'o."companyId"')}
     GROUP BY 1`
  return completarSerie(diasDelRango(rango), filas.map((f) => ({ dia: f.dia, pedidos: aNumero(f.pedidos), ventas: aNumero(f.ventas) })))
}

/** Los pedidos CREADOS en el periodo y cómo van: cuántos se completaron, cuántos se cayeron, cuántos siguen abiertos. */
export async function embudoEnTx(tx: Tx, a: Alcance, origenes: Origenes, desde: Date, hasta: Date): Promise<EmbudoDePedidos> {
  const filas = await tx.$queryRaw<{ estado: string; n: number }[]>`
    SELECT o."status"::text AS estado, count(*)::int AS n
      FROM "membego_orders" o
     WHERE o."createdAt" >= ${desde} AND o."createdAt" < ${hasta}
       ${sqlOrigen(origenes)} ${sqlAlcance(a, 'o."companyId"')}
     GROUP BY 1`
  const n = (e: string) => aNumero(filas.find((f) => f.estado === e)?.n)
  const creados = filas.reduce((t, f) => t + aNumero(f.n), 0)
  return embudo(creados, n('COMPLETED'), n('CANCELLED'), n('REFUNDED'))
}

/** Las ofertas con presupuesto que se OBTUVIERON en el periodo y lo que dejaron. */
export async function ofertasEnTx(tx: Tx, a: Alcance, desde: Date, hasta: Date, limite: number): Promise<(FilaDeOfertaAnalitica & { empresa: string })[]> {
  const filas = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT d."id", d."title" AS titulo, d."status"::text AS estado, co."name" AS empresa,
           count(c."id")::int AS obtenidas,
           (count(c."id") FILTER (WHERE c."status" = 'REDEEMED'))::int AS canjeadas,
           coalesce(sum(o."commissionableBase") FILTER (WHERE c."status" = 'REDEEMED'), 0) AS ventas,
           coalesce(sum(c."savings") FILTER (WHERE c."status" = 'REDEEMED'), 0) AS ahorro,
           coalesce(sum(m."amount") FILTER (WHERE c."status" = 'REDEEMED' AND m."status" = 'CONFIRMED'), 0) AS cuota
      FROM "deals" d
      JOIN "companies" co ON co."id" = d."companyId"
      JOIN "deal_claims" c ON c."dealId" = d."id" AND c."claimedAt" >= ${desde} AND c."claimedAt" < ${hasta}
      JOIN "membego_orders" o ON o."id" = c."orderId"
      LEFT JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE true ${sqlAlcance(a, 'd."companyId"')}
     GROUP BY d."id", d."title", d."status", co."name"
     ORDER BY ventas DESC, d."id"
     LIMIT ${limite}`
  return filas.map((f) => {
    const obtenidas = aNumero(f.obtenidas)
    const canjeadas = aNumero(f.canjeadas)
    const ventas = aNumero(f.ventas)
    const cuota = aNumero(f.cuota)
    return {
      id: String(f.id),
      titulo: String(f.titulo),
      estado: String(f.estado),
      empresa: String(f.empresa),
      obtenidas,
      canjeadas,
      conversion: porcentaje(canjeadas, obtenidas),
      ventas,
      ahorro: aNumero(f.ahorro),
      cuota,
      retorno: retornoSobreCuota(ventas, cuota),
    }
  })
}

/** Los totales de las ofertas obtenidas en el periodo (no la suma de una lista recortada). */
export async function totalesDeOfertasEnTx(tx: Tx, a: Alcance, desde: Date, hasta: Date): Promise<{ obtenidas: number; canjeadas: number; ventas: number; cuota: number }> {
  const [f] = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT count(c."id")::int AS obtenidas,
           (count(c."id") FILTER (WHERE c."status" = 'REDEEMED'))::int AS canjeadas,
           coalesce(sum(o."commissionableBase") FILTER (WHERE c."status" = 'REDEEMED'), 0) AS ventas,
           coalesce(sum(m."amount") FILTER (WHERE c."status" = 'REDEEMED' AND m."status" = 'CONFIRMED'), 0) AS cuota
      FROM "deal_claims" c
      JOIN "membego_orders" o ON o."id" = c."orderId"
      LEFT JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE c."claimedAt" >= ${desde} AND c."claimedAt" < ${hasta} ${sqlAlcance(a, 'c."companyId"')}`
  return { obtenidas: aNumero(f?.obtenidas), canjeadas: aNumero(f?.canjeadas), ventas: aNumero(f?.ventas), cuota: aNumero(f?.cuota) }
}

// ── Para la empresa ──────────────────────────────────────────────────────────

export interface ResultadosDeMembego {
  pedidos: Kpi
  ventas: Kpi
  ticket: Kpi
  clientes: Kpi
  clientesNuevos: Kpi
  /** Lo pagado a Membego por esos pedidos (comisiones confirmadas). */
  comisiones: Kpi
  /** Ventas por cada peso pagado a Membego, o `null` si no se pagó nada. */
  retorno: { valor: number | null; anterior: number | null }
  /** Lo pagado por cada cliente nuevo. */
  costoPorClienteNuevo: { valor: number | null; anterior: number | null }
  reembolsos: { pedidos: number; monto: number }
  porCanal: FilaPorCanal[]
  serie: PuntoDeVentas[]
  embudo: EmbudoDePedidos
  ofertas: (FilaDeOfertaAnalitica & { empresa: string })[]
}

/** «Membego te produjo X clientes, Y pedidos, Z en ventas» y lo que te costó. Solo pedidos del marketplace. */
export async function resultadosDeMembegoEnTx(tx: Tx, companyId: string, rango: Rango, timeZone: string): Promise<ResultadosDeMembego> {
  const a: Alcance = { companyId }
  const { desde, hasta, anterior } = rango
  const [actual, previo, nuevos, nuevosPrevio, reembolsos, porCanal, serie, emb, ofertas] = await Promise.all([
    agregadosEnTx(tx, a, 'MARKETPLACE', desde, hasta),
    agregadosEnTx(tx, a, 'MARKETPLACE', anterior.desde, anterior.hasta),
    clientesNuevosEnTx(tx, companyId, desde, hasta),
    clientesNuevosEnTx(tx, companyId, anterior.desde, anterior.hasta),
    reembolsosEnTx(tx, a, 'MARKETPLACE', desde, hasta),
    porCanalEnTx(tx, a, 'MARKETPLACE', desde, hasta),
    serieEnTx(tx, a, 'MARKETPLACE', rango, timeZone),
    embudoEnTx(tx, a, 'MARKETPLACE', desde, hasta),
    ofertasEnTx(tx, a, desde, hasta, 50),
  ])
  return {
    pedidos: kpi(actual.pedidos, previo.pedidos),
    ventas: kpi(actual.ventas, previo.ventas),
    ticket: kpi(ticketPromedio(actual.ventas, actual.pedidos), ticketPromedio(previo.ventas, previo.pedidos)),
    clientes: kpi(nuevos.total, nuevosPrevio.total),
    clientesNuevos: kpi(nuevos.nuevos, nuevosPrevio.nuevos),
    comisiones: kpi(actual.comisiones, previo.comisiones),
    retorno: { valor: retornoSobreCuota(actual.ventas, actual.comisiones), anterior: retornoSobreCuota(previo.ventas, previo.comisiones) },
    costoPorClienteNuevo: { valor: costoPorClienteNuevo(actual.comisiones, nuevos.nuevos), anterior: costoPorClienteNuevo(previo.comisiones, nuevosPrevio.nuevos) },
    reembolsos,
    porCanal,
    serie,
    embudo: emb,
    ofertas,
  }
}

// ── Para la plataforma ───────────────────────────────────────────────────────

export interface FilaEmpresaTop {
  id: string
  nombre: string
  pedidos: number
  ventas: number
  comisiones: number
  toma: number | null
}

export interface PanoramaDePlataforma {
  /** Todos los orígenes: lo que valieron los pedidos Membego completados. */
  gmv: Kpi
  pedidos: Kpi
  ticket: Kpi
  /** Empresas con al menos un pedido completado en el periodo. */
  empresasActivas: Kpi
  /** Comisiones confirmadas del marketplace (lo único que comisiona). */
  comisiones: Kpi
  /** GMV de los pedidos que sí comisionan (marketplace): el denominador de la toma. */
  gmvComisionable: Kpi
  toma: { valor: number | null; anterior: number | null }
  reembolsos: { pedidos: number; monto: number }
  porOrigen: FilaPorOrigen[]
  porCanal: FilaPorCanal[]
  serie: PuntoDeVentas[]
  embudo: EmbudoDePedidos
  topEmpresas: FilaEmpresaTop[]
  ofertas: {
    obtenidas: number
    canjeadas: number
    ventas: number
    cuota: number
    activas: number
    top: (FilaDeOfertaAnalitica & { empresa: string })[]
  }
  cuentas: { activas: number; enGracia: number; suspendidas: number }
  busquedas: { total: number; sinResultados: number }
}

export async function panoramaDePlataformaEnTx(tx: Tx, rango: Rango, timeZone: string): Promise<PanoramaDePlataforma> {
  const a: Alcance = { companyId: null }
  const { desde, hasta, anterior } = rango
  const [todo, todoPrevio, mk, mkPrevio, reembolsos, porOrigen, porCanal, serie, emb, top, ofertas, totalOfertas, activas, cuentas, busquedas] = await Promise.all([
    agregadosEnTx(tx, a, 'TODOS', desde, hasta),
    agregadosEnTx(tx, a, 'TODOS', anterior.desde, anterior.hasta),
    agregadosEnTx(tx, a, 'MARKETPLACE', desde, hasta),
    agregadosEnTx(tx, a, 'MARKETPLACE', anterior.desde, anterior.hasta),
    reembolsosEnTx(tx, a, 'TODOS', desde, hasta),
    porOrigenEnTx(tx, a, desde, hasta),
    porCanalEnTx(tx, a, 'TODOS', desde, hasta),
    serieEnTx(tx, a, 'TODOS', rango, timeZone),
    embudoEnTx(tx, a, 'TODOS', desde, hasta),
    topEmpresasEnTx(tx, desde, hasta, 15),
    ofertasEnTx(tx, a, desde, hasta, 10),
    totalesDeOfertasEnTx(tx, a, desde, hasta),
    tx.deal.count({ where: { status: 'ACTIVE', company: { esDemo: false } } }),
    tx.merchantBillingConfig.groupBy({ by: ['status'], where: { company: { esDemo: false } }, _count: { _all: true } }),
    tx.locationSearchEvent.aggregate({ where: { createdAt: { gte: desde, lt: hasta } }, _count: { _all: true } }),
  ])
  const sinResultados = await tx.locationSearchEvent.count({ where: { createdAt: { gte: desde, lt: hasta }, resultCount: 0 } })
  const cuenta = (e: string) => cuentas.find((c) => c.status === e)?._count._all ?? 0
  return {
    gmv: kpi(todo.ventas, todoPrevio.ventas),
    pedidos: kpi(todo.pedidos, todoPrevio.pedidos),
    ticket: kpi(ticketPromedio(todo.ventas, todo.pedidos), ticketPromedio(todoPrevio.ventas, todoPrevio.pedidos)),
    empresasActivas: kpi(todo.empresas, todoPrevio.empresas),
    comisiones: kpi(mk.comisiones, mkPrevio.comisiones),
    gmvComisionable: kpi(mk.ventas, mkPrevio.ventas),
    toma: { valor: tomaDeComision(mk.comisiones, mk.ventas), anterior: tomaDeComision(mkPrevio.comisiones, mkPrevio.ventas) },
    reembolsos,
    porOrigen,
    porCanal,
    serie,
    embudo: emb,
    topEmpresas: top,
    ofertas: { ...totalOfertas, activas, top: ofertas },
    cuentas: { activas: cuenta('ACTIVE'), enGracia: cuenta('GRACE_PERIOD'), suspendidas: cuenta('SUSPENDED') },
    busquedas: { total: busquedas._count._all, sinResultados },
  }
}

async function topEmpresasEnTx(tx: Tx, desde: Date, hasta: Date, limite: number): Promise<FilaEmpresaTop[]> {
  const filas = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT co."id", co."name" AS nombre, count(*)::int AS pedidos, coalesce(sum(o."commissionableBase"), 0) AS ventas,
           coalesce(sum(m."amount") FILTER (WHERE m."status" = 'CONFIRMED'), 0) AS comisiones,
           coalesce(sum(o."commissionableBase") FILTER (WHERE o."origin" = ${COMISIONABLE}::"MembegoOrderOrigin"), 0) AS ventas_comisionables
      FROM "membego_orders" o
      JOIN "companies" co ON co."id" = o."companyId"
      LEFT JOIN "merchant_commissions" m ON m."orderId" = o."id"
     WHERE o."status" = 'COMPLETED' AND o."completedAt" >= ${desde} AND o."completedAt" < ${hasta} AND co."esDemo" = false
     GROUP BY co."id", co."name"
     ORDER BY ventas DESC, co."id"
     LIMIT ${limite}`
  return filas.map((f) => {
    const comisiones = aNumero(f.comisiones)
    return { id: String(f.id), nombre: String(f.nombre), pedidos: aNumero(f.pedidos), ventas: aNumero(f.ventas), comisiones, toma: tomaDeComision(comisiones, aNumero(f.ventas_comisionables)) }
  })
}
