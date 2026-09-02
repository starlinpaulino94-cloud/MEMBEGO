import { conEmpresa } from '@/lib/tenant'
import { getExcursionesConfig, convertirMoneda, obtenerDetalleConversion, type DetalleConversionMoneda } from '../config'
import { netoComision } from '@/modules/excursiones/comisiones/nucleo'

/** Liquidaciones de la empresa con el nombre de a quién se le pagó. */
export async function listadoLiquidaciones(companyId: string) {
  const [liquidaciones, config] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.liquidacion.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          numero: true,
          vendedorId: true,
          periodoDesde: true,
          periodoHasta: true,
          total: true,
          moneda: true,
          estado: true,
          pagadaAt: true,
          _count: { select: { comisiones: true } },
        },
      })
    ),
    getExcursionesConfig(companyId),
  ])
  if (liquidaciones.length === 0) return []

  const vendedores = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { id: { in: [...new Set(liquidaciones.map((l) => l.vendedorId))] }, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )
  const porId = new Map(vendedores.map((v) => [v.id, v]))
  const { monedaDefecto, tasasCambio } = config

  return liquidaciones.map((l) => {
    const v = porId.get(l.vendedorId)
    return {
      id: l.id,
      numero: l.numero,
      vendedorId: l.vendedorId,
      vendedor: v ? `${v.nombre} ${v.apellido ?? ''}`.trim() : 'Vendedor',
      vendedorCodigo: v?.codigo ?? null,
      periodoDesde: l.periodoDesde,
      periodoHasta: l.periodoHasta,
      total: convertirMoneda(Number(l.total), l.moneda, monedaDefecto, tasasCambio),
      moneda: monedaDefecto,
      estado: l.estado,
      pagadaAt: l.pagadaAt,
      comisiones: l._count.comisiones,
    }
  })
}

/** El recibo: la liquidación con cada comisión que la compone. */
export async function liquidacionDetalle(companyId: string, liquidacionId: string) {
  const [liquidacion, bonosDb, config] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.liquidacion.findFirst({
        where: { id: liquidacionId, companyId },
        include: {
          comisiones: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              base: true,
              monto: true,
              moneda: true,
              reglaSnapshot: true,
              desglose: true,
              estado: true,
              createdAt: true,
              ajustes: { select: { monto: true, motivo: true } },
              venta: { select: { numero: true } },
            },
          },
        },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.vendedorBono.findMany({
        where: { liquidacionId, companyId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          descripcion: true,
          monto: true,
          moneda: true,
          estado: true,
          createdAt: true,
        },
      })
    ),
    getExcursionesConfig(companyId),
  ])
  if (!liquidacion) return null

  const vendedor = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findFirst({
      where: { id: liquidacion.vendedorId, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true, telefono: true },
    })
  )

  const lineas = liquidacion.comisiones.map((c) => {
    const ajustes = c.ajustes.map((a) => ({ monto: Number(a.monto), motivo: a.motivo }))
    const netoOrig = netoComision(
      Number(c.monto),
      c.ajustes.map((a) => ({ monto: Number(a.monto) }))
    )
    const conv = obtenerDetalleConversion(netoOrig, c.moneda, liquidacion.moneda, config.tasasCambio)
    const snapshot = c.reglaSnapshot as { tipoCalculo?: string } | null
    const tipoCalculo = snapshot?.tipoCalculo ?? 'PORCENTAJE'

    return {
      id: c.id,
      venta: c.venta?.numero ?? '—',
      tipoCalculo,
      desglose: c.desglose,
      estado: c.estado,
      createdAt: c.createdAt,
      monedaOriginal: c.moneda,
      montoOriginal: Number(c.monto),
      netoOriginal: netoOrig,
      conversion: conv,
      monto: conv.montoConvertido,
      neto: conv.montoConvertido,
      ajustes,
    }
  })

  const bonos = bonosDb.map((b) => {
    const conv = obtenerDetalleConversion(Number(b.monto), b.moneda, liquidacion.moneda, config.tasasCambio)
    return {
      id: b.id,
      descripcion: b.descripcion,
      monedaOriginal: b.moneda,
      montoOriginal: Number(b.monto),
      monto: conv.montoConvertido,
      moneda: liquidacion.moneda,
      estado: b.estado,
      createdAt: b.createdAt,
    }
  })

  const { resumenRemuneracionLiquidacion } = await import('./nucleo')
  const resumenRemuneracion = resumenRemuneracionLiquidacion(lineas, bonos)

  const comisionesConConversion = lineas.filter((l) => l.conversion.esConversion).length
  const tasasUsadas = [...new Set(lineas.filter((l) => l.conversion.esConversion).map((l) => l.conversion.tasaLabel))]

  return {
    liquidacion,
    vendedor: vendedor
      ? {
          id: vendedor.id,
          nombre: `${vendedor.nombre} ${vendedor.apellido ?? ''}`.trim(),
          codigo: vendedor.codigo,
          telefono: vendedor.telefono,
        }
      : null,
    lineas,
    bonos,
    resumenRemuneracion,
    comisionesConConversion,
    tasasUsadas,
  }
}

/**
 * Vendedores con comisiones aprobadas o bonos sin liquidar, y cuánto se les debe.
 */
export async function vendedoresPorLiquidar(companyId: string) {
  const [pendientes, bonosPendientes, config] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.findMany({
        where: {
          companyId,
          liquidacionId: null,
          estado: 'APROBADA',
        },
        select: {
          vendedorId: true,
          monto: true,
          moneda: true,
          createdAt: true,
          reglaSnapshot: true,
          ajustes: { select: { monto: true } },
        },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.vendedorBono.findMany({
        where: {
          companyId,
          liquidacionId: null,
          estado: 'OTORGADO',
        },
        select: {
          vendedorId: true,
          monto: true,
          moneda: true,
          createdAt: true,
        },
      })
    ),
    getExcursionesConfig(companyId),
  ])
  if (pendientes.length === 0 && bonosPendientes.length === 0) return []

  const { monedaDefecto, tasasCambio } = config
  const acumulado = new Map<
    string,
    { total: number; cantidad: number; minDate: Date; maxDate: Date }
  >()

  // Comisiones aprobadas
  for (const c of pendientes) {
    const snapshot = c.reglaSnapshot as { tipoCalculo?: string } | null
    const esEspecie = snapshot?.tipoCalculo === 'PAQUETE_REGALO'

    const neto = netoComision(
      Number(c.monto),
      c.ajustes.map((a) => ({ monto: Number(a.monto) }))
    )
    if (neto <= 0 && !esEspecie) continue

    // Beneficios en especie no inflan la transferencia en dinero
    const convertido = esEspecie
      ? 0
      : convertirMoneda(neto, c.moneda, monedaDefecto, tasasCambio)

    const previo = acumulado.get(c.vendedorId)
    const minDate = previo
      ? c.createdAt < previo.minDate
        ? c.createdAt
        : previo.minDate
      : c.createdAt
    const maxDate = previo
      ? c.createdAt > previo.maxDate
        ? c.createdAt
        : previo.maxDate
      : c.createdAt
    acumulado.set(c.vendedorId, {
      total: Math.round(((previo?.total ?? 0) + convertido) * 100) / 100,
      cantidad: (previo?.cantidad ?? 0) + 1,
      minDate,
      maxDate,
    })
  }

  // Bonos por metas otorgados
  for (const b of bonosPendientes) {
    const montoBono = Number(b.monto) || 0
    if (montoBono <= 0) continue
    const convertido = convertirMoneda(montoBono, b.moneda, monedaDefecto, tasasCambio)
    const previo = acumulado.get(b.vendedorId)
    const minDate = previo
      ? b.createdAt < previo.minDate
        ? b.createdAt
        : previo.minDate
      : b.createdAt
    const maxDate = previo
      ? b.createdAt > previo.maxDate
        ? b.createdAt
        : previo.maxDate
      : b.createdAt
    acumulado.set(b.vendedorId, {
      total: Math.round(((previo?.total ?? 0) + convertido) * 100) / 100,
      cantidad: (previo?.cantidad ?? 0) + 1,
      minDate,
      maxDate,
    })
  }

  if (acumulado.size === 0) return []

  const vendedores = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { id: { in: [...acumulado.keys()] }, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )

  return vendedores
    .map((v) => {
      const datos = acumulado.get(v.id)!
      return {
        id: v.id,
        nombre: `${v.nombre} ${v.apellido ?? ''}`.trim(),
        codigo: v.codigo,
        total: datos.total,
        cantidad: datos.cantidad,
        moneda: monedaDefecto,
        fechaMasVieja: datos.minDate.toISOString().slice(0, 10),
        fechaMasReciente: datos.maxDate.toISOString().slice(0, 10),
      }
    })
    .sort((a, b) => b.total - a.total)
}
