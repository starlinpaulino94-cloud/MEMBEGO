import { prisma } from '@/lib/prisma'
import { conEmpresa, type Tx } from '@/lib/tenant'
import { netoComision } from '@/modules/excursiones/comisiones/nucleo'
import { paginasDe, resumirSaldos, type GrupoSaldo } from './saldos'
import { calcularSaldo } from '@/modules/excursiones/reservas/nucleo'
import { getExcursionesConfig, obtenerDetalleConversion } from '../config'

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
 * Lo que se le debe y lo que ya cobró: la SUMA, hecha por la base de datos, de
 * TODAS sus comisiones vivas — no hay contador guardado que se pueda
 * desincronizar, y tampoco hay tope de filas (auditoría admin · D-02).
 *
 * Una fila por estado de pago y moneda: el neto de cada comisión es su monto
 * más sus ajustes firmados sin bajar de cero (`netoComision`, la misma regla),
 * y `ANULADA` no cuenta. Se ejecuta con el `tx` que ya está abierto.
 */
async function gruposDeSaldo(tx: Tx, companyId: string, vendedorId: string): Promise<GrupoSaldo[]> {
  const filas = await tx.$queryRaw<{ pagada: boolean; moneda: string; neto: number; lineas: bigint }[]>`
    SELECT (c."estado" = 'PAGADA') AS "pagada",
           c."moneda" AS "moneda",
           COALESCE(SUM(GREATEST(0, c."monto" + COALESCE(a."suma", 0))), 0)::float8 AS "neto",
           COUNT(*)::bigint AS "lineas"
    FROM "comision_entradas" c
    LEFT JOIN LATERAL (
      SELECT SUM(x."monto") AS "suma" FROM "comision_ajustes" x WHERE x."comisionId" = c."id"
    ) a ON TRUE
    WHERE c."companyId" = ${companyId}
      AND c."vendedorId" = ${vendedorId}
      AND c."estado" <> 'ANULADA'
    GROUP BY 1, 2
  `
  return filas.map((f) => ({ pagada: f.pagada, moneda: f.moneda, neto: Number(f.neto), lineas: Number(f.lineas) }))
}

/** Solo los saldos (sin lista): para el Inicio, que no pinta comisiones. */
export async function misSaldos(companyId: string, vendedorId: string) {
  const [grupos, config] = await Promise.all([
    conEmpresa(companyId, (tx) => gruposDeSaldo(tx, companyId, vendedorId)),
    getExcursionesConfig(companyId),
  ])
  const { monedaDefecto, tasasCambio } = config
  return { moneda: monedaDefecto, ...resumirSaldos(grupos, monedaDefecto, tasasCambio) }
}

/** Comisiones por página de la lista. Los saldos NO dependen de este número. */
export const COMISIONES_POR_PAGINA = 200

export async function misComisiones(
  companyId: string,
  vendedorId: string,
  opciones: { pagina?: number } = {}
) {
  const [{ comisiones, grupos, pagina }, config] = await Promise.all([
    conEmpresa(companyId, async (tx) => {
      const grupos = await gruposDeSaldo(tx, companyId, vendedorId)
      const total = grupos.reduce((t, g) => t + (g.lineas ?? 0), 0)
      const pagina = Math.min(
        Math.max(1, Math.trunc(opciones.pagina ?? 1) || 1),
        paginasDe(total, COMISIONES_POR_PAGINA)
      )
      const comisiones = await tx.comisionEntrada.findMany({
        where: { companyId, vendedorId, estado: { not: 'ANULADA' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * COMISIONES_POR_PAGINA,
        take: COMISIONES_POR_PAGINA,
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
      return { comisiones, grupos, pagina }
    }),
    getExcursionesConfig(companyId),
  ])

  const { monedaDefecto, tasasCambio } = config
  const total = grupos.reduce((t, g) => t + (g.lineas ?? 0), 0)

  const lineas = comisiones.map((c) => {
    const netoOrig = netoComision(
      Number(c.monto),
      c.ajustes.map((a) => ({ monto: Number(a.monto) }))
    )
    const conv = obtenerDetalleConversion(netoOrig, c.moneda, monedaDefecto, tasasCambio)
    return {
      id: c.id,
      neto: conv.montoConvertido,
      moneda: monedaDefecto,
      netoOriginal: netoOrig,
      monedaOriginal: c.moneda,
      conversion: conv,
      desglose: c.desglose,
      estado: c.estado,
      createdAt: c.createdAt,
      venta: c.venta?.numero ?? '—',
      liquidacion: c.liquidacion?.numero ?? null,
    }
  })

  return {
    lineas,
    moneda: monedaDefecto,
    // Los saldos salen de la agregación completa, NO de `lineas` (que es una página).
    ...resumirSaldos(grupos, monedaDefecto, tasasCambio),
    tasasCambio,
    total,
    pagina,
    paginas: paginasDe(total, COMISIONES_POR_PAGINA),
    porPagina: COMISIONES_POR_PAGINA,
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
