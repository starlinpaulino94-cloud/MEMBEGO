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

import { prisma } from '@/lib/prisma'
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
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ ingresos: number; operaciones: number }> {
  const agg = await prisma.transaction.aggregate({
    where: { ...whereAplicadas(companyId, desde, hasta), tipo: 'SALE' },
    _sum: { monto: true },
    _count: { _all: true },
  })
  return { ingresos: Number(agg._sum.monto ?? 0), operaciones: agg._count._all }
}

async function sumarMembresias(companyId: string, desde: Date, hasta: Date): Promise<number> {
  // `updatedAt` es lo único que hay para fechar el cobro: la membresía no
  // guarda una fecha de pago propia. Se documenta porque significa que editar
  // una membresía vieja la mueve de periodo.
  const agg = await prisma.membership.aggregate({
    where: { companyId, pagoConfirmado: true, updatedAt: { gte: desde, lt: hasta } },
    _sum: { montoPagado: true },
  })
  return Number(agg._sum.montoPagado ?? 0)
}

async function contarEntregas(companyId: string, desde: Date, hasta: Date): Promise<number> {
  return prisma.transaction.count({
    where: { ...whereAplicadas(companyId, desde, hasta), tipo: { in: [...TIPOS_ENTREGA] } },
  })
}

async function contarClientesNuevos(
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<number> {
  return prisma.cliente.count({ where: { companyId, createdAt: { gte: desde, lt: hasta } } })
}

/** Serie diaria: se rellenan los días sin actividad para no mentir con la gráfica. */
async function serieDiaria(
  companyId: string,
  rango: Rango,
  timeZone: string
): Promise<PuntoSerie[]> {
  const filas = await prisma.transaction.findMany({
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

async function desglosePorTipo(companyId: string, desde: Date, hasta: Date) {
  const grupos = await prisma.transaction.groupBy({
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

async function desglosePorMetodo(companyId: string, desde: Date, hasta: Date) {
  const grupos = await prisma.transaction.groupBy({
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

async function topClientes(companyId: string, desde: Date, hasta: Date) {
  const grupos = await prisma.transaction.groupBy({
    by: ['clienteId'],
    where: { ...whereAplicadas(companyId, desde, hasta), clienteId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { clienteId: 'desc' } },
    take: 8,
  })
  if (grupos.length === 0) return []
  const clientes = await prisma.cliente.findMany({
    where: { id: { in: grupos.map((g) => String(g.clienteId)) } },
    select: { id: true, nombre: true },
  })
  const nombre = new Map(clientes.map((c) => [c.id, c.nombre]))
  return grupos.map((g) => ({
    nombre: nombre.get(String(g.clienteId)) ?? 'Cliente',
    operaciones: g._count._all,
  }))
}

async function activasPorPlan(companyId: string) {
  const grupos = await prisma.membership.groupBy({
    by: ['planId'],
    where: { companyId, estado: 'ACTIVA' },
    _count: { _all: true },
  })
  if (grupos.length === 0) return []
  const planes = await prisma.plan.findMany({
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
  ] = await Promise.all([
    seguro(sumarVentas(companyId, rango.desde, rango.hasta), cero, fallos),
    seguro(sumarVentas(companyId, rango.anterior.desde, rango.anterior.hasta), cero, fallos),
    seguro(sumarMembresias(companyId, rango.desde, rango.hasta), 0, fallos),
    seguro(sumarMembresias(companyId, rango.anterior.desde, rango.anterior.hasta), 0, fallos),
    seguro(contarEntregas(companyId, rango.desde, rango.hasta), 0, fallos),
    seguro(contarEntregas(companyId, rango.anterior.desde, rango.anterior.hasta), 0, fallos),
    seguro(contarClientesNuevos(companyId, rango.desde, rango.hasta), 0, fallos),
    seguro(
      contarClientesNuevos(companyId, rango.anterior.desde, rango.anterior.hasta),
      0,
      fallos
    ),
    seguro(serieDiaria(companyId, rango, timeZone), [] as PuntoSerie[], fallos),
    seguro(desglosePorTipo(companyId, rango.desde, rango.hasta), [], fallos),
    seguro(desglosePorMetodo(companyId, rango.desde, rango.hasta), [], fallos),
    seguro(topClientes(companyId, rango.desde, rango.hasta), [], fallos),
    seguro(activasPorPlan(companyId), [], fallos),
  ])

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

/** Escapa un campo para CSV (comillas, comas y saltos de línea). */
function celda(v: string | number): string {
  const s = String(v ?? '')
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV del reporte: la serie diaria, que es la tabla que la gente lleva a su
 * hoja de cálculo. Se usa `;` porque Excel en español lo espera como separador
 * y con `,` deja todo en una sola columna.
 */
export function reporteToCsv(serie: PuntoSerie[]): string {
  const cabecera = ['Día', 'Ventas', 'Entregas sin cobro', 'Ingresos de caja']
  const filas = serie.map((p) =>
    [celda(p.dia), celda(p.ventas), celda(p.entregas), celda(p.ingresos.toFixed(2))].join(';')
  )
  const total = serie.reduce(
    (acc, p) => ({
      ventas: acc.ventas + p.ventas,
      entregas: acc.entregas + p.entregas,
      ingresos: acc.ingresos + p.ingresos,
    }),
    { ventas: 0, entregas: 0, ingresos: 0 }
  )
  return [
    cabecera.join(';'),
    ...filas,
    ['TOTAL', total.ventas, total.entregas, total.ingresos.toFixed(2)].join(';'),
  ].join('\n')
}
