import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { clasificarProveedor, type ClaseDeProveedor } from './acceso-dominio'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · el scorecard del proveedor (§46–§47).
 *
 * Números para que Membego converse con el proveedor; NUNCA una nota ni una
 * sanción automática (§49). Todo sale de lo que ya existe: redenciones,
 * incidencias, visitas, ventas adicionales, confirmaciones y disputas.
 */
export interface FilaDeScorecard {
  supplierId: string
  proveedor: string
  companyId: string | null
  clase: ClaseDeProveedor
  accessStatus: string
  ventanaDias: number
  redenciones: number
  reversadas: number
  incidencias: number
  visitas: number
  visitasConExtras: number
  ventasAdicionales: number
  extrasTotal: string
  comisionTotal: string
  confirmadasPorCliente: number
  disputas: number
  disputasAFavorDelCliente: number
  /** Minutos promedio entre abrir y cerrar la visita (solo cerradas por el operador). */
  minutosPromedioDeVisita: number | null
  /** Fracción de visitas cerradas con extras (0–1), o null sin visitas. */
  tasaDeExtras: number | null
  /** Fracción de ventas confirmadas por el cliente (0–1), o null sin ventas. */
  tasaDeConfirmacion: number | null
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))

export async function scorecardDeProveedoresEnTx(tx: Tx, dias = 30, ahora = new Date()): Promise<FilaDeScorecard[]> {
  const desde = new Date(ahora.getTime() - dias * 86_400_000)
  const proveedores = await tx.supplyV2Supplier.findMany({
    where: { companyId: { not: null } },
    orderBy: { commercialName: 'asc' },
    select: { id: true, commercialName: true, companyId: true, status: true, accessStatus: true, readinessWaivedAt: true, fulfillmentReadyAt: true },
  })
  if (proveedores.length === 0) return []
  const ids = proveedores.map((p) => p.id)

  const redenciones = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT r."supplierId" AS "supplierId",
           count(*)::int AS redenciones,
           count(*) FILTER (WHERE r."reversedAt" IS NOT NULL)::int AS reversadas
      FROM "supply_v2_redemptions" r
     WHERE r."supplierId" IN (${Prisma.join(ids)}) AND r."redeemedAt" >= ${desde}
     GROUP BY r."supplierId"`
  const incidencias = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT i."supplierId" AS "supplierId", count(*)::int AS incidencias
      FROM "supply_v2_redemption_incidents" i
     WHERE i."supplierId" IN (${Prisma.join(ids)}) AND i."createdAt" >= ${desde}
     GROUP BY i."supplierId"`
  const visitas = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT v."supplierId" AS "supplierId",
           count(*)::int AS visitas,
           count(*) FILTER (WHERE v."ancillaryTotal" > 0)::int AS "visitasConExtras",
           coalesce(sum(v."ancillaryTotal"), 0) AS "extrasTotal",
           coalesce(sum(v."commissionTotal"), 0) AS "comisionTotal",
           avg(EXTRACT(EPOCH FROM (v."closedAt" - v."openedAt")) / 60) FILTER (WHERE v."closedAt" IS NOT NULL AND v."closedByUserId" IS NOT NULL) AS "minutosPromedio"
      FROM "membego_visits" v
     WHERE v."supplierId" IN (${Prisma.join(ids)}) AND v."openedAt" >= ${desde}
     GROUP BY v."supplierId"`
  const ventas = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT v."supplierId" AS "supplierId",
           count(s.*)::int AS ventas,
           count(s.*) FILTER (WHERE s."customerConfirmedAt" IS NOT NULL)::int AS confirmadas,
           (SELECT count(*) FROM "visit_disputes" d WHERE d."visitId" = ANY(array_agg(v."id")))::int AS disputas,
           (SELECT count(*) FROM "visit_disputes" d WHERE d."visitId" = ANY(array_agg(v."id")) AND d."status" = 'RESOLVED_CUSTOMER')::int AS "disputasAFavorDelCliente"
      FROM "membego_visits" v
      JOIN "ancillary_sales" s ON s."visitId" = v."id" AND s."status" <> 'REVERSED'
     WHERE v."supplierId" IN (${Prisma.join(ids)}) AND v."openedAt" >= ${desde}
     GROUP BY v."supplierId"`

  const por = <T extends Record<string, unknown>>(filas: T[]) => new Map(filas.map((f) => [String(f.supplierId), f]))
  const R = por(redenciones), I = por(incidencias), V = por(visitas), S = por(ventas)

  return proveedores.map((p) => {
    const r = R.get(p.id), i = I.get(p.id), v = V.get(p.id), s = S.get(p.id)
    const nVisitas = num(v?.visitas)
    const nVentas = num(s?.ventas)
    const min = v?.minutosPromedio == null ? null : Number(v.minutosPromedio)
    return {
      supplierId: p.id,
      proveedor: p.commercialName,
      companyId: p.companyId,
      clase: clasificarProveedor(p),
      accessStatus: p.accessStatus,
      ventanaDias: dias,
      redenciones: num(r?.redenciones),
      reversadas: num(r?.reversadas),
      incidencias: num(i?.incidencias),
      visitas: nVisitas,
      visitasConExtras: num(v?.visitasConExtras),
      ventasAdicionales: nVentas,
      extrasTotal: Number(v?.extrasTotal ?? 0).toFixed(2),
      comisionTotal: Number(v?.comisionTotal ?? 0).toFixed(2),
      confirmadasPorCliente: num(s?.confirmadas),
      disputas: num(s?.disputas),
      disputasAFavorDelCliente: num(s?.disputasAFavorDelCliente),
      minutosPromedioDeVisita: min == null || Number.isNaN(min) ? null : Math.round(min),
      tasaDeExtras: nVisitas > 0 ? num(v?.visitasConExtras) / nVisitas : null,
      tasaDeConfirmacion: nVentas > 0 ? num(s?.confirmadas) / nVentas : null,
    }
  })
}

/** El embudo de la plataforma (§52–§53): canje → visita → con extras → confirmada → disputada. */
export interface EmbudoDeVisitas {
  ventanaDias: number
  redenciones: number
  visitas: number
  cerradas: number
  conExtras: number
  ventas: number
  confirmadas: number
  disputadas: number
  extrasTotal: string
  comisionTotal: string
}

export async function embudoDeVisitasEnTx(tx: Tx, dias = 30, ahora = new Date()): Promise<EmbudoDeVisitas> {
  const desde = new Date(ahora.getTime() - dias * 86_400_000)
  const [redenciones, visitas, cerradas, conExtras, ventas, confirmadas, disputadas, agregados] = await Promise.all([
    tx.supplyV2Redemption.count({ where: { redeemedAt: { gte: desde } } }),
    tx.membegoVisit.count({ where: { openedAt: { gte: desde } } }),
    tx.membegoVisit.count({ where: { openedAt: { gte: desde }, status: 'CLOSED' } }),
    tx.membegoVisit.count({ where: { openedAt: { gte: desde }, ancillaryTotal: { gt: 0 } } }),
    tx.ancillarySale.count({ where: { reportedAt: { gte: desde }, status: { not: 'REVERSED' } } }),
    tx.ancillarySale.count({ where: { reportedAt: { gte: desde }, status: { not: 'REVERSED' }, customerConfirmedAt: { not: null } } }),
    tx.visitDispute.count({ where: { openedAt: { gte: desde } } }),
    tx.membegoVisit.aggregate({ where: { openedAt: { gte: desde } }, _sum: { ancillaryTotal: true, commissionTotal: true } }),
  ])
  return { ventanaDias: dias, redenciones, visitas, cerradas, conExtras, ventas, confirmadas, disputadas, extrasTotal: (agregados._sum.ancillaryTotal ?? 0).toFixed(2), comisionTotal: (agregados._sum.commissionTotal ?? 0).toFixed(2) }
}
