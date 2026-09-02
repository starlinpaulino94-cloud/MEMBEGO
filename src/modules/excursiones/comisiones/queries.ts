import { conEmpresa } from '@/lib/tenant'
import { getExcursionesConfig, convertirMoneda } from '../config'
import { netoComision } from './nucleo'

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
 * Comisiones con su neto ya calculado (monto + ajustes firmados) y el nombre
 * de a quién le tocan.
 */
export async function listadoComisiones(
  companyId: string,
  filtros?: { estado?: string; vendedorId?: string }
) {
  const where: Record<string, unknown> = { companyId }
  if (filtros?.estado) where.estado = filtros.estado
  if (filtros?.vendedorId) where.vendedorId = filtros.vendedorId

  const [comisiones, config] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          vendedorId: true,
          base: true,
          monto: true,
          moneda: true,
          desglose: true,
          estado: true,
          createdAt: true,
          liquidacionId: true,
          liquidacion: { select: { id: true, numero: true } },
          ajustes: { select: { monto: true, motivo: true } },
          venta: { select: { id: true, numero: true, estado: true } },
        },
      })
    ),
    getExcursionesConfig(companyId),
  ])
  if (comisiones.length === 0) return []

  const vendedorIds = [...new Set(comisiones.map((c) => c.vendedorId))]
  const vendedores = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { id: { in: vendedorIds }, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )
  const porId = new Map(vendedores.map((v) => [v.id, v]))
  const { monedaDefecto, tasasCambio } = config

  return comisiones.map((c) => {
    const v = porId.get(c.vendedorId)
    const ajustes = c.ajustes.map((a) => ({ monto: Number(a.monto), motivo: a.motivo }))
    const montoBase = Number(c.monto)
    const baseNum = Number(c.base)
    return {
      id: c.id,
      vendedorId: c.vendedorId,
      vendedor: v ? `${v.nombre} ${v.apellido ?? ''}`.trim() : 'Vendedor',
      vendedorCodigo: v?.codigo ?? null,
      base: convertirMoneda(baseNum, c.moneda, monedaDefecto, tasasCambio),
      monto: convertirMoneda(montoBase, c.moneda, monedaDefecto, tasasCambio),
      neto: convertirMoneda(netoComision(montoBase, ajustes), c.moneda, monedaDefecto, tasasCambio),
      ajustes,
      moneda: monedaDefecto,
      desglose: c.desglose,
      estado: c.estado,
      createdAt: c.createdAt,
      venta: c.venta,
      liquidacionId: c.liquidacionId,
      liquidacion: c.liquidacion,
    }
  })
}

/** Totales por estado, para el encabezado del módulo. */
export async function resumenComisiones(companyId: string) {
  const [filas, config] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.groupBy({
        by: ['estado', 'moneda'],
        where: { companyId },
        _sum: { monto: true },
        _count: { _all: true },
      })
    ),
    getExcursionesConfig(companyId),
  ])

  const { monedaDefecto, tasasCambio } = config
  const porEstado = new Map<string, { total: number; cantidad: number }>()
  for (const f of filas) {
    const previo = porEstado.get(f.estado) ?? { total: 0, cantidad: 0 }
    const convertido = convertirMoneda(Number(f._sum.monto ?? 0), f.moneda, monedaDefecto, tasasCambio)
    porEstado.set(f.estado, {
      total: Math.round((previo.total + convertido) * 100) / 100,
      cantidad: previo.cantidad + f._count._all,
    })
  }

  return [...porEstado.entries()].map(([estado, { total, cantidad }]) => ({
    estado,
    total,
    cantidad,
  }))
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
