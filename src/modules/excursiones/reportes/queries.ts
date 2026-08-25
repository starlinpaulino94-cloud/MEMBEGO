import { conEmpresa } from '@/lib/tenant'
import { TOPE_EXPORTACION } from '@/lib/csv'
import { netoComision, centavos } from '@/modules/excursiones/comisiones/nucleo'
import type { Rango } from '@/modules/excursiones/metricas/nucleo'
import type { FilaVenta, FilaComision, FilaLiquidacion } from './nucleo'

/**
 * EXCURSIONES · Reportes — lecturas del período completo.
 *
 * Se lee UNA fila más que el tope para saber si hubo recorte sin traerse el
 * doble de datos: con esa fila de más basta para escribir el aviso dentro del
 * archivo, que es lo que evita que alguien cuadre su contabilidad con la mitad.
 */

const LIMITE = TOPE_EXPORTACION + 1

/** Nombres de cliente, excursión y vendedor en una lectura por tipo. */
async function nombres(
  companyId: string,
  ids: { clientes: string[]; excursiones: string[]; vendedores: string[] }
) {
  const unicos = (v: string[]) => [...new Set(v.filter(Boolean))]
  const [clientes, excursiones, vendedores] = await Promise.all([
    unicos(ids.clientes).length
      ? conEmpresa(companyId, (tx) =>
          tx.cliente.findMany({
            where: { id: { in: unicos(ids.clientes) }, companyId },
            select: { id: true, nombre: true },
          })
        )
      : Promise.resolve([]),
    unicos(ids.excursiones).length
      ? conEmpresa(companyId, (tx) =>
          tx.excursion.findMany({
            where: { id: { in: unicos(ids.excursiones) }, companyId },
            select: { id: true, nombre: true },
          })
        )
      : Promise.resolve([]),
    unicos(ids.vendedores).length
      ? conEmpresa(companyId, (tx) =>
          tx.vendedor.findMany({
            where: { id: { in: unicos(ids.vendedores) }, companyId },
            select: { id: true, nombre: true, apellido: true, codigo: true },
          })
        )
      : Promise.resolve([]),
  ])
  return {
    clientes: new Map(clientes.map((c) => [c.id, c.nombre])),
    excursiones: new Map(excursiones.map((e) => [e.id, e.nombre])),
    vendedores: new Map(
      vendedores.map((v) => [v.id, { nombre: `${v.nombre} ${v.apellido ?? ''}`.trim(), codigo: v.codigo }])
    ),
  }
}

export interface ReporteFiltros {
  vendedorId?: string | null
  tipoVendedor?: string | null
  excursionId?: string | null
  canal?: string | null
  estado?: string | null
}

export async function ventasDelPeriodo(
  companyId: string,
  rango: Rango,
  fecha: (d: Date | null) => string,
  filtros: ReporteFiltros = {}
): Promise<{ filas: FilaVenta[]; total: number }> {
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

  const effectiveVendedorCondition =
    filtros.vendedorId && filtros.vendedorId !== 'TODOS'
      ? { vendedorId: filtros.vendedorId }
      : matchingVendedorIds
        ? { vendedorId: { in: matchingVendedorIds } }
        : {}

  const ventas = await conEmpresa(companyId, (tx) =>
    tx.ventaExc.findMany({
      where: {
        companyId,
        confirmadaAt: { gte: rango.desde, lte: rango.hasta },
        ...effectiveVendedorCondition,
        ...(filtros.excursionId && filtros.excursionId !== 'TODAS' ? { excursionId: filtros.excursionId } : {}),
        ...(filtros.canal && filtros.canal !== 'TODOS' ? { canal: filtros.canal } : {}),
        ...(filtros.estado && filtros.estado !== 'TODOS' ? { estado: filtros.estado } : {}),
      },
      orderBy: { confirmadaAt: 'asc' },
      take: LIMITE,
      select: {
        numero: true,
        confirmadaAt: true,
        clienteId: true,
        excursionId: true,
        vendedorId: true,
        pasajeros: true,
        total: true,
        moneda: true,
        estado: true,
      },
    })
  )
  const apoyo = await nombres(companyId, {
    clientes: ventas.map((v) => v.clienteId),
    excursiones: ventas.map((v) => v.excursionId),
    vendedores: ventas.map((v) => v.vendedorId ?? ''),
  })
  return {
    total: ventas.length,
    filas: ventas.slice(0, TOPE_EXPORTACION).map((v) => {
      const vendedor = v.vendedorId ? apoyo.vendedores.get(v.vendedorId) : null
      return {
        numero: v.numero,
        fecha: fecha(v.confirmadaAt),
        cliente: apoyo.clientes.get(v.clienteId) ?? 'Cliente',
        excursion: apoyo.excursiones.get(v.excursionId) ?? '',
        vendedor: vendedor?.nombre ?? null,
        vendedorCodigo: vendedor?.codigo ?? null,
        pasajeros: v.pasajeros,
        total: Number(v.total),
        moneda: v.moneda,
        estado: v.estado,
      }
    }),
  }
}

export async function comisionesDelPeriodo(
  companyId: string,
  rango: Rango,
  fecha: (d: Date | null) => string,
  filtros: ReporteFiltros = {}
): Promise<{ filas: FilaComision[]; total: number }> {
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

  const effectiveVendedorCondition =
    filtros.vendedorId && filtros.vendedorId !== 'TODOS'
      ? { vendedorId: filtros.vendedorId }
      : matchingVendedorIds
        ? { vendedorId: { in: matchingVendedorIds } }
        : {}

  const comisiones = await conEmpresa(companyId, (tx) =>
    tx.comisionEntrada.findMany({
      where: {
        companyId,
        createdAt: { gte: rango.desde, lte: rango.hasta },
        ...effectiveVendedorCondition,
        ...(filtros.estado && filtros.estado !== 'TODOS' ? { estado: filtros.estado } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: LIMITE,
      select: {
        createdAt: true,
        vendedorId: true,
        base: true,
        monto: true,
        moneda: true,
        desglose: true,
        estado: true,
        ajustes: { select: { monto: true } },
        venta: { select: { numero: true } },
        liquidacion: { select: { numero: true } },
      },
    })
  )
  const apoyo = await nombres(companyId, {
    clientes: [],
    excursiones: [],
    vendedores: comisiones.map((c) => c.vendedorId),
  })
  return {
    total: comisiones.length,
    filas: comisiones.slice(0, TOPE_EXPORTACION).map((c) => {
      const vendedor = apoyo.vendedores.get(c.vendedorId)
      const ajustes = c.ajustes.reduce((t, a) => t + Number(a.monto), 0)
      return {
        fecha: fecha(c.createdAt),
        vendedor: vendedor?.nombre ?? 'Vendedor',
        vendedorCodigo: vendedor?.codigo ?? null,
        venta: c.venta?.numero ?? null,
        desglose: c.desglose,
        base: Number(c.base),
        monto: Number(c.monto),
        ajustes: centavos(ajustes),
        neto: netoComision(Number(c.monto), c.ajustes.map((a) => ({ monto: Number(a.monto) }))),
        moneda: c.moneda,
        estado: c.estado,
        liquidacion: c.liquidacion?.numero ?? null,
      }
    }),
  }
}

export async function liquidacionesDelPeriodo(
  companyId: string,
  rango: Rango,
  fecha: (d: Date | null) => string,
  filtros: ReporteFiltros = {}
): Promise<{ filas: FilaLiquidacion[]; total: number }> {
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

  const effectiveVendedorCondition =
    filtros.vendedorId && filtros.vendedorId !== 'TODOS'
      ? { vendedorId: filtros.vendedorId }
      : matchingVendedorIds
        ? { vendedorId: { in: matchingVendedorIds } }
        : {}

  const liquidaciones = await conEmpresa(companyId, (tx) =>
    tx.liquidacion.findMany({
      where: {
        companyId,
        createdAt: { gte: rango.desde, lte: rango.hasta },
        ...effectiveVendedorCondition,
        ...(filtros.estado && filtros.estado !== 'TODOS' ? { estado: filtros.estado } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: LIMITE,
      select: {
        numero: true,
        vendedorId: true,
        periodoDesde: true,
        periodoHasta: true,
        total: true,
        moneda: true,
        estado: true,
        metodo: true,
        referencia: true,
        pagadaAt: true,
        _count: { select: { comisiones: true } },
      },
    })
  )
  const apoyo = await nombres(companyId, {
    clientes: [],
    excursiones: [],
    vendedores: liquidaciones.map((l) => l.vendedorId),
  })
  return {
    total: liquidaciones.length,
    filas: liquidaciones.slice(0, TOPE_EXPORTACION).map((l) => {
      const vendedor = apoyo.vendedores.get(l.vendedorId)
      return {
        numero: l.numero,
        vendedor: vendedor?.nombre ?? 'Vendedor',
        vendedorCodigo: vendedor?.codigo ?? null,
        desde: fecha(l.periodoDesde),
        hasta: fecha(l.periodoHasta),
        comisiones: l._count.comisiones,
        total: Number(l.total),
        moneda: l.moneda,
        estado: l.estado,
        metodo: l.metodo,
        referencia: l.referencia,
        pagada: fecha(l.pagadaAt),
      }
    }),
  }
}
