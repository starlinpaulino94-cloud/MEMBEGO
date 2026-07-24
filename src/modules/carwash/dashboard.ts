import { prisma } from '@/lib/prisma'
import { getCitasDia } from '@/modules/citas/queries'
import { utcDesdeLocal, ymdEnTz, sumarDias } from '@/modules/citas/disponibilidad'
import { getSeguimiento } from '@/modules/seguimiento/queries'
import { getSeguimientoConfig } from '@/modules/seguimiento/config'

/**
 * App Car Wash · E3 — datos del DASHBOARD OPERATIVO del día
 * (docs/ESTRATEGIA-PLATAFORMA.md). Todo se arma con consultas/motores que ya
 * existen: citas (módulo citas), canjes y ventas (Transaction Engine) y
 * recompensas por vencer (módulo seguimiento). Nada de esquema nuevo.
 */

export interface OperacionReciente {
  id: string
  codigo: string
  tipo: string
  cliente: string | null
  detalle: string | null
  monto: number | null
  fecha: Date
}

export interface DashboardOperativo {
  /** YMD del día en la zona horaria del negocio. */
  hoy: string
  citas: Awaited<ReturnType<typeof getCitasDia>>
  citasActivas: number
  canjesHoy: number
  ventasHoyMonto: number
  ventasHoyCount: number
  recompensasSinUsar: number
  recompensasPorVencer: number
  ultimas: OperacionReciente[]
}

const CITA_ACTIVA = ['PENDIENTE', 'CONFIRMADA']

export async function getDashboardOperativo(
  companyId: string,
  timeZone: string
): Promise<DashboardOperativo> {
  const hoy = ymdEnTz(new Date(), timeZone)
  const inicioDia = utcDesdeLocal(hoy, '00:00', timeZone)
  const finDia = utcDesdeLocal(sumarDias(hoy, 1), '00:00', timeZone)

  const [citas, canjesHoy, ventas, ultimasRaw, seguimiento] = await Promise.all([
    getCitasDia(companyId, hoy, timeZone).catch(() => []),
    prisma.transaction
      .count({
        where: {
          companyId,
          tipo: 'PROMOTION_USE',
          estado: 'APPLIED',
          createdAt: { gte: inicioDia, lt: finDia },
        },
      })
      .catch(() => 0),
    prisma.transaction
      .aggregate({
        where: {
          companyId,
          tipo: 'SALE',
          estado: 'APPLIED',
          createdAt: { gte: inicioDia, lt: finDia },
        },
        _sum: { monto: true },
        _count: { _all: true },
      })
      .catch(() => null),
    prisma.transaction
      .findMany({
        where: {
          companyId,
          estado: 'APPLIED',
          createdAt: { gte: inicioDia, lt: finDia },
        },
        select: {
          id: true,
          codigo: true,
          tipo: true,
          monto: true,
          createdAt: true,
          snapshot: true,
          cliente: { select: { nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      })
      .catch(() => []),
    getSeguimientoConfig(companyId)
      .then((config) => getSeguimiento(companyId, {}, config, 1))
      .catch(() => null),
  ])

  const ultimas: OperacionReciente[] = ultimasRaw.map((t) => {
    const snap = (t.snapshot ?? {}) as { promocion?: unknown; servicio?: unknown }
    const detalle =
      (typeof snap.promocion === 'string' && snap.promocion) ||
      (typeof snap.servicio === 'string' && snap.servicio) ||
      null
    return {
      id: t.id,
      codigo: t.codigo,
      tipo: t.tipo,
      cliente: t.cliente?.nombre ?? null,
      detalle,
      monto: t.monto != null ? Number(t.monto) : null,
      fecha: t.createdAt,
    }
  })

  return {
    hoy,
    citas,
    citasActivas: citas.filter((c) => CITA_ACTIVA.includes(c.estado)).length,
    canjesHoy,
    ventasHoyMonto: ventas?._sum.monto != null ? Number(ventas._sum.monto) : 0,
    ventasHoyCount: ventas?._count._all ?? 0,
    recompensasSinUsar: seguimiento?.kpis.sinUsar ?? 0,
    recompensasPorVencer: seguimiento?.kpis.porVencer ?? 0,
    ultimas,
  }
}
