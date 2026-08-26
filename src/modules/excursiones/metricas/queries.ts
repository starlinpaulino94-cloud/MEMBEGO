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

export interface ResumenFiltros {
  vendedorId?: string | null
  tipoVendedor?: string | null
  excursionId?: string | null
  canal?: string | null
  estado?: string | null
}

export async function resumenDelPeriodo(
  companyId: string,
  rango: Rango,
  filtros: ResumenFiltros = {}
) {
  let matchingVendedorIds: string[] | undefined = undefined
  if (filtros.tipoVendedor && filtros.tipoVendedor !== 'TODOS') {
    const vends = await conEmpresa(companyId, (tx) =>
      tx.vendedor.findMany({
        where: { companyId, tipo: filtros.tipoVendedor! },
        select: { id: true },
      })
    )
    matchingVendedorIds = vends.map((v) => v.id)
  }

  const effectiveVendedorCondition = filtros.vendedorId && filtros.vendedorId !== 'TODOS'
    ? { vendedorId: filtros.vendedorId }
    : matchingVendedorIds
      ? { vendedorId: { in: matchingVendedorIds } }
      : {}

  const [registros, reservas, ventas, comisiones] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.count({
        where: {
          companyId,
          ...effectiveVendedorCondition,
          etapa: 'REGISTRO',
          ...(filtros.canal && filtros.canal !== 'TODOS' ? { canal: filtros.canal } : {}),
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.reservaExc.findMany({
        where: {
          companyId,
          ...effectiveVendedorCondition,
          ...(filtros.excursionId && filtros.excursionId !== 'TODAS' ? { excursionId: filtros.excursionId } : {}),
          ...(filtros.canal && filtros.canal !== 'TODOS' ? { canal: filtros.canal } : {}),
          ...(filtros.estado && filtros.estado !== 'TODOS' ? { estado: filtros.estado } : { estado: { not: 'CANCELADA' } }),
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { adultos: true, ninos: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.ventaExc.findMany({
        where: {
          companyId,
          ...effectiveVendedorCondition,
          ...(filtros.excursionId && filtros.excursionId !== 'TODAS' ? { excursionId: filtros.excursionId } : {}),
          ...(filtros.canal && filtros.canal !== 'TODOS' ? { canal: filtros.canal } : {}),
          ...(filtros.estado && filtros.estado !== 'TODOS' ? { estado: filtros.estado } : { estado: { not: 'CANCELADA' } }),
          confirmadaAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { total: true, pasajeros: true, moneda: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.findMany({
        where: {
          companyId,
          ...effectiveVendedorCondition,
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
  const monedaPorVendedor = new Map<string, string>()
  for (const venta of ventas) {
    if (!venta.vendedorId) continue
    const previo = porVendedor.get(venta.vendedorId) ?? { ingresos: 0, ventas: 0, pasajeros: 0 }
    porVendedor.set(venta.vendedorId, {
      ingresos: centavos(previo.ingresos + Number(venta.total)),
      ventas: previo.ventas + 1,
      pasajeros: previo.pasajeros + venta.pasajeros,
    })
    if (!monedaPorVendedor.has(venta.vendedorId)) {
      monedaPorVendedor.set(venta.vendedorId, venta.moneda)
    }
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
        moneda: monedaPorVendedor.get(v.id) ?? ventas[0]?.moneda ?? 'DOP',
      }
    })
    .filter((v) => v.captados > 0 || v.ventas > 0)
    .sort((a, b) => b.ingresos - a.ingresos || b.captados - a.captados)
}

/** Lo real de UN vendedor en un rango, con la forma que pide una meta y filtro de excursión opcional. */
export async function realesDeVendedor(
  companyId: string,
  vendedorId: string,
  rango: Rango,
  excursionId?: string | null
): Promise<RealesMeta> {
  /**
   * LAS TRES CONSULTAS VAN EN UNA SOLA TRANSACCIÓN.
   *
   * Antes eran TRES `conEmpresa` en paralelo, y cada uno abre su propia
   * transacción y retiene una conexión mientras dura. Multiplicado por las
   * metas de la pantalla —que las pedía todas a la vez— salían N×3
   * transacciones simultáneas desde UN solo render.
   *
   * Es la aritmética exacta del incidente del 12-08 documentado en
   * `src/lib/tenant.ts`: las transacciones hacen cola por la conexión y, a la
   * que la de delante tarda más que `maxWait`, la de detrás muere con
   * `P2028: Unable to start a transaction in the given time`. En pantalla eso
   * es «No se pudo cargar esta sección» — sin decir por qué.
   *
   * Son tres lecturas del mismo cliente en el mismo instante: no hay ninguna
   * razón para que vayan por conexiones distintas. Dentro de una transacción
   * se ejecutan igual de bien y cuestan UNA.
   */
  const { registros, reservas, ventas } = await conEmpresa(companyId, async (tx) => {
    const [registros, reservas, ventas] = await Promise.all([
      tx.vendedorAtribucion.count({
        where: {
          companyId,
          vendedorId,
          etapa: 'REGISTRO',
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
      }),
      tx.reservaExc.count({
        where: {
          companyId,
          vendedorId,
          estado: { not: 'CANCELADA' },
          ...(excursionId ? { excursionId } : {}),
          createdAt: { gte: rango.desde, lte: rango.hasta },
        },
      }),
      tx.ventaExc.findMany({
        where: {
          companyId,
          vendedorId,
          estado: { not: 'CANCELADA' },
          ...(excursionId ? { excursionId } : {}),
          confirmadaAt: { gte: rango.desde, lte: rango.hasta },
        },
        select: { total: true, pasajeros: true, moneda: true },
      }),
    ])
    return { registros, reservas, ventas }
  })

  return {
    registros,
    reservas,
    ventas: ventas.length,
    pasajeros: ventas.reduce((t, v) => t + v.pasajeros, 0),
    ingresos: centavos(ventas.reduce((t, v) => t + Number(v.total), 0)),
    moneda: ventas[0]?.moneda ?? null,
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

  const vendedorIds = [...new Set(metas.map((m) => m.vendedorId).filter(Boolean))] as string[]
  const excursionIds = [...new Set(metas.map((m) => m.excursionId).filter(Boolean))] as string[]

  const [vendedores, excursiones] = await Promise.all([
    vendedorIds.length > 0
      ? conEmpresa(companyId, (tx) =>
          tx.vendedor.findMany({
            where: { id: { in: vendedorIds }, companyId },
            select: { id: true, nombre: true, apellido: true, codigo: true },
          })
        )
      : [],
    excursionIds.length > 0
      ? conEmpresa(companyId, (tx) =>
          tx.excursion.findMany({
            where: { id: { in: excursionIds }, companyId },
            select: { id: true, nombre: true, tipoItem: true },
          })
        )
      : [],
  ])

  const porVendedorId = new Map(vendedores.map((v) => [v.id, v]))
  const porExcursionId = new Map(excursiones.map((e) => [e.id, e]))

  return metas.map((m) => {
    const v = m.vendedorId ? porVendedorId.get(m.vendedorId) : null
    const e = m.excursionId ? porExcursionId.get(m.excursionId) : null
    return {
      id: m.id,
      vendedorId: m.vendedorId,
      tipoVendedor: m.tipoVendedor,
      excursionId: m.excursionId,
      excursionNombre: e?.nombre ?? null,
      excursionTipoItem: e?.tipoItem ?? null,
      vendedor: v
        ? `${v.nombre} ${v.apellido ?? ''}`.trim()
        : m.tipoVendedor
          ? `Tipo: ${m.tipoVendedor}`
          : 'Toda la empresa',
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
  const vendedor = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findFirst({
      where: { id: vendedorId, companyId },
      select: { tipo: true },
    })
  )

  const metas = await conEmpresa(companyId, (tx) =>
    tx.vendedorMeta.findMany({
      where: {
        companyId,
        activa: true,
        OR: [
          { vendedorId },
          ...(vendedor?.tipo ? [{ tipoVendedor: vendedor.tipo, vendedorId: null }] : []),
          { vendedorId: null, tipoVendedor: null },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
  )

  const excursionIds = [...new Set(metas.map((m) => m.excursionId).filter(Boolean))] as string[]
  const excursiones =
    excursionIds.length > 0
      ? await conEmpresa(companyId, (tx) =>
          tx.excursion.findMany({
            where: { id: { in: excursionIds }, companyId },
            select: { id: true, nombre: true, tipoItem: true },
          })
        )
      : []

  const porExcursionId = new Map(excursiones.map((e) => [e.id, e]))

  return metas.map((m) => {
    const e = m.excursionId ? porExcursionId.get(m.excursionId) : null
    return {
      id: m.id,
      periodo: m.periodo,
      desde: m.desde,
      hasta: m.hasta,
      excursionId: m.excursionId,
      excursionNombre: e?.nombre ?? null,
      excursionTipoItem: e?.tipoItem ?? null,
      metaVentas: m.metaVentas,
      metaPasajeros: m.metaPasajeros,
      metaIngresos: m.metaIngresos != null ? Number(m.metaIngresos) : null,
      metaRegistros: m.metaRegistros,
      metaReservas: m.metaReservas,
    }
  })
}
