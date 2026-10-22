import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import type { Paginacion } from '@/lib/paginacion'
import { getExcursionesConfig, obtenerDetalleConversion } from '../config'
import { condicionesDeComisiones, type FiltrosComisiones } from './lista'
import { netoComision } from './nucleo'

export interface ResumenComisionesResuelto {
  porEstado: Array<{ estado: string; total: number; cantidad: number }>
  monedaDefecto: string
  tasasCambio: Record<string, number>
  totalComisiones: number
  comisionesConConversion: number
  comisionesSinTasaConfigurada: number
  comisionesReglaGeneral: number
  desgloseMonedas: Array<{
    moneda: string
    totalOriginal: number
    totalConvertido: number
    cantidad: number
    tasaLabel: string
    tasaConfigurada: boolean
  }>
}

/** Reglas de la empresa, de la más específica a la más general. */
export async function listadoReglas(companyId: string) {
  const reglas = await conEmpresa(companyId, (tx) =>
    tx.comisionRegla.findMany({
      where: { companyId },
      orderBy: [{ activa: 'desc' }, { createdAt: 'desc' }],
    })
  )
  if (reglas.length === 0) return []

  const excursionIds = [...new Set(reglas.map((r) => r.excursionId).filter((x): x is string => !!x))]
  const vendedorIds = [...new Set(reglas.map((r) => r.vendedorId).filter((x): x is string => !!x))]
  const [excursiones, vendedores] = await Promise.all([
    excursionIds.length
      ? conEmpresa(companyId, (tx) =>
          tx.excursion.findMany({
            where: { id: { in: excursionIds }, companyId },
            select: { id: true, nombre: true },
          })
        )
      : Promise.resolve([]),
    vendedorIds.length
      ? conEmpresa(companyId, (tx) =>
          tx.vendedor.findMany({
            where: { id: { in: vendedorIds }, companyId },
            select: { id: true, nombre: true, apellido: true, codigo: true },
          })
        )
      : Promise.resolve([]),
  ])
  const porExcursion = new Map(excursiones.map((e) => [e.id, e.nombre]))
  const porVendedor = new Map(
    vendedores.map((v) => [v.id, `${v.nombre} ${v.apellido ?? ''}`.trim()])
  )

  return reglas.map((r) => ({
    id: r.id,
    ambito: r.ambito,
    tipoCalculo: r.tipoCalculo,
    valor: Number(r.valor),
    escalones: r.escalones,
    activa: r.activa,
    categoria: r.categoria,
    tipoVendedor: r.tipoVendedor ?? null,
    vigenciaDesde: r.vigenciaDesde,
    vigenciaHasta: r.vigenciaHasta,
    excursion: r.excursionId ? porExcursion.get(r.excursionId) ?? null : null,
    vendedor: r.vendedorId ? porVendedor.get(r.vendedorId) ?? null : null,
  }))
}

/**
 * Una página de comisiones, con su neto ya calculado (monto + ajustes firmados) y el nombre de a quién le tocan.
 *
 * Los filtros y la página los resuelve la base sobre TODAS las comisiones de la empresa (antes: `take: 300` sin avisar y el
 * navegador filtraba esas 300). `total` es el de los filtros, no el de la página; `hayAlguna` distingue «no hay comisiones» de
 * «el filtro no encontró ninguna».
 */
export async function listarComisiones(
  companyId: string,
  opciones: { filtros: FiltrosComisiones; paginacion: Pick<Paginacion, 'saltar' | 'tomar'> }
) {
  const { filtros, paginacion } = opciones
  const config = await getExcursionesConfig(companyId)
  const { q } = filtros
  const like = { contains: q, mode: 'insensitive' as const }

  const { comisiones, total, hayAlguna } = await conEmpresa(companyId, async (tx) => {
    const condiciones = condicionesDeComisiones(filtros, config.monedaDefecto)
    if (q) {
      // El vendedor no es una relación del modelo: se buscan primero los que coinciden y se pide «los de esos vendedores».
      const vendedores = await tx.vendedor.findMany({
        where: { companyId, OR: [{ nombre: like }, { apellido: like }, { codigo: like }] },
        select: { id: true },
        take: 500,
      })
      const coincidencias: Prisma.ComisionEntradaWhereInput[] = [
        { desglose: like },
        { venta: { numero: like } },
        { liquidacion: { numero: like } },
      ]
      if (vendedores.length) coincidencias.push({ vendedorId: { in: vendedores.map((v) => v.id) } })
      condiciones.push({ OR: coincidencias })
    }
    const where: Prisma.ComisionEntradaWhereInput = { companyId, AND: condiciones }

    const [comisiones, total] = await Promise.all([
      tx.comisionEntrada.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: paginacion.saltar,
        take: paginacion.tomar,
        select: {
          id: true,
          vendedorId: true,
          base: true,
          monto: true,
          moneda: true,
          desglose: true,
          reglaSnapshot: true,
          estado: true,
          createdAt: true,
          liquidacionId: true,
          liquidacion: { select: { id: true, numero: true } },
          ajustes: { select: { monto: true, motivo: true } },
          venta: { select: { id: true, numero: true, estado: true } },
        },
      }),
      tx.comisionEntrada.count({ where }),
    ])
    // Solo si no salió nada: ¿es que no hay comisiones, o es que el filtro las esconde? La pantalla dice cosas distintas.
    const hayAlguna = comisiones.length === 0 ? (await tx.comisionEntrada.count({ where: { companyId } })) > 0 : true
    return { comisiones, total, hayAlguna }
  })
  if (comisiones.length === 0) return { filas: [], total, hayAlguna }

  const vendedorIds = [...new Set(comisiones.map((c) => c.vendedorId))]
  const vendedores = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { id: { in: vendedorIds }, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )
  const porId = new Map(vendedores.map((v) => [v.id, v]))
  const { monedaDefecto, tasasCambio } = config

  const filas = comisiones.map((c) => {
    const v = porId.get(c.vendedorId)
    const ajustes = c.ajustes.map((a) => ({ monto: Number(a.monto), motivo: a.motivo }))
    const montoBase = Number(c.monto)
    const baseNum = Number(c.base)
    const netoOrig = netoComision(montoBase, ajustes)

    const conversionNeto = obtenerDetalleConversion(netoOrig, c.moneda, monedaDefecto, tasasCambio)
    const conversionMonto = obtenerDetalleConversion(montoBase, c.moneda, monedaDefecto, tasasCambio)
    const conversionBase = obtenerDetalleConversion(baseNum, c.moneda, monedaDefecto, tasasCambio)

    const reglaSnap = c.reglaSnapshot as Record<string, unknown> | null
    const esReglaPredeterminada = Boolean(
      reglaSnap && (reglaSnap.ambito === 'GENERAL' || reglaSnap.reglaId === 'default-general')
    )

    return {
      id: c.id,
      vendedorId: c.vendedorId,
      vendedor: v ? `${v.nombre} ${v.apellido ?? ''}`.trim() : 'Vendedor',
      vendedorCodigo: v?.codigo ?? null,
      base: conversionBase.montoConvertido,
      monto: conversionMonto.montoConvertido,
      neto: conversionNeto.montoConvertido,
      moneda: monedaDefecto,
      baseOriginal: baseNum,
      montoOriginal: montoBase,
      netoOriginal: netoOrig,
      monedaOriginal: c.moneda,
      conversion: conversionNeto,
      esReglaPredeterminada,
      ajustes,
      desglose: c.desglose,
      estado: c.estado,
      createdAt: c.createdAt,
      venta: c.venta,
      liquidacionId: c.liquidacionId,
      liquidacion: c.liquidacion,
    }
  })
  return { filas, total, hayAlguna }
}

/** Resumen financiero y desglose multi-moneda por estado y divisa original. */
export async function resumenComisiones(companyId: string): Promise<ResumenComisionesResuelto> {
  const [filas, config, comisionesTotal] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.groupBy({
        by: ['estado', 'moneda'],
        where: { companyId },
        _sum: { monto: true },
        _count: { _all: true },
      })
    ),
    getExcursionesConfig(companyId),
    conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.findMany({
        where: { companyId },
        select: { moneda: true, reglaSnapshot: true, monto: true },
      })
    ),
  ])

  const { monedaDefecto, tasasCambio } = config
  const porEstado = new Map<string, { total: number; cantidad: number }>()
  for (const f of filas) {
    const previo = porEstado.get(f.estado) ?? { total: 0, cantidad: 0 }
    const conv = obtenerDetalleConversion(Number(f._sum.monto ?? 0), f.moneda, monedaDefecto, tasasCambio)
    porEstado.set(f.estado, {
      total: Math.round((previo.total + conv.montoConvertido) * 100) / 100,
      cantidad: previo.cantidad + f._count._all,
    })
  }

  // Agrupación por moneda original
  const porMoneda = new Map<string, { totalOriginal: number; cantidad: number }>()
  let comisionesConConversion = 0
  let comisionesSinTasaConfigurada = 0
  let comisionesReglaGeneral = 0

  for (const c of comisionesTotal) {
    const mon = (c.moneda || monedaDefecto).toUpperCase()
    const conv = obtenerDetalleConversion(Number(c.monto), mon, monedaDefecto, tasasCambio)
    if (conv.esConversion) {
      comisionesConConversion++
      if (!conv.tasaConfigurada) {
        comisionesSinTasaConfigurada++
      }
    }
    const snap = c.reglaSnapshot as Record<string, unknown> | null
    if (snap && (snap.ambito === 'GENERAL' || snap.reglaId === 'default-general')) {
      comisionesReglaGeneral++
    }
    const previo = porMoneda.get(mon) ?? { totalOriginal: 0, cantidad: 0 }
    porMoneda.set(mon, {
      totalOriginal: Math.round((previo.totalOriginal + Number(c.monto)) * 100) / 100,
      cantidad: previo.cantidad + 1,
    })
  }

  const desgloseMonedas = [...porMoneda.entries()].map(([moneda, info]) => {
    const conv = obtenerDetalleConversion(info.totalOriginal, moneda, monedaDefecto, tasasCambio)
    return {
      moneda,
      totalOriginal: info.totalOriginal,
      totalConvertido: conv.montoConvertido,
      cantidad: info.cantidad,
      tasaLabel: conv.tasaLabel,
      tasaConfigurada: conv.tasaConfigurada,
    }
  })

  return {
    porEstado: [...porEstado.entries()].map(([estado, { total, cantidad }]) => ({
      estado,
      total,
      cantidad,
    })),
    monedaDefecto,
    tasasCambio,
    totalComisiones: comisionesTotal.length,
    comisionesConConversion,
    comisionesSinTasaConfigurada,
    comisionesReglaGeneral,
    desgloseMonedas,
  }
}

/** Excursiones y vendedores para los selectores del formulario de reglas. */
export async function opcionesParaReglas(companyId: string) {
  const [excursiones, vendedores] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.excursion.findMany({
        where: { companyId, estado: { not: 'ARCHIVADA' } },
        orderBy: { nombre: 'asc' },
        select: { id: true, nombre: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.vendedor.findMany({
        where: { companyId, estado: 'ACTIVO' },
        orderBy: { nombre: 'asc' },
        select: { id: true, nombre: true, apellido: true, codigo: true },
      })
    ),
  ])
  return {
    excursiones,
    vendedores: vendedores.map((v) => ({
      id: v.id,
      nombre: `${v.nombre} ${v.apellido ?? ''}`.trim(),
      codigo: v.codigo,
    })),
  }
}

/** La venta de una reserva, si ya se confirmó. */
export async function ventaDeReserva(companyId: string, reservaId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.ventaExc.findFirst({
      where: { reservaId, companyId },
      select: { id: true, numero: true, estado: true, confirmadaAt: true },
    })
  )
}

/** Vendedores de la empresa para poblar el selector de filtros. */
export async function vendedoresParaFiltro(companyId: string) {
  const vendedores = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { companyId },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )
  return vendedores.map((v) => ({
    id: v.id,
    nombre: `${v.nombre} ${v.apellido ?? ''}`.trim(),
    codigo: v.codigo,
  }))
}
