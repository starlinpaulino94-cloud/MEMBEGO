/**
 * Reportes de la empresa · consultas.
 *
 * Todo se pide con el rango YA resuelto (ver `rango.ts`), en instantes UTC que
 * corresponden a medianoche local. Server-internal: sin 'use server'.
 *
 * Sobre los INGRESOS: hay dos fuentes distintas y se muestran separadas a
 * propósito. Las ventas de caja son dinero que entró por el mostrador; los
 * cobros de membresía son activaciones y renovaciones. Sumarlas en una sola
 * cifra sin decirlo haría imposible cuadrar el reporte con la caja del día.
 */

import { conEmpresa, type Tx } from '@/lib/tenant'
import { armarCsvBloques } from '@/lib/csv'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { whereCobrado } from '@/modules/pagos/cobrado'
import type { Prisma } from '@prisma/client'
import { diaLocal, diasDelRango, variacion, type Rango } from './rango'

/** Tipos de transacción que representan una entrega sin cobro. */
const TIPOS_ENTREGA = [
  'MEMBERSHIP_REDEMPTION',
  'PROMOTION_USE',
  'BENEFIT_USE',
  'REWARD_REDEMPTION',
  'COUPON_USE',
  'POINTS_SPEND',
] as const

export const TIPO_TX_LABEL: Record<string, string> = {
  MEMBERSHIP_REDEMPTION: 'Uso de membresía',
  PROMOTION_USE: 'Promoción',
  BENEFIT_USE: 'Beneficio',
  REWARD_REDEMPTION: 'Premio',
  COUPON_USE: 'Cupón',
  POINTS_SPEND: 'Canje de puntos',
  REFERRAL: 'Referido',
  SALE: 'Venta',
  PURCHASE: 'Compra',
  OTHER: 'Otro',
}

export const METODO_LABEL: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  PRESENCIAL: 'En sucursal',
  OTRO: 'Otro',
}

export interface Kpi {
  valor: number
  anterior: number
  /** Porcentaje contra el periodo anterior; `null` si antes no hubo nada. */
  variacion: number | null
}

export interface PuntoSerie {
  dia: string
  ventas: number
  entregas: number
  ingresos: number
}

export interface Reporte {
  ingresosCaja: Kpi
  ingresosMembresias: Kpi
  operaciones: Kpi
  entregas: Kpi
  clientesNuevos: Kpi
  serie: PuntoSerie[]
  porTipo: { tipo: string; operaciones: number; ingresos: number }[]
  porMetodo: { metodo: string; operaciones: number; ingresos: number }[]
  topClientes: { nombre: string; operaciones: number }[]
  activasPorPlan: { plan: string; count: number }[]
  /** Alguna consulta falló: mejor decirlo que enseñar ceros como si fueran reales. */
  incompleto: boolean
}

/** Transacciones que de verdad ocurrieron (una cancelada no es actividad). */
function whereAplicadas(companyId: string, desde: Date, hasta: Date): Prisma.TransactionWhereInput {
  return {
    companyId,
    estado: 'APPLIED',
    createdAt: { gte: desde, lt: hasta },
  }
}

async function sumarVentas(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ ingresos: number; operaciones: number }> {
  const agg = await tx.transaction.aggregate({
    where: { ...whereAplicadas(companyId, desde, hasta), tipo: 'SALE' },
    _sum: { monto: true },
    _count: { _all: true },
  })
  return { ingresos: Number(agg._sum.monto ?? 0), operaciones: agg._count._all }
}

async function sumarMembresias(tx: Tx, companyId: string, desde: Date, hasta: Date): Promise<number> {
  // El cobro se fecha por `fechaPago`, que se escribe UNA vez al confirmarlo.
  // Antes se usaba `updatedAt`, lo único que había, con la consecuencia
  // anotada aquí mismo: editar una membresía vieja la movía de periodo, así
  // que un informe cerrado podía cambiar meses después (auditoría · A-6).
  //
  // Las membresías anteriores a la columna la tienen rellena con su `updatedAt`
  // (la migración lo hizo), pero el respaldo se mantiene para las que quedaran
  // sin rellenar: un cobro sin fecha es mejor contarlo por su aproximación que
  // desaparecer de los ingresos sin avisar.
  const agg = await tx.membership.aggregate({
    where: whereCobrado(desde, hasta, { companyId }),
    _sum: { montoPagado: true },
  })
  return Number(agg._sum.montoPagado ?? 0)
}

async function contarEntregas(tx: Tx, companyId: string, desde: Date, hasta: Date): Promise<number> {
  return tx.transaction.count({
    where: { ...whereAplicadas(companyId, desde, hasta), tipo: { in: [...TIPOS_ENTREGA] } },
  })
}

async function contarClientesNuevos(
  tx: Tx,
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<number> {
  return tx.cliente.count({ where: { companyId, createdAt: { gte: desde, lt: hasta } } })
}

/** Serie diaria: se rellenan los días sin actividad para no mentir con la gráfica. */
async function serieDiaria(
  tx: Tx,
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoSerie[]> {
  const filas = await tx.transaction.findMany({
    where: whereAplicadas(companyId, rango.desde, rango.hasta),
    select: { createdAt: true, tipo: true, monto: true },
    // Tope defensivo: un periodo enorme no debe traer la tabla completa a
    // memoria. Con más movimiento que esto, la gráfica ya no es la herramienta.
    take: 20_000,
  })

  const porDia = new Map<string, PuntoSerie>()
  for (const dia of diasDelRango(rango)) {
    porDia.set(dia, { dia, ventas: 0, entregas: 0, ingresos: 0 })
  }
  for (const f of filas) {
    const punto = porDia.get(diaLocal(f.createdAt, timeZone))
    if (!punto) continue
    if (f.tipo === 'SALE') {
      punto.ventas++
      punto.ingresos += Number(f.monto ?? 0)
    } else if ((TIPOS_ENTREGA as readonly string[]).includes(f.tipo)) {
      punto.entregas++
    }
  }
  return [...porDia.values()]
}

async function desglosePorTipo(tx: Tx, companyId: string, desde: Date, hasta: Date) {
  const grupos = await tx.transaction.groupBy({
    by: ['tipo'],
    where: whereAplicadas(companyId, desde, hasta),
    _count: { _all: true },
    _sum: { monto: true },
  })
  return grupos
    .map((g) => ({
      tipo: g.tipo as string,
      operaciones: g._count._all,
      ingresos: Number(g._sum.monto ?? 0),
    }))
    .sort((a, b) => b.operaciones - a.operaciones)
}

async function desglosePorMetodo(tx: Tx, companyId: string, desde: Date, hasta: Date) {
  const grupos = await tx.transaction.groupBy({
    by: ['metodoCobro'],
    where: { ...whereAplicadas(companyId, desde, hasta), metodoCobro: { not: null } },
    _count: { _all: true },
    _sum: { monto: true },
  })
  return grupos
    .map((g) => ({
      metodo: String(g.metodoCobro),
      operaciones: g._count._all,
      ingresos: Number(g._sum.monto ?? 0),
    }))
    .sort((a, b) => b.ingresos - a.ingresos)
}

async function topClientes(tx: Tx, companyId: string, desde: Date, hasta: Date) {
  const grupos = await tx.transaction.groupBy({
    by: ['clienteId'],
    where: { ...whereAplicadas(companyId, desde, hasta), clienteId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { clienteId: 'desc' } },
    take: 8,
  })
  if (grupos.length === 0) return []
  const clientes = await tx.cliente.findMany({
    where: { id: { in: grupos.map((g) => String(g.clienteId)) } },
    select: { id: true, nombre: true },
  })
  const nombre = new Map(clientes.map((c) => [c.id, c.nombre]))
  return grupos.map((g) => ({
    nombre: nombre.get(String(g.clienteId)) ?? 'Cliente',
    operaciones: g._count._all,
  }))
}

async function activasPorPlan(tx: Tx, companyId: string) {
  const grupos = await tx.membership.groupBy({
    by: ['planId'],
    where: { companyId, ...membresiaVigente() },
    _count: { _all: true },
  })
  if (grupos.length === 0) return []
  const planes = await tx.plan.findMany({
    where: { id: { in: grupos.map((g) => g.planId) } },
    select: { id: true, nombre: true },
  })
  const nombre = new Map(planes.map((p) => [p.id, p.nombre]))
  return grupos
    .map((g) => ({ plan: nombre.get(g.planId) ?? 'Plan', count: g._count._all }))
    .sort((a, b) => b.count - a.count)
}

/** Envuelve una consulta para que un fallo no tumbe el reporte entero. */
async function seguro<T>(p: Promise<T>, porDefecto: T, fallos: { n: number }): Promise<T> {
  try {
    return await p
  } catch (e) {
    console.error('[reportes]', e)
    fallos.n++
    return porDefecto
  }
}

const kpi = (valor: number, anterior: number): Kpi => ({
  valor,
  anterior,
  variacion: variacion(valor, anterior),
})

export async function getReporte(
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<Reporte> {
  const fallos = { n: 0 }
  const cero = { ingresos: 0, operaciones: 0 }

  // Todo el reporte va con el contexto de empresa puesto (RLS Capa 2). El
  // `where: { companyId }` de cada consulta NO se quita: RLS es la segunda
  // barrera, no la primera.
  const [
    ventas,
    ventasAnt,
    membresias,
    membresiasAnt,
    entregas,
    entregasAnt,
    nuevos,
    nuevosAnt,
    serie,
    porTipo,
    porMetodo,
    clientes,
    planes,
  ] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      seguro(sumarVentas(tx, companyId, rango.desde, rango.hasta), cero, fallos),
      seguro(sumarVentas(tx, companyId, rango.anterior.desde, rango.anterior.hasta), cero, fallos),
      seguro(sumarMembresias(tx, companyId, rango.desde, rango.hasta), 0, fallos),
      seguro(sumarMembresias(tx, companyId, rango.anterior.desde, rango.anterior.hasta), 0, fallos),
      seguro(contarEntregas(tx, companyId, rango.desde, rango.hasta), 0, fallos),
      seguro(contarEntregas(tx, companyId, rango.anterior.desde, rango.anterior.hasta), 0, fallos),
      seguro(contarClientesNuevos(tx, companyId, rango.desde, rango.hasta), 0, fallos),
      seguro(
        contarClientesNuevos(tx, companyId, rango.anterior.desde, rango.anterior.hasta),
        0,
        fallos
      ),
      seguro(serieDiaria(tx, companyId, rango, timeZone), [] as PuntoSerie[], fallos),
      seguro(desglosePorTipo(tx, companyId, rango.desde, rango.hasta), [], fallos),
      seguro(desglosePorMetodo(tx, companyId, rango.desde, rango.hasta), [], fallos),
      seguro(topClientes(tx, companyId, rango.desde, rango.hasta), [], fallos),
      seguro(activasPorPlan(tx, companyId), [], fallos),
    ])
  )

  return {
    ingresosCaja: kpi(ventas.ingresos, ventasAnt.ingresos),
    ingresosMembresias: kpi(membresias, membresiasAnt),
    operaciones: kpi(ventas.operaciones, ventasAnt.operaciones),
    entregas: kpi(entregas, entregasAnt),
    clientesNuevos: kpi(nuevos, nuevosAnt),
    serie,
    porTipo,
    porMetodo,
    topClientes: clientes,
    activasPorPlan: planes,
    incompleto: fallos.n > 0,
  }
}

/**
 * CSV del reporte COMPLETO.
 *
 * Antes exportaba solo la serie diaria: una sexta parte de lo que la pantalla
 * enseñaba, sin ninguna señal de que faltara el resto. Quien abría el archivo
 * buscando «cómo pagaron» o «activas por plan» no encontraba nada y no tenía
 * forma de saber si es que no había datos o es que no se exportaban.
 *
 * Van los seis bloques, cada uno con su título, separados por una línea en
 * blanco: es lo que Excel abre de una pieza y lo que cualquiera sabe recortar.
 * Un archivo por bloque obligaría a pulsar seis botones, y las hojas de un
 * libro no caben en un CSV.
 *
 * El ALCANCE abre el archivo, igual que en el reporte de plataforma: un CSV
 * descargado no lleva encima el periodo con el que se generó, y sin esa línea
 * dos exportaciones del mismo día son indistinguibles.
 */
export function reporteToCsv(
  r: Reporte,
  contexto: { empresa: string; desdeDia: string; hastaDia: string; dias: number }
): string {
  const totalSerie = r.serie.reduce(
    (acc, p) => ({
      ventas: acc.ventas + p.ventas,
      entregas: acc.entregas + p.entregas,
      ingresos: acc.ingresos + p.ingresos,
    }),
    { ventas: 0, entregas: 0, ingresos: 0 }
  )

  const conVariacion = (label: string, k: Kpi, dinero = false) => [
    label,
    dinero ? k.valor.toFixed(2) : k.valor,
    dinero ? k.anterior.toFixed(2) : k.anterior,
    k.variacion ?? '',
  ]

  return armarCsvBloques([
    {
      titulo: 'Alcance del reporte',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Empresa', contexto.empresa],
        ['Periodo', `${contexto.desdeDia} a ${contexto.hastaDia}`],
        ['Dias', contexto.dias],
        ['Datos completos', r.incompleto ? 'NO - alguna consulta fallo' : 'Si'],
      ],
    },
    {
      titulo: 'Totales',
      encabezados: ['Metrica', 'Periodo', 'Periodo anterior', 'Variacion %'],
      filas: [
        conVariacion('Ingresos de caja', r.ingresosCaja, true),
        conVariacion('Cobros de membresias', r.ingresosMembresias, true),
        conVariacion('Ventas', r.operaciones),
        conVariacion('Entregas sin cobro', r.entregas),
        conVariacion('Clientes nuevos', r.clientesNuevos),
      ],
    },
    {
      titulo: 'Actividad por dia',
      encabezados: ['Dia', 'Ventas', 'Entregas sin cobro', 'Ingresos de caja'],
      filas: [
        ...r.serie.map((p) => [p.dia, p.ventas, p.entregas, p.ingresos.toFixed(2)]),
        ['TOTAL', totalSerie.ventas, totalSerie.entregas, totalSerie.ingresos.toFixed(2)],
      ],
    },
    {
      titulo: 'Operaciones por tipo',
      encabezados: ['Tipo', 'Operaciones', 'Ingresos'],
      filas: r.porTipo.map((t) => [
        TIPO_TX_LABEL[t.tipo] ?? t.tipo,
        t.operaciones,
        t.ingresos.toFixed(2),
      ]),
    },
    {
      titulo: 'Como pagaron',
      encabezados: ['Metodo', 'Operaciones', 'Ingresos'],
      filas: r.porMetodo.map((m) => [
        METODO_LABEL[m.metodo] ?? m.metodo,
        m.operaciones,
        m.ingresos.toFixed(2),
      ]),
    },
    {
      titulo: 'Clientes mas activos',
      encabezados: ['Cliente', 'Operaciones'],
      filas: r.topClientes.map((c) => [c.nombre, c.operaciones]),
    },
    {
      // Foto de hoy: no depende del periodo, y el título lo dice para que
      // nadie la cruce con las cifras de arriba.
      titulo: 'Membresias activas por plan (foto de hoy)',
      encabezados: ['Plan', 'Activas'],
      filas: r.activasPorPlan.map((p) => [p.plan, p.count]),
    },
  ])
}
