import { conEmpresa } from '@/lib/tenant'
import { Prisma, type MarketingCampaignTipo } from '@prisma/client'
import { reclamosPosibles } from '@/modules/deals/domain'
import { finDeVentanaCampana } from './ventana-campana'

/**
 * Engagement Engine · Fase 2 — Motor de Campañas.
 *
 * Resuelve qué campañas de marketing están VIVAS ahora mismo para el Home del
 * cliente: dentro de su ventana de fechas y —para Happy Hour / fin de semana—
 * dentro de su ventana horaria y días de la semana (hora local de RD, UTC-4).
 */

export interface CampanaViva {
  id: string
  dealId: string | null
  tipo: MarketingCampaignTipo
  titulo: string
  descripcion: string
  bannerUrl: string | null
  imagenUrl: string | null
  ctaTexto: string | null
  ctaHref: string | null
  colorPrimario: string | null
  colorSecundario: string | null
  destacada: boolean
  /** Instante ISO en que termina (para el contador). */
  terminaEn: string
  /** Cupones restantes (urgencia); null = sin límite. */
  cuposRestantes: number | null
  /** Cupones ya reclamados (prueba social); 0 si nadie aún. */
  reclamados: number
}

interface RendimientoCampana {
  reclamosAtribuidos: number
  canjesAtribuidos: number
}

async function rendimientoAtribuido(companyId: string, campaignIds: string[]) {
  const resultado = new Map<string, RendimientoCampana>()
  if (campaignIds.length === 0) return resultado

  const filas = await conEmpresa(companyId, (tx) =>
    tx.$queryRaw<Array<{ campaignId: string; reclamos: bigint; canjes: bigint }>>`
      SELECT oa."campaignId" AS "campaignId",
             COUNT(*) AS reclamos,
             COUNT(*) FILTER (WHERE dc."status" = 'REDEEMED') AS canjes
        FROM "order_attributions" oa
        JOIN "deal_claims" dc
          ON dc."orderId" = oa."orderId"
         AND dc."companyId" = oa."companyId"
       WHERE oa."companyId" = ${companyId}
         AND oa."channel" = 'PROMOTION_CLAIM'
         AND oa."campaignId" IN (${Prisma.join(campaignIds)})
       GROUP BY oa."campaignId"
    `
  )

  for (const fila of filas) {
    resultado.set(fila.campaignId, {
      reclamosAtribuidos: Number(fila.reclamos),
      canjesAtribuidos: Number(fila.canjes),
    })
  }
  return resultado
}

export async function getDealsParaMarketing(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.deal.findMany({
      where: { companyId, status: 'ACTIVE' },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      take: 200,
      select: { id: true, title: true, promotion: { select: { nombre: true } } },
    })
  )
}

export async function getCampanasVivas(companyId: string): Promise<CampanaViva[]> {
  try {
    const now = new Date()
    const candidatas = await conEmpresa(companyId, (tx) =>
      tx.marketingCampaign.findMany({
        where: {
          companyId,
          estado: 'ACTIVA',
          fechaInicio: { lte: now },
          fechaFin: { gte: now },
        },
        orderBy: [{ destacada: 'desc' }, { prioridad: 'desc' }, { fechaFin: 'asc' }],
        take: 20,
        include: {
          deal: {
            select: {
              id: true,
              status: true,
              startsAt: true,
              endsAt: true,
              maxClaims: true,
              claimsActive: true,
              feePerRedemption: true,
              budgetTotal: true,
              budgetReserved: true,
              budgetSpent: true,
              promotion: {
                select: {
                  status: true,
                  inicioEn: true,
                  finEn: true,
                  actions: { where: { activa: true }, select: { id: true } },
                  restrictions: { where: { activa: true }, select: { id: true } },
                },
              },
            },
          },
        },
      })
    )

    const vivas: CampanaViva[] = []

    for (const c of candidatas) {
      // Una campaña vinculada a un Deal deja de anunciarlo cuando la oferta se
      // pausa o sale de vigencia. Los reclamos ya emitidos siguen su propio ciclo.
      if (c.deal && (
        c.deal.status !== 'ACTIVE' ||
        c.deal.startsAt > now ||
        (c.deal.endsAt != null && c.deal.endsAt <= now)
      )) continue
      const promocion = c.deal?.promotion
      if (promocion && (
        promocion.status !== 'ACTIVE' ||
        (promocion.inicioEn != null && promocion.inicioEn > now) ||
        (promocion.finEn != null && promocion.finEn < now) ||
        promocion.actions.length > 0 ||
        promocion.restrictions.length > 0
      )) continue
      const terminaEn = finDeVentanaCampana(c, now)
      if (!terminaEn) continue

      // Stock de cupones (urgencia): agotado → no se muestra.
      const cuposRestantes = c.deal
        ? reclamosPosibles(c.deal)
        : c.maxReclamos != null
          ? Math.max(0, c.maxReclamos - c.reclamosCount)
          : null
      if (cuposRestantes === 0) continue

      vivas.push({
        id: c.id,
        dealId: c.dealId,
        tipo: c.tipo,
        titulo: c.titulo,
        descripcion: c.descripcion,
        bannerUrl: c.bannerUrl,
        imagenUrl: c.imagenUrl,
        ctaTexto: c.ctaTexto,
        ctaHref: c.dealId
          ? `/ofertas/${encodeURIComponent(c.dealId)}?campaign=${encodeURIComponent(c.id)}`
          : c.ctaHref,
        colorPrimario: c.colorPrimario,
        colorSecundario: c.colorSecundario,
        destacada: c.destacada,
        terminaEn: terminaEn.toISOString(),
        cuposRestantes,
        reclamados: c.deal?.claimsActive ?? c.reclamosCount,
      })
    }

    const rendimiento = await rendimientoAtribuido(companyId, vivas.filter((c) => c.dealId).map((c) => c.id))
    return vivas.map((campana) => ({
      ...campana,
      reclamados: campana.dealId ? rendimiento.get(campana.id)?.reclamosAtribuidos ?? 0 : campana.reclamados,
    }))
  } catch (e) {
    console.error('[engagement] getCampanasVivas:', e)
    return []
  }
}

// ─── Admin ────────────────────────────────────────────────────────────────

export async function getCampanasMarketingAdmin(companyId: string) {
  const campanas = await conEmpresa(companyId, (tx) =>
    tx.marketingCampaign.findMany({
      where: { companyId },
      orderBy: [{ estado: 'asc' }, { fechaFin: 'desc' }],
      include: { deal: { select: { title: true, promotion: { select: { nombre: true } } } } },
    })
  )
  const rendimiento = await rendimientoAtribuido(companyId, campanas.filter((c) => c.dealId).map((c) => c.id))
  return campanas.map((campana) => ({
    ...campana,
    reclamosAtribuidos: rendimiento.get(campana.id)?.reclamosAtribuidos ?? 0,
    canjesAtribuidos: rendimiento.get(campana.id)?.canjesAtribuidos ?? 0,
  }))
}

export async function getCampanaMarketing(id: string, companyId: string) {
  return conEmpresa(companyId, (tx) => tx.marketingCampaign.findFirst({ where: { id, companyId } }))
}
