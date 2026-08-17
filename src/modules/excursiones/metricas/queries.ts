import { conEmpresa } from '@/lib/tenant'
import { netoComision } from '@/modules/excursiones/comisiones/nucleo'
import { centavos, ticketPromedio, conversion, type Rango, type RealesMeta } from './nucleo'

/**
 * EXCURSIONES · Métricas — lecturas.
 *
 * Cada cifra sale de contar filas reales dentro del rango. No hay contadores
 * guardados que mantener: un número que se calcula puede tardar, pero no puede
 * mentir. Las ventas CANCELADAS no suman en ningún sitio.
 */

export async function resumenDelPeriodo(companyId: string, rango: Rango) {
  const [registros, reservas, ventas, comisiones] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.count({
        where: {
          companyId,
          etapa: 'REGISTRO',
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.reservaExc.findMany({
        where: {
          companyId,
          estado: { not: 'CANCELADA' },
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { adultos: true, ninos: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.ventaExc.findMany({
        where: {
          companyId,
          estado: { not: 'CANCELADA' },
          confirmadaAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { total: true, pasajeros: true, moneda: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.findMany({
        where: {
          companyId,
          estado: { not: 'ANULADA' },
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { monto: true, ajustes: { select: { monto: true } } },
      })
    ),
  ])

  const ingresos = centavos(ventas.reduce((t, v) => t + Number(v.total), 0))
  const comisionado = centavos(
    comisiones.reduce(
      (t, c) => t + netoComision(Number(c.monto), c.ajustes.map((a) => ({ monto: Number(a.monto) }))),
      0
    )
  )

  return {
    registros,
    reservas: reservas.length,
    pasajerosReservados: reservas.reduce((t, r) => t + r.adultos + r.ninos, 0),
    ventas: ventas.length,
    pasajerosVendidos: ventas.reduce((t, v) => t + v.pasajeros, 0),
    ingresos,
    comisionado,
    moneda: ventas[0]?.moneda ?? 'DOP',
    ticket: ticketPromedio(ingresos, ventas.length),
    conversionReserva: conversion(reservas.length, registros),
    conversionVenta: conversion(ventas.length, reservas.length),
  }
}

/**
 * Ranking del equipo en el período: quién trajo, quién vendió y cuánto entró.
 * Se ordena por ingresos porque es lo que paga la nómina, pero se enseñan las
 * tres columnas: un promotor que capta mucho y cierra poco es información, no
 * un mal puesto en una lista.
 */
export async function rankingVendedores(companyId: string, rango: Rango) {
  const [vendedores, atribuciones, ventas] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.vendedor.findMany({
        where: { companyId, estado: 'ACTIVO' },
        select: { id: true, nombre: true, apellido: true, codigo: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.groupBy({
        by: ['vendedorId'],
        where: {
          companyId,
          etapa: 'REGISTRO',
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
        _count: { _all: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.ventaExc.findMany({
        where: {
          companyId,
          estado: { not: 'CANCELADA' },
          vendedorId: { not: null },
          confirmadaAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { vendedorId: true, total: true, pasajeros: true, moneda: true },
      })
    ),
  ])

  const captados = new Map(atribuciones.map((a) => [a.vendedorId, a._count._all]))
  const porVendedor = new Map<string, { ingresos: number; ventas: number; pasajeros: number }>()
  for (const v of ventas) {
    if (!v.vendedorId) continue
    const previo = porVendedor.get(v.vendedorId) ?? { ingresos: 0, ventas: 0, pasajeros: 0 }
    porVendedor.set(v.vendedorId, {
      ingresos: centavos(previo.ingresos + Number(v.total)),
      ventas: previo.ventas + 1,
      pasajeros: previo.pasajeros + v.pasajeros,
    })
  }

  return vendedores
    .map((v) => {
      const datos = porVendedor.get(v.id) ?? { ingresos: 0, ventas: 0, pasajeros: 0 }
      return {
        id: v.id,
        nombre: `${v.nombre} ${v.apellido ?? ''}`.trim(),
        codigo: v.codigo,
        captados: captados.get(v.id) ?? 0,
        ...datos,
        moneda: ventas[0]?.moneda ?? 'DOP',
      }
    })
    .filter((v) => v.captados > 0 || v.ventas > 0)
    .sort((a, b) => b.ingresos - a.ingresos || b.captados - a.captados)
}

/** Lo real de UN vendedor en un rango, con la forma que pide una meta. */
export async function realesDeVendedor(
  companyId: string,
  vendedorId: string,
  rango: Rango
): Promise<RealesMeta> {
  const [registros, reservas, ventas] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.count({
        where: {
          companyId,
          vendedorId,
          etapa: 'REGISTRO',
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.reservaExc.count({
        where: {
          companyId,
          vendedorId,
          estado: { not: 'CANCELADA' },
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.ventaExc.findMany({
        where: {
          companyId,
          vendedorId,
          estado: { not: 'CANCELADA' },
          confirmadaAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { total: true, pasajeros: true },
      })
    ),
  ])

  return {
    registros,
    reservas,
    ventas: ventas.length,
    pasajeros: ventas.reduce((t, v) => t + v.pasajeros, 0),
    ingresos: centavos(ventas.reduce((t, v) => t + Number(v.total), 0)),
  }
}

/** Metas activas de la empresa (para el panel del administrador). */
export async function metasActivas(companyId: string) {
  const metas = await conEmpresa(companyId, (tx) =>
    tx.vendedorMeta.findMany({
      where: { companyId, activa: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  )
  if (metas.length === 0) return []

  const vendedores = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { id: { in: [...new Set(metas.map((m) => m.vendedorId))] }, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )
  const porId = new Map(vendedores.map((v) => [v.id, v]))

  return metas.map((m) => {
    const v = porId.get(m.vendedorId)
    return {
      id: m.id,
      vendedorId: m.vendedorId,
      vendedor: v ? `${v.nombre} ${v.apellido ?? ''}`.trim() : 'Vendedor',
      codigo: v?.codigo ?? null,
      periodo: m.periodo,
      desde: m.desde,
      hasta: m.hasta,
      metaVentas: m.metaVentas,
      metaPasajeros: m.metaPasajeros,
      metaIngresos: m.metaIngresos != null ? Number(m.metaIngresos) : null,
      metaRegistros: m.metaRegistros,
      metaReservas: m.metaReservas,
    }
  })
}

/** Metas activas de UN vendedor (para su propio panel). */
export async function metasDeVendedor(companyId: string, vendedorId: string) {
  const metas = await conEmpresa(companyId, (tx) =>
    tx.vendedorMeta.findMany({
      where: { companyId, vendedorId, activa: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
  )
  return metas.map((m) => ({
    id: m.id,
    periodo: m.periodo,
    desde: m.desde,
    hasta: m.hasta,
    metaVentas: m.metaVentas,
    metaPasajeros: m.metaPasajeros,
    metaIngresos: m.metaIngresos != null ? Number(m.metaIngresos) : null,
    metaRegistros: m.metaRegistros,
    metaReservas: m.metaReservas,
  }))
}
