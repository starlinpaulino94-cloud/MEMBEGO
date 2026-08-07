import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { SegmentoServicio } from './segmentos'
import { normalizarRaiz, type Nodo, type SegmentoRaiz } from './arbol'
import { dondeAudiencia, dondeAudienciaSinConsent } from './audiencia-sql'

/**
 * AudienceEstimator (docs/GEOLOCALIZACION.md §10.3 y §23).
 *
 * Cuenta la audiencia de un segmento CON SQL agregado (groupBy + joins con
 * índices), NUNCA trayendo personas al servidor, y devuelve solo agregados:
 * totales, distribución por ciudad/sector y clientes sin consentimiento. No
 * expone nombres, correos ni coordenadas.
 *
 * Consentimiento: `MARKETING_GEO` activo es condición SIEMPRE exigida (§33);
 * los clientes sin consentimiento se cuentan aparte y se excluyen. Guardrail de
 * identificación: audiencias por debajo del umbral se marcan y bloquean (§32).
 */

export const UMBRAL_MINIMO_AUDIENCIA = 5
export const UMBRAL_ALTO_AUDIENCIA = 1000

export interface Estimacion {
  totalElegibles: number
  sinConsentimiento: number
  porCiudad: { cityId: string; count: number }[]
  porSector: { sectorId: string; count: number }[]
  advertencias: string[]
  bajoUmbral: boolean
}

/**
 * Estima una audiencia desde un DTO (vista previa del constructor o campaña
 * por radio). `raiz` nulo = segmento vacío (todos los clientes con
 * consentimiento).
 */
export async function estimarAudiencia(
  companyId: string,
  raiz: SegmentoRaiz | null
): Promise<Estimacion> {
  const nodo = normalizarRaiz(raiz ?? { operador: 'AND', condiciones: [], grupos: [] })
  return contarAudiencia(companyId, nodo)
}

/** Estima desde un AST ya construido (campañas, fan-out). */
export async function estimarNodo(companyId: string, nodo: Nodo): Promise<Estimacion> {
  return contarAudiencia(companyId, nodo)
}

/**
 * Estima la audiencia de un segmento guardado y deja el agregado en
 * `ultimaAudienciaEstimada` (para la lista y el panel).
 */
export async function estimarSegmento(companyId: string, segmentoId: string): Promise<Estimacion> {
  const nodo = await SegmentoServicio.arbol(companyId, segmentoId)
  if (!nodo) throw new Error('El segmento no existe o no pertenece a esta empresa.')
  const est = await contarAudiencia(companyId, nodo)
  await conEmpresa(companyId, (tx) =>
    tx.savedSegment.update({
      where: { id: segmentoId },
      data: { ultimaAudienciaEstimada: est.totalElegibles, ultimaEvaluacionAt: new Date() },
    })
  )
  return est
}

async function contarAudiencia(companyId: string, nodo: Nodo): Promise<Estimacion> {
  const res = await sinEmpresa(
    'segmentación: conteos agregados por empresa; nunca se expone quién es quién',
    async (tx) => {
      const donde = await dondeAudiencia(tx, companyId, nodo)
      const dondeSinConsent = await dondeAudienciaSinConsent(tx, companyId, nodo)

      const [con, sin] = await Promise.all([
        tx.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM clientes c WHERE ${donde}`,
        tx.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM clientes c WHERE ${dondeSinConsent}`,
      ])

      const [porCiudad, porSector] = await Promise.all([
        tx.$queryRaw<{ cityId: string | null; n: number }[]>`
          SELECT cl.cityId, COUNT(DISTINCT c.id)::int AS n
          FROM clientes c
          JOIN users u ON u.supabaseId = c.supabaseId
          JOIN customer_locations cl ON cl.userId = u.id AND cl.isPrimary
          WHERE ${donde} AND cl.cityId IS NOT NULL
          GROUP BY cl.cityId ORDER BY n DESC LIMIT 10`,
        tx.$queryRaw<{ sectorId: string | null; n: number }[]>`
          SELECT cl.sectorId, COUNT(DISTINCT c.id)::int AS n
          FROM clientes c
          JOIN users u ON u.supabaseId = c.supabaseId
          JOIN customer_locations cl ON cl.userId = u.id AND cl.isPrimary
          WHERE ${donde} AND cl.sectorId IS NOT NULL
          GROUP BY cl.sectorId ORDER BY n DESC LIMIT 10`,
      ])

      return {
        totalElegibles: con[0]?.count ?? 0,
        sinConsentimiento: sin[0]?.count ?? 0,
        porCiudad: porCiudad
          .filter((r): r is { cityId: string; n: number } => r.cityId !== null)
          .map((r) => ({ cityId: r.cityId, count: r.n })),
        porSector: porSector
          .filter((r): r is { sectorId: string; n: number } => r.sectorId !== null)
          .map((r) => ({ sectorId: r.sectorId, count: r.n })),
      }
    }
  )

  return armarEstimacion(res)
}

function armarEstimacion(res: {
  totalElegibles: number
  sinConsentimiento: number
  porCiudad: { cityId: string; count: number }[]
  porSector: { sectorId: string; count: number }[]
}): Estimacion {
  const advertencias: string[] = []
  if (res.totalElegibles < UMBRAL_MINIMO_AUDIENCIA) {
    advertencias.push(
      `La audiencia (${res.totalElegibles}) está por debajo del mínimo de ${UMBRAL_MINIMO_AUDIENCIA}. La campaña quedará bloqueada.`
    )
  }
  if (res.totalElegibles > UMBRAL_ALTO_AUDIENCIA) {
    advertencias.push(`Audiencia grande (${res.totalElegibles}); el envío se hará por lotes.`)
  }
  if (res.sinConsentimiento > 0) {
    advertencias.push(
      `${res.sinConsentimiento} clientes más coinciden pero no tienen consentimiento de marketing geo (no serán contactados).`
    )
  }
  return {
    totalElegibles: res.totalElegibles,
    sinConsentimiento: res.sinConsentimiento,
    porCiudad: res.porCiudad,
    porSector: res.porSector,
    advertencias,
    bajoUmbral: res.totalElegibles < UMBRAL_MINIMO_AUDIENCIA,
  }
}
