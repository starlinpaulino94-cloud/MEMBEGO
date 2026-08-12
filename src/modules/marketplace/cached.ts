import { unstable_cache } from 'next/cache'
import type { CompanyPublic, PromotionPublic } from '@/modules/marketplace/types'
import * as q from '@/modules/marketplace/queries'
import type { MarketplaceFilters, PromotionFilters } from '@/modules/marketplace/types'

/**
 * Capa de CACHÉ del marketplace público (auditoría Enterprise · punto 2).
 *
 * Estas lecturas son idénticas para todos los visitantes: cachearlas evita
 * que cada vista golpee Postgres (≈ −90% de carga en las rutas públicas).
 * Drop-in: exporta los MISMOS nombres que `queries.ts` — las páginas solo
 * cambian el import. Lo personalizado (cliente/feeds) NO pasa por aquí.
 *
 * - TTLs: catálogo/detalle 120 s · destacadas 300 s · categorías 1 h ·
 *   stats 10 min. Además, el tag `marketplace` permite invalidar al instante
 *   desde las mutaciones del panel (revalidateTag) — sin esperar el TTL.
 * - `unstable_cache` serializa a JSON: las fechas vuelven como string en un
 *   HIT. Los "revividores" las reconstruyen para que los tipos (`Date`)
 *   sigan siendo verdad tanto en hit como en miss.
 */

export const MARKETPLACE_TAG = 'marketplace'

// ── Revividores de fechas ─────────────────────────────────────────────────────

function reviveCompany(c: CompanyPublic): CompanyPublic {
  return { ...c, createdAt: new Date(c.createdAt) }
}

function revivePromotion(p: PromotionPublic): PromotionPublic {
  return {
    ...p,
    vigenciaDesde: new Date(p.vigenciaDesde),
    vigenciaHasta: p.vigenciaHasta ? new Date(p.vigenciaHasta) : null,
    createdAt: new Date(p.createdAt),
    venta: p.venta
      ? {
          ...p.venta,
          beneficioVigenciaHasta: p.venta.beneficioVigenciaHasta
            ? new Date(p.venta.beneficioVigenciaHasta)
            : null,
        }
      : p.venta,
  }
}

// ── Lecturas cacheadas (mismos nombres que queries.ts) ───────────────────────

export async function getCompaniesPublic(
  filters: MarketplaceFilters = {}
): Promise<CompanyPublic[]> {
  const fn = unstable_cache(
    () => q.getCompaniesPublic(filters),
    ['mk-companies', JSON.stringify(filters)],
    { revalidate: 120, tags: [MARKETPLACE_TAG] }
  )
  return (await fn()).map(reviveCompany)
}

export async function getCompanyPublic(companySlug: string): Promise<CompanyPublic | null> {
  const fn = unstable_cache(
    () => q.getCompanyPublic(companySlug),
    ['mk-company', companySlug],
    { revalidate: 120, tags: [MARKETPLACE_TAG] }
  )
  const c = await fn()
  return c ? reviveCompany(c) : null
}

export async function getPromotionsPublic(
  filters: PromotionFilters = {}
): Promise<PromotionPublic[]> {
  const fn = unstable_cache(
    () => q.getPromotionsPublic(filters),
    ['mk-promotions', JSON.stringify(filters)],
    { revalidate: 120, tags: [MARKETPLACE_TAG] }
  )
  return (await fn()).map(revivePromotion)
}

export async function getPromotionDetail(promotionId: string): Promise<PromotionPublic | null> {
  const fn = unstable_cache(
    () => q.getPromotionDetail(promotionId),
    ['mk-promotion', promotionId],
    { revalidate: 120, tags: [MARKETPLACE_TAG] }
  )
  const p = await fn()
  return p ? revivePromotion(p) : null
}

export async function getFeaturedPromotions(limit = 6): Promise<PromotionPublic[]> {
  const fn = unstable_cache(
    () => q.getFeaturedPromotions(limit),
    ['mk-featured-promos', String(limit)],
    { revalidate: 300, tags: [MARKETPLACE_TAG] }
  )
  return (await fn()).map(revivePromotion)
}

export async function getFeaturedCompanies(limit = 6): Promise<CompanyPublic[]> {
  const fn = unstable_cache(
    () => q.getFeaturedCompanies(limit),
    ['mk-featured-companies', String(limit)],
    { revalidate: 300, tags: [MARKETPLACE_TAG] }
  )
  return (await fn()).map(reviveCompany)
}

export async function getRecentCompanies(limit = 6): Promise<CompanyPublic[]> {
  const fn = unstable_cache(
    () => q.getRecentCompanies(limit),
    ['mk-recent-companies', String(limit)],
    { revalidate: 300, tags: [MARKETPLACE_TAG] }
  )
  return (await fn()).map(reviveCompany)
}

/**
 * Catálogo global de planes. Precio y nombre son idénticos para todo el
 * mundo —lo personalizado es la elegibilidad, y esa no pasa por aquí—, así que
 * se cachea como el resto de la vitrina. Sin fechas que revivir.
 */
export async function getPlanesPublic(
  filtros: { search?: string; category?: string; limit?: number } = {}
) {
  const fn = unstable_cache(
    () => q.getPlanesPublic(filtros),
    ['mk-planes', JSON.stringify(filtros)],
    { revalidate: 120, tags: [MARKETPLACE_TAG] }
  )
  return fn()
}

/** Categorías: cambian poco — 1 h de TTL (solo primitivos, sin revivir). */
export const getCategoriesPublic = unstable_cache(
  () => q.getCategoriesPublic(),
  ['mk-categories'],
  { revalidate: 3600, tags: [MARKETPLACE_TAG] }
)

/** Stats de plataforma para la landing: números — 10 min. */
export const getPlatformStats = unstable_cache(
  () => q.getPlatformStats(),
  ['mk-platform-stats'],
  { revalidate: 600, tags: [MARKETPLACE_TAG] }
)

export async function getCompanyStats(companySlug: string) {
  const fn = unstable_cache(
    () => q.getCompanyStats(companySlug),
    ['mk-company-stats', companySlug],
    { revalidate: 300, tags: [MARKETPLACE_TAG] }
  )
  return fn()
}

// ── Re-export sin caché ───────────────────────────────────────────────────────
// Personalizado por usuario u OG puntual (ya amortiguado por React.cache o de
// muy bajo tráfico): mantiene el swap de import como drop-in.
export {
  getClientePromociones,
  getPromotionOg,
  getPlanPublic,
  getPlanOg,
  getCompanyPlanesPublic,
} from '@/modules/marketplace/queries'
export { getCompanyPostsPublic, getSucursalesPublic } from '@/modules/marketplace/queries'
export type { PlatformStats } from '@/modules/marketplace/queries'
