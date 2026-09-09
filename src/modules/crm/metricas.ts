import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { ETAPAS, minutosMedianosDeRespuesta, paresDeRespuesta, tasaDeConversion, type Etapa } from '@/modules/crm/nucleo'
import type { Canal } from '@/modules/mensajeria/nucleo'

/**
 * MÉTRICAS DEL CRM (Meta · Fase 6). Todo se calcula sobre prospectos y
 * conversaciones reales de la empresa; nada se guarda precalculado. Cuando
 * no hay datos, los números son cero o null, y la pantalla lo dice.
 */

export interface MetricasCrm {
  prospectos: {
    total: number
    nuevos7d: number
    nuevos30d: number
    porCanal: Record<Canal, number>
    porEtapa: Record<Etapa, number>
    /** % de cerrados sobre el total (cerrados + perdidos + en juego). */
    conversion: number | null
  }
  conversaciones: {
    total: number
    porCanal: Record<Canal, number>
    /** Mediana de minutos hasta la primera respuesta del negocio (últimas 100 conversaciones). */
    minutosPrimeraRespuesta: number | null
    respondidas: number
    medidas: number
  }
  seguimientos: { pendientes: number; vencidos: number }
}

const CANALES: Canal[] = ['WHATSAPP', 'MESSENGER', 'INSTAGRAM']

function contadorPorCanal(grupos: { canal: string; _count: { _all: number } }[]): Record<Canal, number> {
  const r: Record<Canal, number> = { WHATSAPP: 0, MESSENGER: 0, INSTAGRAM: 0 }
  for (const g of grupos) if ((CANALES as string[]).includes(g.canal)) r[g.canal as Canal] = g._count._all
  return r
}

export async function metricasCrm(companyId: string): Promise<MetricasCrm> {
  const ahora = Date.now()
  const hace7d = new Date(ahora - 7 * 86_400_000)
  const hace30d = new Date(ahora - 30 * 86_400_000)

  return conEmpresa(companyId, async (tx) => {
    const [porCanalP, porEtapaP, nuevos7d, nuevos30d, porCanalC, pendientes, vencidos, recientes] = await Promise.all([
      tx.prospecto.groupBy({ by: ['canal'], where: { companyId }, _count: { _all: true } }),
      tx.prospecto.groupBy({ by: ['etapa'], where: { companyId }, _count: { _all: true } }),
      tx.prospecto.count({ where: { companyId, createdAt: { gte: hace7d } } }),
      tx.prospecto.count({ where: { companyId, createdAt: { gte: hace30d } } }),
      tx.conversacion.groupBy({ by: ['canal'], where: { companyId }, _count: { _all: true } }),
      tx.seguimientoProspecto.count({ where: { companyId, hechoAt: null } }),
      tx.seguimientoProspecto.count({ where: { companyId, hechoAt: null, programadoAt: { lt: new Date(ahora) } } }),
      tx.conversacion.findMany({
        where: { companyId, ultimoEntranteAt: { not: null } },
        orderBy: { ultimoEntranteAt: 'desc' },
        take: 100,
        select: { id: true },
      }),
    ])

    const porEtapa = Object.fromEntries(ETAPAS.map((e) => [e, 0])) as Record<Etapa, number>
    for (const g of porEtapaP) if ((ETAPAS as readonly string[]).includes(g.etapa)) porEtapa[g.etapa as Etapa] = g._count._all
    const totalP = Object.values(porEtapa).reduce((a, b) => a + b, 0)

    const mensajes =
      recientes.length === 0
        ? []
        : await tx.mensaje.findMany({
            where: { companyId, conversacionId: { in: recientes.map((c) => c.id) } },
            orderBy: { timestamp: 'asc' },
            take: 5000,
            select: { conversacionId: true, direccion: true, timestamp: true },
          })
    const pares = paresDeRespuesta(mensajes)
    const porCanalConv = contadorPorCanal(porCanalC)

    return {
      prospectos: {
        total: totalP,
        nuevos7d,
        nuevos30d,
        porCanal: contadorPorCanal(porCanalP),
        porEtapa,
        conversion: tasaDeConversion(porEtapa.cerrado, totalP),
      },
      conversaciones: {
        total: Object.values(porCanalConv).reduce((a, b) => a + b, 0),
        porCanal: porCanalConv,
        minutosPrimeraRespuesta: minutosMedianosDeRespuesta(pares),
        respondidas: pares.filter((p) => p.primerSalienteAt).length,
        medidas: pares.length,
      },
      seguimientos: { pendientes, vencidos },
    }
  })
}
