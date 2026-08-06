import { conEmpresa } from '@/lib/tenant'
import type { MarketingCampaignTipo } from '@prisma/client'

/**
 * Engagement Engine · Fase 2 — Motor de Campañas.
 *
 * Resuelve qué campañas de marketing están VIVAS ahora mismo para el Home del
 * cliente: dentro de su ventana de fechas y —para Happy Hour / fin de semana—
 * dentro de su ventana horaria y días de la semana (hora local de RD, UTC-4).
 */

// República Dominicana no aplica horario de verano: siempre UTC-4.
const RD_OFFSET_MS = 4 * 60 * 60 * 1000

/** "Ahora" en RD como campos UTC (día de la semana y minutos del día). */
function ahoraRD() {
  const rd = new Date(Date.now() - RD_OFFSET_MS)
  return {
    dia: rd.getUTCDay(), // 0=Dom … 6=Sáb
    minutos: rd.getUTCHours() * 60 + rd.getUTCMinutes(),
    // Instante UTC real de la medianoche de HOY en RD.
    medianocheMs:
      Date.UTC(rd.getUTCFullYear(), rd.getUTCMonth(), rd.getUTCDate()) + RD_OFFSET_MS,
  }
}

export interface CampanaViva {
  id: string
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
      })
    )

    const rd = ahoraRD()
    const vivas: CampanaViva[] = []

    for (const c of candidatas) {
      // Día de la semana (si se restringe).
      if (c.diasSemana.length > 0 && !c.diasSemana.includes(rd.dia)) continue

      // Ventana horaria (Happy Hour): dentro de [horaInicioMin, horaFinMin].
      let finMs = c.fechaFin.getTime()
      if (c.horaInicioMin != null && c.horaFinMin != null) {
        if (rd.minutos < c.horaInicioMin || rd.minutos >= c.horaFinMin) continue
        // Termina hoy al cierre de la ventana (o antes si la campaña acaba).
        finMs = Math.min(rd.medianocheMs + c.horaFinMin * 60_000, finMs)
      }

      // Stock de cupones (urgencia): agotado → no se muestra.
      const cuposRestantes =
        c.maxReclamos != null ? Math.max(0, c.maxReclamos - c.reclamosCount) : null
      if (cuposRestantes === 0) continue

      vivas.push({
        id: c.id,
        tipo: c.tipo,
        titulo: c.titulo,
        descripcion: c.descripcion,
        bannerUrl: c.bannerUrl,
        imagenUrl: c.imagenUrl,
        ctaTexto: c.ctaTexto,
        ctaHref: c.ctaHref,
        colorPrimario: c.colorPrimario,
        colorSecundario: c.colorSecundario,
        destacada: c.destacada,
        terminaEn: new Date(finMs).toISOString(),
        cuposRestantes,
        reclamados: c.reclamosCount,
      })
    }

    return vivas
  } catch (e) {
    console.error('[engagement] getCampanasVivas:', e)
    return []
  }
}

// ─── Admin ────────────────────────────────────────────────────────────────

export async function getCampanasMarketingAdmin(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.marketingCampaign.findMany({
      where: { companyId },
      orderBy: [{ estado: 'asc' }, { fechaFin: 'desc' }],
    })
  )
}

export async function getCampanaMarketing(id: string, companyId: string) {
  return conEmpresa(companyId, (tx) => tx.marketingCampaign.findFirst({ where: { id, companyId } }))
}
