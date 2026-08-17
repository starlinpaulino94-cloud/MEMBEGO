import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { netoComision } from '@/modules/excursiones/comisiones/nucleo'
import { calcularSaldo } from '@/modules/excursiones/reservas/nucleo'

/**
 * EXCURSIONES · Panel del vendedor — lecturas.
 *
 * TODAS las consultas de este archivo arrancan del VENDEDOR resuelto desde la
 * sesión, nunca de un id que venga de la pantalla. El vendedor no elige a quién
 * mira: la sesión decide, y por eso no hay forma de pedir los datos de otro
 * cambiando un parámetro (regla permanente: ningún filtro del navegador es una
 * autorización).
 */

/** El vendedor detrás de esta sesión, o null si esa cuenta no es de nadie. */
export async function vendedorDeUsuario(dbUserId: string) {
  const vendedor = await prisma.vendedor
    .findFirst({
      where: { userId: dbUserId },
      select: {
        id: true,
        companyId: true,
        nombre: true,
        apellido: true,
        codigo: true,
        estado: true,
        enlaces: { orderBy: { createdAt: 'asc' }, take: 1, select: { slug: true } },
      },
    })
    .catch(() => null)
  if (!vendedor || vendedor.estado !== 'ACTIVO') return null

  const empresa = await prisma.company
    .findUnique({
      where: { id: vendedor.companyId },
      select: { name: true, isActive: true, logoUrl: true },
    })
    .catch(() => null)
  if (!empresa?.isActive) return null

  return {
    id: vendedor.id,
    companyId: vendedor.companyId,
    nombre: `${vendedor.nombre} ${vendedor.apellido ?? ''}`.trim(),
    primerNombre: vendedor.nombre,
    codigo: vendedor.codigo,
    slug: vendedor.enlaces[0]?.slug ?? null,
    empresa: empresa.name,
    logoUrl: empresa.logoUrl,
  }
}

/** Su embudo: cuántos trajo y hasta dónde llegaron. */
export async function miEmbudo(companyId: string, vendedorId: string) {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.vendedorAtribucion.groupBy({
      by: ['etapa'],
      where: { companyId, vendedorId },
      _count: { _all: true },
    })
  )
  const porEtapa = new Map(filas.map((f) => [f.etapa, f._count._all]))
  return {
    visitas: porEtapa.get('VISITA') ?? 0,
    registros: porEtapa.get('REGISTRO') ?? 0,
    reservas: porEtapa.get('RESERVA') ?? 0,
    compras: porEtapa.get('COMPRA') ?? 0,
  }
}

/**
 * Sus reservas. Se muestran los datos de la operación —cliente, excursión,
 * fecha, total y saldo— porque son las suyas: las trajo él y necesita saber a
 * quién llamar y cuánto falta por cobrar. No hay forma de ver las de otro.
 */
export async function misReservas(companyId: string, vendedorId: string) {
  const reservas = await conEmpresa(companyId, (tx) =>
    tx.reservaExc.findMany({
      where: { companyId, vendedorId },
      orderBy: [{ fecha: 'desc' }],
      take: 100,
      select: {
        id: true,
        numero: true,
        fecha: true,
        adultos: true,
        ninos: true,
        total: true,
        moneda: true,
        estado: true,
        clienteId: true,
        excursionId: true,
        pagos: { select: { monto: true, estado: true } },
      },
    })
  )
  if (reservas.length === 0) return []

  const [clientes, excursiones] = await Promise.all([
    conEmpresa(companyId, (tx) =>
      tx.cliente.findMany({
        where: { id: { in: [...new Set(reservas.map((r) => r.clienteId))] }, companyId },
        select: { id: true, nombre: true },
      })
    ),
    conEmpresa(companyId, (tx) =>
      tx.excursion.findMany({
        where: { id: { in: [...new Set(reservas.map((r) => r.excursionId))] }, companyId },
        select: { id: true, nombre: true },
      })
    ),
  ])
  const porCliente = new Map(clientes.map((c) => [c.id, c.nombre]))
  const porExcursion = new Map(excursiones.map((e) => [e.id, e.nombre]))

  return reservas.map((r) => {
    const total = Number(r.total)
    const { saldo } = calcularSaldo(
      total,
      r.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
    )
    return {
      id: r.id,
      numero: r.numero,
      fecha: r.fecha,
      pasajeros: r.adultos + r.ninos,
      total,
      saldo,
      moneda: r.moneda,
      estado: r.estado,
      cliente: porCliente.get(r.clienteId) ?? 'Cliente',
      excursion: porExcursion.get(r.excursionId) ?? '—',
    }
  })
}

/**
 * Lo que se le debe y lo que ya cobró. Los números salen de sumar sus
 * comisiones vivas — no hay contador guardado que se pueda desincronizar.
 */
export async function misComisiones(companyId: string, vendedorId: string) {
  const comisiones = await conEmpresa(companyId, (tx) =>
    tx.comisionEntrada.findMany({
      where: { companyId, vendedorId, estado: { not: 'ANULADA' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        monto: true,
        moneda: true,
        desglose: true,
        estado: true,
        createdAt: true,
        ajustes: { select: { monto: true } },
        venta: { select: { numero: true } },
        liquidacion: { select: { numero: true, estado: true } },
      },
    })
  )

  const lineas = comisiones.map((c) => ({
    id: c.id,
    neto: netoComision(
      Number(c.monto),
      c.ajustes.map((a) => ({ monto: Number(a.monto) }))
    ),
    moneda: c.moneda,
    desglose: c.desglose,
    estado: c.estado,
    createdAt: c.createdAt,
    venta: c.venta?.numero ?? '—',
    liquidacion: c.liquidacion?.numero ?? null,
  }))

  const suma = (filtro: (l: (typeof lineas)[number]) => boolean) =>
    Math.round(lineas.filter(filtro).reduce((t, l) => t + l.neto, 0) * 100) / 100

  return {
    lineas,
    moneda: lineas[0]?.moneda ?? 'DOP',
    porCobrar: suma((l) => l.estado !== 'PAGADA'),
    cobrado: suma((l) => l.estado === 'PAGADA'),
  }
}

/** Sus liquidaciones: qué se le pagó, cuándo y por cuánto. */
export async function misLiquidaciones(companyId: string, vendedorId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.liquidacion.findMany({
      where: { companyId, vendedorId, estado: { not: 'ANULADA' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        numero: true,
        periodoDesde: true,
        periodoHasta: true,
        total: true,
        moneda: true,
        estado: true,
        pagadaAt: true,
      },
    })
  )
}
