import { conEmpresa } from '@/lib/tenant'
import { netoComision } from '@/modules/excursiones/comisiones/nucleo'

/** Liquidaciones de la empresa con el nombre de a quién se le pagó. */
export async function listadoLiquidaciones(companyId: string) {
  const liquidaciones = await conEmpresa(companyId, (tx) =>
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
  )
  if (liquidaciones.length === 0) return []

  const vendedores = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findMany({
      where: { id: { in: [...new Set(liquidaciones.map((l) => l.vendedorId))] }, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true },
    })
  )
  const porId = new Map(vendedores.map((v) => [v.id, v]))

  return liquidaciones.map((l) => {
    const v = porId.get(l.vendedorId)
    return {
      id: l.id,
      numero: l.numero,
      vendedor: v ? `${v.nombre} ${v.apellido ?? ''}`.trim() : 'Vendedor',
      vendedorCodigo: v?.codigo ?? null,
      periodoDesde: l.periodoDesde,
      periodoHasta: l.periodoHasta,
      total: Number(l.total),
      moneda: l.moneda,
      estado: l.estado,
      pagadaAt: l.pagadaAt,
      comisiones: l._count.comisiones,
    }
  })
}

/** El recibo: la liquidación con cada comisión que la compone. */
export async function liquidacionDetalle(companyId: string, liquidacionId: string) {
  const liquidacion = await conEmpresa(companyId, (tx) =>
    tx.liquidacion.findFirst({
      where: { id: liquidacionId, companyId },
      include: {
        comisiones: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            base: true,
            monto: true,
            desglose: true,
            estado: true,
            createdAt: true,
            ajustes: { select: { monto: true, motivo: true } },
            venta: { select: { numero: true } },
          },
        },
      },
    })
  )
  if (!liquidacion) return null

  const vendedor = await conEmpresa(companyId, (tx) =>
    tx.vendedor.findFirst({
      where: { id: liquidacion.vendedorId, companyId },
      select: { id: true, nombre: true, apellido: true, codigo: true, telefono: true },
    })
  )

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
    lineas: liquidacion.comisiones.map((c) => ({
      id: c.id,
      venta: c.venta?.numero ?? '—',
      desglose: c.desglose,
      estado: c.estado,
      createdAt: c.createdAt,
      monto: Number(c.monto),
      neto: netoComision(
        Number(c.monto),
        c.ajustes.map((a) => ({ monto: Number(a.monto) }))
      ),
      ajustes: c.ajustes.map((a) => ({ monto: Number(a.monto), motivo: a.motivo })),
    })),
  }
}

/**
 * Vendedores con comisiones aprobadas sin liquidar, y cuánto se les debe. Es
 * lo primero que quiere ver quien va a pagar: a quién y cuánto.
 */
export async function vendedoresPorLiquidar(companyId: string) {
  const pendientes = await conEmpresa(companyId, (tx) =>
    tx.comisionEntrada.findMany({
      where: {
        companyId,
        liquidacionId: null,
        estado: { in: ['APROBADA', 'PENDIENTE_PAGO'] },
      },
      select: {
        vendedorId: true,
        monto: true,
        moneda: true,
        ajustes: { select: { monto: true } },
      },
    })
  )
  if (pendientes.length === 0) return []

  const acumulado = new Map<string, { total: number; cantidad: number; moneda: string }>()
  for (const c of pendientes) {
    const neto = netoComision(
      Number(c.monto),
      c.ajustes.map((a) => ({ monto: Number(a.monto) }))
    )
    if (neto <= 0) continue
    const previo = acumulado.get(c.vendedorId) ?? { total: 0, cantidad: 0, moneda: c.moneda }
    acumulado.set(c.vendedorId, {
      total: Math.round((previo.total + neto) * 100) / 100,
      cantidad: previo.cantidad + 1,
      moneda: previo.moneda,
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
        moneda: datos.moneda,
      }
    })
    .sort((a, b) => b.total - a.total)
}
