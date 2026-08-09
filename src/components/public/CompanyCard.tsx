import { BusinessCard } from '@/components/marketplace/BusinessCard'
import type { CompanyPublic } from '@/modules/marketplace/types'

interface CompanyCardProps {
  company: CompanyPublic
  /**
   * Base de la ruta del perfil. Público = '/empresas' (Landing); dentro de la
   * app se pasa '/cliente/empresas' para no salir del contexto autenticado.
   */
  hrefBase?: string
}

/**
 * Tarjeta de empresa de la vitrina pública.
 *
 * DS 2.0 · Fase 4 — ADAPTADOR, ya no una segunda implementación. Dibujaba su
 * propia tarjeta (banner, logo flotante, degradado atardecer) mientras el
 * explorador de la app dibujaba otra distinta: la misma empresa cambiaba de
 * aspecto según por dónde llegaras. Ahora las dos son `BusinessCard`; lo único
 * propio que queda aquí es traducir `CompanyPublic` a sus datos.
 *
 * En pantallas nuevas, usar `BusinessCard` directamente.
 */
export function CompanyCard({ company, hrefBase = '/empresas' }: CompanyCardProps) {
  return (
    <BusinessCard
      hrefBase={hrefBase}
      variant="featured"
      company={{
        id: company.id,
        name: company.name,
        slug: company.slug,
        type: company.type,
        logoUrl: company.logoUrl,
        bannerUrl: company.bannerUrl,
        ciudad: company.ciudad,
        descripcion: company.description,
        totalMembersCount: company.totalMembersCount,
        activePromotionsCount: company.activePromotionsCount,
        averageRating: company.averageRating,
        isFeatured: company.isFeatured,
      }}
    />
  )
}
