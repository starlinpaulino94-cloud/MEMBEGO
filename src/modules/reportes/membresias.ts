import 'server-only'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { variacion, diasDelRango, type Rango } from '@/modules/reportes/rango'
import {
  clasificarCambioPlan,
  tasaRenovacion,
  type ClaseCambioPlan,
} from '@/modules/membresia/eventosNucleo'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * CICLO DE VIDA DE LAS MEMBRESÍAS — el reporte que antes no se podía hacer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN ESTOS NÚMEROS
 *
 * De `membresia_eventos`, no del estado de las membresías. Es la diferencia
 * entera: el estado dice cómo está una membresía HOY, y con eso no se puede
 * responder «cuántas se renovaron en agosto» —una membresía renovada tres
 * veces sigue siendo una fila ACTIVA—. Los eventos sí: cada renovación es un
 * hecho con su fecha.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CORTE DE DATOS SE ENSEÑA, NO SE DISIMULA
 *
 * Los eventos empezaron a escribirse el día de su migración. Antes de esa
 * fecha solo existe lo que se pudo reconstruir de la bitácora —renovaciones y
 * cancelaciones—, y ni siquiera todo: los vencimientos automáticos iban
 * agrupados por empresa y no se pudieron recuperar fila a fila.
 *
 * Por eso el reporte devuelve `corte`, y la pantalla lo pinta. Un reporte que
 * enseña «3 activaciones» en un mes anterior al corte no está diciendo que
 * hubo tres: está diciendo que encontró tres, que es otra cosa. Sin ese aviso,
 * alguien compara agosto con octubre y concluye que el negocio se hundió.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO SE CUENTA EN LA BASE
 *
 * `groupBy` y `count`, nunca `findMany(...).length`. Es la tercera regla de
 * `docs/REPORTES.md` y aquí importa el doble: esta tabla crece con cada
 * renovación de cada membresía de cada empresa.
 */

type Tx = Prisma.TransactionClient

export interface CambiosDePlan {
  subida: number
  bajada: number
  lateral: number
  /** Sin los dos precios guardados no se puede clasificar. No es «lateral». */
  desconocido: number
}

export interface PuntoCicloVida {
  dia: string
  activadas: number
  renovadas: number
  bajas: number
}

export interface ReporteMembresias {
  activadas: Kpi
  renovadas: Kpi
  /** De las renovadas, cuántas las cobró el cron con la tarjeta guardada. */
  renovadasAutomaticas: number
  canceladas: Kpi
  vencidas: Kpi
  cambiosDePlan: CambiosDePlan
  /**
   * Renovadas ÷ (renovadas + bajas). `null` cuando no hubo ninguna de las dos:
   * una tasa sin base no es 0 %, es «sin dato». Enseñar 0 % porque no venció
   * nada sería decir algo falso.
   */
  tasaRenovacion: number | null
  serie: PuntoCicloVida[]
  porPlan: { plan: string; activadas: number; renovadas: number; bajas: number }[]
  motivos: { motivo: string; total: number }[]
  corte: CorteDeDatos
  incompleto: boolean
}

export interface CorteDeDatos {
  /** Primer evento escrito por el camino normal. Null = todavía ninguno. */
  desdeDia: string | null
  /** Hay filas del backfill: parte del periodo es de segunda mano. */
  hayReconstruidos: boolean
  /** El rango pedido empieza antes de que el dato fuera de primera mano. */
  rangoIncompleto: boolean
}

const BAJAS = ['CANCELADA', 'VENCIDA'] as const

function enRango(companyId: string, rango: { desde: Date; hasta: Date }): Prisma.MembresiaEventoWhereInput {
  return { companyId, ocurridoEn: { gte: rango.desde, lt: rango.hasta } }
}

async function contarPorTipo(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<Record<string, number>> {
  const filas = await tx.membresiaEvento.groupBy({
    by: ['tipo'],
    where: enRango(companyId, rango),
    _count: { _all: true },
  })
  const out: Record<string, number> = {}
  for (const f of filas) out[f.tipo] = f._count._all
  return out
}

/**
 * Subidas, bajadas y laterales.
 *
 * Se leen los precios GUARDADOS en el evento, nunca los del plan hoy: un plan
 * que suba de tarifa mañana convertiría retroactivamente en bajadas los
 * cambios que fueron subidas.
 *
 * Aquí sí se traen filas en vez de agregar en SQL, y es una excepción
 * consciente: la clasificación compara dos columnas entre sí, que en Prisma no
 * se puede expresar en un `groupBy`. Los cambios de plan son el evento más
 * raro de todos —una empresa tiene cientos al año, no millones—, así que el
 * coste es real pero acotado, y va con su tope.
 */
async function clasificarCambios(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<CambiosDePlan> {
  const filas = await tx.membresiaEvento.findMany({
    where: { ...enRango(companyId, rango), tipo: 'CAMBIO_PLAN' },
    select: { precioAnterior: true, precioNuevo: true },
    take: 5000,
  })
  const out: CambiosDePlan = { subida: 0, bajada: 0, lateral: 0, desconocido: 0 }
  for (const f of filas) {
    const clase: ClaseCambioPlan = clasificarCambioPlan(
      f.precioAnterior == null ? null : Number(f.precioAnterior),
      f.precioNuevo == null ? null : Number(f.precioNuevo)
    )
    if (clase === 'SUBIDA') out.subida++
    else if (clase === 'BAJADA') out.bajada++
    else if (clase === 'LATERAL') out.lateral++
    else out.desconocido++
  }
  return out
}

async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoCicloVida[]> {
  // El corte por día se hace en la BASE y en la zona del negocio: agrupar en
  // JavaScript obligaría a traer una fila por evento, y `AT TIME ZONE` es lo
  // que evita que un lavado de las 9 de la noche caiga en el día siguiente.
  const filas = await tx.$queryRaw<{ dia: string; tipo: string; total: bigint }[]>`
    SELECT to_char(("ocurridoEn" AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS dia,
           tipo::text AS tipo,
           count(*) AS total
      FROM membresia_eventos
     WHERE "companyId" = ${companyId}
       AND "ocurridoEn" >= ${rango.desde}
       AND "ocurridoEn" <  ${rango.hasta}
     GROUP BY 1, 2
  `
  const porDia = new Map<string, PuntoCicloVida>()
  for (const dia of diasDelRango(rango)) {
    porDia.set(dia, { dia, activadas: 0, renovadas: 0, bajas: 0 })
  }
  for (const f of filas) {
    const punto = porDia.get(f.dia)
    if (!punto) continue
    const n = Number(f.total)
    if (f.tipo === 'ACTIVADA') punto.activadas += n
    else if (f.tipo === 'RENOVADA') punto.renovadas += n
    else if (f.tipo === 'CANCELADA' || f.tipo === 'VENCIDA') punto.bajas += n
  }
  return [...porDia.values()]
}

async function porPlan(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<{ plan: string; activadas: number; renovadas: number; bajas: number }[]> {
  const filas = await tx.membresiaEvento.groupBy({
    by: ['planAnteriorId', 'tipo'],
    where: { ...enRango(companyId, rango), planAnteriorId: { not: null } },
    _count: { _all: true },
  })
  const ids = [...new Set(filas.map((f) => f.planAnteriorId).filter((v): v is string => v != null))]
  const planes = await tx.plan.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, nombre: true },
  })
  const nombre = new Map(planes.map((p) => [p.id, p.nombre]))

  const acc = new Map<string, { plan: string; activadas: number; renovadas: number; bajas: number }>()
  for (const f of filas) {
    const id = f.planAnteriorId!
    // Un plan borrado deja eventos huérfanos. Se enseñan como «(plan
    // eliminado)» en vez de desaparecer: si no, los subtotales dejarían de
    // sumar el total y nadie sabría por qué.
    const clave = nombre.get(id) ?? '(plan eliminado)'
    const fila = acc.get(clave) ?? { plan: clave, activadas: 0, renovadas: 0, bajas: 0 }
    const n = f._count._all
    if (f.tipo === 'ACTIVADA') fila.activadas += n
    else if (f.tipo === 'RENOVADA') fila.renovadas += n
    else if (BAJAS.includes(f.tipo as (typeof BAJAS)[number])) fila.bajas += n
    acc.set(clave, fila)
  }
  return [...acc.values()].sort((a, b) => b.renovadas + b.activadas - (a.renovadas + a.activadas))
}

async function motivosDeCancelacion(
  tx: Tx,
  companyId: string,
  rango: { desde: Date; hasta: Date }
): Promise<{ motivo: string; total: number }[]> {
  const filas = await tx.membresiaEvento.groupBy({
    by: ['motivo'],
    where: { ...enRango(companyId, rango), tipo: 'CANCELADA', motivo: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { motivo: 'desc' } },
    take: 20,
  })
  return filas
    .filter((f) => f.motivo)
    .map((f) => ({ motivo: f.motivo as string, total: f._count._all }))
}

async function calcularCorte(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<CorteDeDatos> {
  const [primeroReal, algunReconstruido] = await Promise.all([
    tx.membresiaEvento.findFirst({
      where: { companyId, reconstruido: false },
      orderBy: { ocurridoEn: 'asc' },
      select: { ocurridoEn: true },
    }),
    tx.membresiaEvento.findFirst({
      where: { companyId, reconstruido: true },
      select: { id: true },
    }),
  ])

  const desdeDia = primeroReal
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(primeroReal.ocurridoEn)
    : null

  return {
    desdeDia,
    hayReconstruidos: algunReconstruido != null,
    // Sin ningún evento propio, TODO el rango está por debajo del corte.
    rangoIncompleto: desdeDia == null || rango.desdeDia < desdeDia,
  }
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/membresias]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporteMembresias(
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<ReporteMembresias> {
  const fallos = { n: 0 }
  const vacio: Record<string, number> = {}

  const [actual, anterior, automaticas, cambios, serie, planes, motivos, corte] =
    await conEmpresa(companyId, (tx) =>
      Promise.all([
        seguro(contarPorTipo(tx, companyId, rango), vacio, fallos),
        seguro(contarPorTipo(tx, companyId, rango.anterior), vacio, fallos),
        seguro(
          tx.membresiaEvento.count({
            where: { ...enRango(companyId, rango), tipo: 'RENOVADA', origen: 'CRON' },
          }),
          0,
          fallos
        ),
        seguro(clasificarCambios(tx, companyId, rango), {
          subida: 0,
          bajada: 0,
          lateral: 0,
          desconocido: 0,
        }, fallos),
        seguro(serieDiaria(tx, companyId, rango, timeZone), [] as PuntoCicloVida[], fallos),
        seguro(porPlan(tx, companyId, rango), [], fallos),
        seguro(motivosDeCancelacion(tx, companyId, rango), [], fallos),
        seguro(calcularCorte(tx, companyId, rango, timeZone), {
          desdeDia: null,
          hayReconstruidos: false,
          rangoIncompleto: true,
        }, fallos),
      ])
    )

  const renovadas = actual.RENOVADA ?? 0
  const bajas = (actual.CANCELADA ?? 0) + (actual.VENCIDA ?? 0)

  return {
    activadas: kpi(actual.ACTIVADA ?? 0, anterior.ACTIVADA ?? 0),
    renovadas: kpi(renovadas, anterior.RENOVADA ?? 0),
    renovadasAutomaticas: automaticas,
    canceladas: kpi(actual.CANCELADA ?? 0, anterior.CANCELADA ?? 0),
    vencidas: kpi(actual.VENCIDA ?? 0, anterior.VENCIDA ?? 0),
    cambiosDePlan: cambios,
    tasaRenovacion: tasaRenovacion(renovadas, bajas),
    serie,
    porPlan: planes,
    motivos,
    corte,
    incompleto: fallos.n > 0,
  }
}
