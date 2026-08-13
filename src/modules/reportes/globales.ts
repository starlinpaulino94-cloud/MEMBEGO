import 'server-only'
import { Prisma } from '@prisma/client'
import { sinEmpresa, type Tx } from '@/lib/tenant'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { variacion, type Rango } from './rango'
import {
  ordenarEmpresas,
  totalPorMoneda,
  hayVariasMonedas,
  type FilaEmpresa,
  type FiltroGlobal,
} from './filtrosGlobales'

/**
 * REPORTE DE PLATAFORMA — todas las empresas, para el superadmin.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL Y POR QUÉ SE REESCRIBIÓ ENTERO
 *
 * El motor anterior (`getReportesGlobales`, en `modules/admin/queries.ts`) daba
 * cifras que no se podían defender:
 *
 *   · El TOTAL de ingresos fechaba los cobros por `fechaPago` y el DESGLOSE por
 *     empresa los fechaba por `updatedAt`. Las columnas no sumaban al total, y
 *     editar una membresía vieja la movía de mes solo en una de las dos. La
 *     regla correcta —`whereCobrado`— ya existía y estaba documentada tres
 *     pantallas más arriba en el mismo archivo.
 *   · «Por vencer (7 días)» era el `.length` de una lista con `take: 100`. Con
 *     400 membresías por vencer, la tarjeta decía 100. Aquí se cuenta.
 *   · El desglose por empresa salía de una lista global con `take: 500`: las
 *     empresas cuyos vencimientos caían más tarde aparecían vacías, exactamente
 *     igual que las que no tenían ninguna.
 *   · Las empresas de PRÁCTICA entraban en los totales de la plataforma,
 *     mientras el Resumen —el enlace de al lado en el mismo menú— las dejaba
 *     fuera. Dos cifras distintas del mismo periodo.
 *   · El mes se cortaba con `new Date(año, mes, 1)`, que es medianoche del
 *     SERVIDOR (UTC en Vercel). Un cobro del día 31 a las 9 de la noche en
 *     Santo Domingo caía en el mes siguiente. `rango.ts` existe para esto.
 *   · Un fallo de consulta dejaba la pantalla en ceros sin decirlo.
 *   · Abría SEIS transacciones a la vez (`Promise.all` de cinco `sinEmpresa`
 *     más la de `getReportesAdmin`): seis conexiones del pool retenidas en
 *     paralelo. No es una transacción anidada —la guardia no lo veía— pero es
 *     la misma familia de presión.
 *
 * Aquí todo va en UNA transacción, con la misma regla de fechado que el resto
 * del sistema, con el periodo que pida la pantalla y diciendo cuándo falla.
 */

/** Días de antelación de «por vencer». El mismo número que enseña la tarjeta. */
export const DIAS_POR_VENCER = 7

export interface KpiGlobal {
  valor: number
  anterior: number
  variacion: number | null
}

export interface ReporteGlobal {
  /** Ingresos cobrados en el periodo, separados por moneda. */
  ingresos: { moneda: string; total: number }[]
  /** Comparación del ingreso contra el periodo anterior (moneda principal). */
  ingresoPrincipal: KpiGlobal
  monedaPrincipal: string
  variasMonedas: boolean
  usos: KpiGlobal
  clientesNuevos: KpiGlobal
  /** Foto de hoy: no depende del periodo. */
  activas: number
  porVencer: number
  empresas: FilaEmpresa[]
  /** Empresas de práctica que quedaron fuera del recuento. */
  demosOcultas: number
  /** Alguna consulta falló: hay cifras que pueden estar en cero sin serlo. */
  incompleto: boolean
}

interface EmpresaFila {
  id: string
  name: string
  moneda: string
  esDemo: boolean
}

/**
 * Empresas con su moneda y su condición de práctica.
 *
 * Doble forma por lo mismo que en `superadmin/panel.ts`: `esDemo` puede no
 * estar migrada todavía, y el reporte no puede quedarse en blanco por eso. Sin
 * la columna, la verdad es que aún no hay empresas de práctica.
 */
async function leerEmpresas(tx: Tx): Promise<EmpresaFila[]> {
  const base = { orderBy: { name: 'asc' } as const }
  try {
    return await tx.company.findMany({
      ...base,
      select: { id: true, name: true, moneda: true, esDemo: true },
    })
  } catch {
    const filas = await tx.company
      .findMany({ ...base, select: { id: true, name: true, moneda: true } })
      .catch(() => [] as { id: string; name: string; moneda: string }[])
    return filas.map((f) => ({ ...f, esDemo: false }))
  }
}

/** Envuelve una consulta para que un fallo no tumbe el reporte entero. */
async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes-globales]', e)
    fallos.n++
    return porDefecto
  }
}

/**
 * Usos (visitas) por empresa.
 *
 * SQL crudo porque `Visit` no tiene `companyId`: cuelga del cliente, y un
 * `groupBy` de Prisma no agrupa por un campo de la relación. Va acotado a las
 * empresas visibles para que las de práctica no se cuelen por aquí cuando el
 * resto ya las excluyó.
 */
async function usosPorEmpresa(
  tx: Tx,
  ids: string[],
  desde: Date,
  hasta: Date
): Promise<{ companyId: string; total: number }[]> {
  if (ids.length === 0) return []
  return tx.$queryRaw<{ companyId: string; total: number }[]>`
    SELECT c."companyId", COUNT(*)::int AS total
    FROM "visits" v
    JOIN "clientes" c ON c."id" = v."clienteId"
    WHERE v."fechaVisita" >= ${desde}
      AND v."fechaVisita" < ${hasta}
      AND c."companyId" IN (${Prisma.join(ids)})
    GROUP BY c."companyId"
  `
}

export async function getReporteGlobal(
  rango: Rango,
  filtro: FiltroGlobal,
  ahora: Date = new Date()
): Promise<ReporteGlobal> {
  const fallos = { n: 0 }
  const hastaVencer = new Date(ahora.getTime() + DIAS_POR_VENCER * 86_400_000)

  return sinEmpresa(
    'reportes de plataforma: los totales cruzan todas las empresas por diseño',
    async (tx) => {
      const todas = await seguro(leerEmpresas(tx), [] as EmpresaFila[], fallos)
      const demosOcultas = filtro.incluirDemo ? 0 : todas.filter((e) => e.esDemo).length
      // El alcance se decide UNA vez y lo heredan todas las agregaciones: así
      // el total y el desglose no pueden discrepar sobre qué empresas cuentan.
      const visibles = filtro.incluirDemo ? todas : todas.filter((e) => !e.esDemo)
      const ids = visibles.map((e) => e.id)

      if (ids.length === 0) {
        return vacio(fallos.n > 0, demosOcultas)
      }

      const soloVisibles = { companyId: { in: ids } }
      const vacioNum = 0

      const [
        ingresos,
        ingresoAnterior,
        activas,
        porVencer,
        usos,
        usosAnterior,
        nuevos,
        nuevosAnterior,
      ] = await Promise.all([
        // MISMA regla que el total del resto del sistema. Era el fallo central.
        seguro(
          tx.membership.groupBy({
            by: ['companyId'],
            where: whereCobrado(rango.desde, rango.hasta, soloVisibles),
            _sum: { montoPagado: true },
          }),
          [] as { companyId: string; _sum: { montoPagado: Prisma.Decimal | null } }[],
          fallos
        ),
        seguro(
          tx.membership
            .aggregate({
              where: whereCobrado(rango.anterior.desde, rango.anterior.hasta, soloVisibles),
              _sum: { montoPagado: true },
            })
            .then((a) => Number(a._sum.montoPagado ?? 0)),
          vacioNum,
          fallos
        ),
        seguro(
          tx.membership.groupBy({
            by: ['companyId'],
            where: { ...soloVisibles, ...membresiaVigente(ahora) },
            _count: { _all: true },
          }),
          [] as { companyId: string; _count: { _all: number } }[],
          fallos
        ),
        // CONTAR, no medir una lista recortada. La tarjeta enseñaba el
        // `.length` de un `findMany` con `take: 100`.
        seguro(
          tx.membership.groupBy({
            by: ['companyId'],
            where: {
              ...soloVisibles,
              estado: 'ACTIVA',
              fechaVencimiento: { gte: ahora, lte: hastaVencer },
            },
            _count: { _all: true },
          }),
          [] as { companyId: string; _count: { _all: number } }[],
          fallos
        ),
        seguro(usosPorEmpresa(tx, ids, rango.desde, rango.hasta), [], fallos),
        seguro(
          tx.visit.count({
            where: {
              cliente: soloVisibles,
              fechaVisita: { gte: rango.anterior.desde, lt: rango.anterior.hasta },
            },
          }),
          vacioNum,
          fallos
        ),
        seguro(
          tx.cliente.count({
            where: { ...soloVisibles, createdAt: { gte: rango.desde, lt: rango.hasta } },
          }),
          vacioNum,
          fallos
        ),
        seguro(
          tx.cliente.count({
            where: {
              ...soloVisibles,
              createdAt: { gte: rango.anterior.desde, lt: rango.anterior.hasta },
            },
          }),
          vacioNum,
          fallos
        ),
      ])

      const ingresoDe = new Map(
        ingresos.map((g) => [g.companyId, Number(g._sum.montoPagado ?? 0)])
      )
      const activasDe = new Map(activas.map((g) => [g.companyId, g._count._all]))
      const porVencerDe = new Map(porVencer.map((g) => [g.companyId, g._count._all]))
      const usosDe = new Map(usos.map((r) => [r.companyId, r.total]))

      const filas: FilaEmpresa[] = visibles.map((e) => ({
        companyId: e.id,
        nombre: e.name,
        moneda: e.moneda,
        esDemo: e.esDemo,
        ingresos: ingresoDe.get(e.id) ?? 0,
        activas: activasDe.get(e.id) ?? 0,
        usos: usosDe.get(e.id) ?? 0,
        porVencer: porVencerDe.get(e.id) ?? 0,
      }))

      const porMoneda = totalPorMoneda(filas)
      const principal = porMoneda[0] ?? { moneda: 'DOP', total: 0 }
      const usosTotal = filas.reduce((s, f) => s + f.usos, 0)

      return {
        ingresos: porMoneda,
        ingresoPrincipal: {
          valor: principal.total,
          anterior: ingresoAnterior,
          variacion: variacion(principal.total, ingresoAnterior),
        },
        monedaPrincipal: principal.moneda,
        variasMonedas: hayVariasMonedas(filas),
        usos: { valor: usosTotal, anterior: usosAnterior, variacion: variacion(usosTotal, usosAnterior) },
        clientesNuevos: {
          valor: nuevos,
          anterior: nuevosAnterior,
          variacion: variacion(nuevos, nuevosAnterior),
        },
        activas: filas.reduce((s, f) => s + f.activas, 0),
        porVencer: filas.reduce((s, f) => s + f.porVencer, 0),
        // El orden y la búsqueda se aplican al final, sobre las filas ya
        // agregadas: los TOTALES no pueden depender de lo que se busque.
        empresas: ordenarEmpresas(filas, filtro),
        demosOcultas,
        incompleto: fallos.n > 0,
      }
    }
  )
}

function vacio(incompleto: boolean, demosOcultas: number): ReporteGlobal {
  const cero = { valor: 0, anterior: 0, variacion: null }
  return {
    ingresos: [],
    ingresoPrincipal: cero,
    monedaPrincipal: 'DOP',
    variasMonedas: false,
    usos: cero,
    clientesNuevos: cero,
    activas: 0,
    porVencer: 0,
    empresas: [],
    demosOcultas,
    incompleto,
  }
}
