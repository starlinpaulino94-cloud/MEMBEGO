import 'server-only'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { variacion, type Rango } from '@/modules/reportes/rango'
import type { Kpi } from '@/modules/reportes/queries'

/**
 * FINANZAS — lo que entró, y lo que solo parece que entró.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS FLUJOS, NUNCA UNA SOLA CIFRA
 *
 * El negocio cobra por dos caminos: el mostrador (`Transaction`) y las
 * membresías (`Membership.montoPagado`). Sumarlos en un número único hace
 * imposible cuadrar el reporte contra la caja del día, que es la comprobación
 * que de verdad se hace. Se enseñan separados y, cuando hace falta el total,
 * con los dos sumandos al lado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COBRADO NO ES LO MISMO QUE PROYECTADO, Y AQUÍ NO SE MEZCLAN
 *
 * `docs/auditoria-clientes-membresias.md` (A-2) documenta el fallo que este
 * reporte no repite: el Resumen enseñaba «Ingresos estimados» multiplicando el
 * PRECIO DE LISTA de cada plan por sus membresías activas. Eso no es una caja,
 * es un catálogo — ignora el precio por categoría de vehículo, ignora lo que el
 * cliente pagó de verdad, y arrastra las membresías vencidas que nadie
 * desactivó.
 *
 * Aquí el recurrente estimado sale de `montoPagado`: lo que cada cliente pagó
 * REALMENTE, normalizado a 30 días, y solo de las membresías VIGENTES. Sigue
 * siendo una estimación —nadie garantiza que renueven— y por eso va en su
 * propia sección, rotulada, nunca en la misma columna que el dinero cobrado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO DOS ESTADOS SON DINERO
 *
 * `Transaction.estado` tiene ocho valores. `APPROVED` y `APPLIED` son cobros;
 * `PENDING` es una intención, y sumarla a un ingreso es contar dinero que
 * todavía no existe. `CANCELLED` y `REVERTED` van aparte, porque un negocio
 * que anula mucho tiene un problema que el total esconde.
 */

type Tx = Prisma.TransactionClient

/** Los únicos estados que significan que el dinero entró. */
const COBRADOS = ['APPROVED', 'APPLIED'] as const
/** Deshechos. No restan del ingreso: se cuentan aparte y se miran. */
const DESHECHOS = ['CANCELLED', 'REVERTED'] as const

export interface ReporteFinanzas {
  ingresosCaja: Kpi
  cobrosMembresias: Kpi
  /** Los dos sumados. Se ofrece, pero nunca sustituye a los sumandos. */
  ingresoTotal: Kpi
  operacionesCobradas: Kpi
  porMetodo: { metodo: string; operaciones: number; monto: number }[]
  intentos: { estado: string; total: number; monto: number }[]
  /** Aprobados ÷ (aprobados + rechazados). `null` = no hubo intentos cerrados. */
  tasaAprobacion: number | null
  motivosRechazo: { motivo: string; total: number }[]
  cobradoSinEntregar: { total: number; monto: number }
  deshechas: { total: number; monto: number }
  descuentos: number
  /** ESTIMACIÓN, no caja. Ver la cabecera del módulo. */
  recurrenteEstimado: { monto: number; membresias: number }
  incompleto: boolean
}

function whereCobros(companyId: string, desde: Date, hasta: Date): Prisma.TransactionWhereInput {
  return {
    companyId,
    estado: { in: [...COBRADOS] },
    createdAt: { gte: desde, lt: hasta },
  }
}

async function sumarCaja(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ monto: number; operaciones: number }> {
  const agg = await tx.transaction.aggregate({
    where: whereCobros(companyId, desde, hasta),
    _sum: { monto: true },
    _count: { _all: true },
  })
  return { monto: Number(agg._sum.monto ?? 0), operaciones: agg._count._all }
}

async function sumarMembresias(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<number> {
  // `whereCobrado` es la única puerta para fechar un cobro: `fechaPago`, con
  // respaldo a `updatedAt` solo en las filas anteriores a esa columna. Fechar
  // por `updatedAt` haría que editar una membresía vieja moviera su cobro de
  // mes, y un informe ya cerrado cambiaría solo.
  const agg = await tx.membership.aggregate({
    where: whereCobrado(desde, hasta, { companyId }),
    _sum: { montoPagado: true },
  })
  return Number(agg._sum.montoPagado ?? 0)
}

async function porMetodo(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ metodo: string; operaciones: number; monto: number }[]> {
  const filas = await tx.transaction.groupBy({
    by: ['metodoCobro'],
    where: whereCobros(companyId, desde, hasta),
    _sum: { monto: true },
    _count: { _all: true },
  })
  return filas
    .map((f) => ({
      // Sin método no es un error: hay cobros anteriores a la columna. Se
      // enseña como «Sin registrar» en vez de esconderse, porque si no los
      // subtotales dejarían de sumar el total.
      metodo: f.metodoCobro ?? 'Sin registrar',
      operaciones: f._count._all,
      monto: Number(f._sum.monto ?? 0),
    }))
    .sort((a, b) => b.monto - a.monto)
}

async function intentosPorEstado(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ estado: string; total: number; monto: number }[]> {
  const filas = await tx.pagoIntento.groupBy({
    by: ['estado'],
    where: { companyId, createdAt: { gte: desde, lt: hasta } },
    _sum: { monto: true },
    _count: { _all: true },
  })
  return filas
    .map((f) => ({ estado: f.estado, total: f._count._all, monto: Number(f._sum.monto ?? 0) }))
    .sort((a, b) => b.total - a.total)
}

async function motivosDeRechazo(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ motivo: string; total: number }[]> {
  const filas = await tx.pagoIntento.groupBy({
    by: ['motivoRechazo'],
    where: {
      companyId,
      estado: 'RECHAZADO',
      motivoRechazo: { not: null },
      createdAt: { gte: desde, lt: hasta },
    },
    _count: { _all: true },
    orderBy: { _count: { motivoRechazo: 'desc' } },
    take: 20,
  })
  return filas
    .filter((f) => f.motivoRechazo)
    .map((f) => ({ motivo: f.motivoRechazo as string, total: f._count._all }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Cobrado y sin entregar.
 *
 * El cliente pagó y no recibió. Es el hallazgo más caro de todos y el único
 * que el cliente descubre antes que el negocio — por eso no espera a un
 * periodo: se mira SIEMPRE sobre todo lo abierto, no sobre el rango elegido.
 * Un pago atascado en marzo sigue siendo un problema hoy.
 */
async function cobradoSinEntregar(
  tx: Tx,
  companyId: string
): Promise<{ total: number; monto: number }> {
  const agg = await tx.pagoIntento.aggregate({
    where: { companyId, estado: 'APROBADO', fulfillmentEstado: 'PENDIENTE' },
    _sum: { monto: true },
    _count: { _all: true },
  })
  return { total: agg._count._all, monto: Number(agg._sum.monto ?? 0) }
}

async function deshechas(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ total: number; monto: number }> {
  const agg = await tx.transaction.aggregate({
    where: {
      companyId,
      estado: { in: [...DESHECHOS] },
      createdAt: { gte: desde, lt: hasta },
    },
    _sum: { monto: true },
    _count: { _all: true },
  })
  return { total: agg._count._all, monto: Number(agg._sum.monto ?? 0) }
}

async function sumarDescuentos(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<number> {
  const agg = await tx.membership.aggregate({
    where: whereCobrado(desde, hasta, { companyId, descuentoBienvenida: { not: null } }),
    _sum: { descuentoBienvenida: true },
  })
  return Number(agg._sum.descuentoBienvenida ?? 0)
}

/**
 * Recurrente estimado: lo que entraría en 30 días si nadie se fuera.
 *
 * Sale de `montoPagado` —lo que el cliente pagó de verdad— y no del precio de
 * lista del plan, que es donde el Resumen se equivocaba (auditoría · A-2): el
 * precio de lista ignora el precio por categoría de vehículo y los descuentos
 * aplicados.
 *
 * Y solo cuenta membresías VIGENTES, no `estado = 'ACTIVA'` a secas: una
 * membresía que venció y que nadie desactivó seguiría sumando todos los meses.
 */
async function recurrenteEstimado(
  tx: Tx,
  companyId: string,
  ahora: Date
): Promise<{ monto: number; membresias: number }> {
  const filas = await tx.membership.findMany({
    where: { companyId, ...membresiaVigente(ahora), montoPagado: { not: null } },
    select: { montoPagado: true, plan: { select: { vigenciaDias: true } } },
    take: 20_000,
  })
  let monto = 0
  for (const f of filas) {
    const dias = f.plan?.vigenciaDias || 30
    if (dias <= 0) continue
    monto += (Number(f.montoPagado ?? 0) / dias) * 30
  }
  return { monto: Math.round(monto), membresias: filas.length }
}

async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes/finanzas]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporteFinanzas(
  companyId: string,
  rango: Rango,
  ahora: Date = new Date()
): Promise<ReporteFinanzas> {
  const fallos = { n: 0 }
  const cero = { monto: 0, operaciones: 0 }
  const ceroTotal = { total: 0, monto: 0 }

  const [
    caja,
    cajaAnt,
    membresias,
    membresiasAnt,
    metodos,
    intentos,
    motivos,
    sinEntregar,
    anuladas,
    descuentos,
    recurrente,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      seguro(sumarCaja(tx, companyId, rango.desde, rango.hasta), cero, fallos),
      seguro(sumarCaja(tx, companyId, rango.anterior.desde, rango.anterior.hasta), cero, fallos),
      seguro(sumarMembresias(tx, companyId, rango.desde, rango.hasta), 0, fallos),
      seguro(
        sumarMembresias(tx, companyId, rango.anterior.desde, rango.anterior.hasta),
        0,
        fallos
      ),
      seguro(porMetodo(tx, companyId, rango.desde, rango.hasta), [], fallos),
      seguro(intentosPorEstado(tx, companyId, rango.desde, rango.hasta), [], fallos),
      seguro(motivosDeRechazo(tx, companyId, rango.desde, rango.hasta), [], fallos),
      seguro(cobradoSinEntregar(tx, companyId), ceroTotal, fallos),
      seguro(deshechas(tx, companyId, rango.desde, rango.hasta), ceroTotal, fallos),
      seguro(sumarDescuentos(tx, companyId, rango.desde, rango.hasta), 0, fallos),
      seguro(recurrenteEstimado(tx, companyId, ahora), { monto: 0, membresias: 0 }, fallos),
    ])
  )

  const aprobados = intentos.find((i) => i.estado === 'APROBADO')?.total ?? 0
  const rechazados = intentos.find((i) => i.estado === 'RECHAZADO')?.total ?? 0
  const cerrados = aprobados + rechazados

  return {
    ingresosCaja: kpi(caja.monto, cajaAnt.monto),
    cobrosMembresias: kpi(membresias, membresiasAnt),
    ingresoTotal: kpi(caja.monto + membresias, cajaAnt.monto + membresiasAnt),
    operacionesCobradas: kpi(caja.operaciones, cajaAnt.operaciones),
    porMetodo: metodos,
    intentos,
    // Sin intentos cerrados no es 0 %: es «sin dato». Un 0 % diría que se
    // rechazó todo, que es una afirmación sobre la pasarela.
    tasaAprobacion: cerrados === 0 ? null : Math.round((aprobados / cerrados) * 100),
    motivosRechazo: motivos,
    cobradoSinEntregar: sinEntregar,
    deshechas: anuladas,
    descuentos,
    recurrenteEstimado: recurrente,
    incompleto: fallos.n > 0,
  }
}
