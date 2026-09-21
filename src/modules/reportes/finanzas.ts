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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FILTRO POR SUCURSAL, Y HASTA DÓNDE LLEGA
 *
 * «¿Cuánto cobró la sucursal del Este este mes?» se responde filtrando lo que
 * de verdad tiene sucursal: la caja (`Transaction.sucursalId`) y los cobros de
 * membresía (`Membership.sucursalPagoId` — dónde se PAGÓ; una transferencia no
 * se pagó en ninguna y con filtro queda fuera, que es lo correcto).
 *
 * Lo que NO tiene sucursal no se recorta ni se disfraza:
 * - Los intentos de la pasarela (`PagoIntento`) son pagos en línea: no
 *   pertenecen a ningún mostrador. Con filtro ni se consultan, y la vista y
 *   el CSV dicen por qué faltan.
 * - El recurrente estimado es una previsión de la EMPRESA: repartirlo por la
 *   sucursal donde se pagó diría dónde se cobra, no dónde se atiende.
 * - «Cobrado sin entregar» es una ALARMA, no una cifra del periodo: se sigue
 *   mirando entera aunque haya filtro, porque un pago atascado no deja de
 *   ser un problema por estar mirando otra sucursal.
 *
 * Un id que no existe o es de otra empresa NO filtra en silencio: se valida y
 * se descarta, igual que `leerRango` descarta un preset inventado.
 */

type Tx = Prisma.TransactionClient

/** Los únicos estados que significan que el dinero entró. */
const COBRADOS = ['APPROVED', 'APPLIED'] as const
/** Deshechos. No restan del ingreso: se cuentan aparte y se miran. */
const DESHECHOS = ['CANCELLED', 'REVERTED'] as const

/** Lo que la URL pide filtrar. Id sin validar: aquí se valida. */
export interface FiltroFinanzas {
  sucursalId?: string
}

/** El filtro que de verdad se aplicó, con el nombre resuelto para pantalla y CSV. */
export interface FiltroFinanzasAplicado {
  sucursal: { id: string; nombre: string }
}

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
  /**
   * `null` = toda la empresa. Con filtro, la pasarela y el recurrente vienen
   * en cero porque NI SE CONSULTAN (no tienen sucursal); la vista y el CSV
   * los esconden con su porqué. «Cobrado sin entregar» sí viene, entero.
   */
  filtro: FiltroFinanzasAplicado | null
  incompleto: boolean
}

function whereCobros(
  companyId: string,
  desde: Date,
  hasta: Date,
  filtro: FiltroFinanzasAplicado | null
): Prisma.TransactionWhereInput {
  return {
    companyId,
    estado: { in: [...COBRADOS] },
    createdAt: { gte: desde, lt: hasta },
    ...(filtro ? { sucursalId: filtro.sucursal.id } : {}),
  }
}

async function sumarCaja(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date,
  filtro: FiltroFinanzasAplicado | null
): Promise<{ monto: number; operaciones: number }> {
  const agg = await tx.transaction.aggregate({
    where: whereCobros(companyId, desde, hasta, filtro),
    _sum: { monto: true },
    _count: { _all: true },
  })
  return { monto: Number(agg._sum.monto ?? 0), operaciones: agg._count._all }
}

async function sumarMembresias(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date,
  filtro: FiltroFinanzasAplicado | null
): Promise<number> {
  // `whereCobrado` es la única puerta para fechar un cobro: `fechaPago`, con
  // respaldo a `updatedAt` solo en las filas anteriores a esa columna. Fechar
  // por `updatedAt` haría que editar una membresía vieja moviera su cobro de
  // mes, y un informe ya cerrado cambiaría solo.
  //
  // El filtro va por `sucursalPagoId`: dónde se PAGÓ. Una transferencia no se
  // pagó en ninguna sucursal y con filtro queda fuera, que es lo correcto.
  const agg = await tx.membership.aggregate({
    where: whereCobrado(desde, hasta, {
      companyId,
      ...(filtro ? { sucursalPagoId: filtro.sucursal.id } : {}),
    }),
    _sum: { montoPagado: true },
  })
  return Number(agg._sum.montoPagado ?? 0)
}

async function porMetodo(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date,
  filtro: FiltroFinanzasAplicado | null
): Promise<{ metodo: string; operaciones: number; monto: number }[]> {
  const filas = await tx.transaction.groupBy({
    by: ['metodoCobro'],
    where: whereCobros(companyId, desde, hasta, filtro),
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
  hasta: Date,
  filtro: FiltroFinanzasAplicado | null
): Promise<{ total: number; monto: number }> {
  const agg = await tx.transaction.aggregate({
    where: {
      companyId,
      estado: { in: [...DESHECHOS] },
      createdAt: { gte: desde, lt: hasta },
      ...(filtro ? { sucursalId: filtro.sucursal.id } : {}),
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
  hasta: Date,
  filtro: FiltroFinanzasAplicado | null
): Promise<number> {
  // Mismo criterio y mismo camino que `sumarMembresias`: si los cobros de
  // membresía se recortan por sucursal de pago, sus descuentos también, o la
  // nota «ya restados de lo cobrado» dejaría de ser verdad bajo filtro.
  const agg = await tx.membership.aggregate({
    where: whereCobrado(desde, hasta, {
      companyId,
      descuentoBienvenida: { not: null },
      ...(filtro ? { sucursalPagoId: filtro.sucursal.id } : {}),
    }),
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

/**
 * Valida el filtro pedido contra la base y devuelve el que SE APLICA. Un id
 * inventado o de otro inquilino no resuelve, y ese filtro se descarta: aplicar
 * a ciegas pintaría todo en cero, y el cero es una afirmación sobre la caja.
 */
async function resolverFiltro(
  tx: Tx,
  companyId: string,
  pedido: FiltroFinanzas
): Promise<FiltroFinanzasAplicado | null> {
  if (!pedido.sucursalId) return null
  const sucursal = await tx.sucursal.findFirst({
    where: { id: pedido.sucursalId, companyId },
    select: { id: true, nombre: true },
  })
  return sucursal ? { sucursal } : null
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
  ahora: Date = new Date(),
  opciones: { filtro?: FiltroFinanzas } = {}
): Promise<ReporteFinanzas> {
  const fallos = { n: 0 }
  const cero = { monto: 0, operaciones: 0 }
  const ceroTotal = { total: 0, monto: 0 }

  const {
    filtro,
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
  } = await conEmpresa(companyId, async (tx) => {
    // El filtro se resuelve ANTES que todo, porque casi todo lo lleva dentro.
    // Si la validación falla, se sigue SIN filtro y con el aviso de reporte
    // incompleto: peor que un aviso sería aplicar un filtro a medias.
    const filtro = opciones.filtro
      ? await seguro(resolverFiltro(tx, companyId, opciones.filtro), null, fallos)
      : null

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
    ] = await Promise.all([
      seguro(sumarCaja(tx, companyId, rango.desde, rango.hasta, filtro), cero, fallos),
      seguro(
        sumarCaja(tx, companyId, rango.anterior.desde, rango.anterior.hasta, filtro),
        cero,
        fallos
      ),
      seguro(sumarMembresias(tx, companyId, rango.desde, rango.hasta, filtro), 0, fallos),
      seguro(
        sumarMembresias(tx, companyId, rango.anterior.desde, rango.anterior.hasta, filtro),
        0,
        fallos
      ),
      seguro(porMetodo(tx, companyId, rango.desde, rango.hasta, filtro), [], fallos),
      // La pasarela no tiene sucursal: con filtro NI SE CONSULTA, y la vista
      // y el CSV dicen por qué falta. Un total de empresa bajo un título
      // filtrado sería un número mentiroso.
      filtro
        ? Promise.resolve([])
        : seguro(intentosPorEstado(tx, companyId, rango.desde, rango.hasta), [], fallos),
      filtro
        ? Promise.resolve([])
        : seguro(motivosDeRechazo(tx, companyId, rango.desde, rango.hasta), [], fallos),
      // La ALARMA no se apaga por filtrar: cobrado sin entregar se mira
      // entero siempre, y la vista lo rotula como de toda la empresa.
      seguro(cobradoSinEntregar(tx, companyId), ceroTotal, fallos),
      seguro(deshechas(tx, companyId, rango.desde, rango.hasta, filtro), ceroTotal, fallos),
      seguro(sumarDescuentos(tx, companyId, rango.desde, rango.hasta, filtro), 0, fallos),
      filtro
        ? Promise.resolve({ monto: 0, membresias: 0 })
        : seguro(recurrenteEstimado(tx, companyId, ahora), { monto: 0, membresias: 0 }, fallos),
    ])

    return {
      filtro,
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
    }
  })

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
    filtro,
    incompleto: fallos.n > 0,
  }
}
