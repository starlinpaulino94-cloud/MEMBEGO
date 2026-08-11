// Public marketplace types - Deconstructed for security (no sensitive fields)

export interface CompanyPublic {
  id: string
  name: string
  slug: string
  type: string
  description: string | null
  logoUrl: string | null
  bannerUrl: string | null
  galleryImages: string[]
  ciudad: string | null
  provincia: string | null
  pais: string | null
  telefono: string | null
  whatsapp: string | null
  email: string | null
  website: string | null
  instagram: string | null
  facebook: string | null
  tiktok: string | null
  googleMapsUrl: string | null
  horario: string | null
  totalMembersCount: number
  activePromotionsCount: number
  averageRating: number | null
  isFeatured: boolean
  categories: string[] // slugs
  /** Plan activo más barato ("desde $X/mes") para tarjetas del Explorar. */
  desdePlan?: { nombre: string; precio: number } | null
  createdAt: Date
}

export interface PromotionPublic {
  id: string
  titulo: string
  slug: string | null
  descripcion: string
  imagenUrl: string | null
  tipo: string
  descuento: number | null
  codigo: string | null
  vigenciaDesde: Date
  vigenciaHasta: Date | null
  viewCount: number
  shareCount: number
  tags: string[]
  isFeatured: boolean
  company: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    /**
     * ¿La empresa tiene planes de membresía publicados? Solo lo trae el detalle
     * (`getPromotionDetail`); en los listados viaja `undefined` y la UI no
     * promete nada. Sirve para no mandar al cliente a "ver los planes" de un
     * negocio que no vende ninguno.
     */
    tienePlanes?: boolean
  }
  createdAt: Date
  /** Fase E5: datos de venta directa (solo si la promoción es comprable). */
  venta?: {
    precio: number
    usosPorCompra: number
    agotada: boolean
    beneficioVigenciaDias: number | null
    beneficioVigenciaHasta: Date | null
    /** Máx. adquisiciones por cliente (null = sin límite; 1 = un solo uso). */
    limitePorCliente: number | null
  } | null
}

export interface CategoryPublic {
  id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  order: number
  companyCount: number
}

/**
 * Categorías que el cliente puede VER: solo las que llevan a algún sitio.
 *
 * Una categoría vacía es una promesa que no se cumple — se toca "Restaurantes",
 * llega una lista en blanco, y el cliente aprende que el buscador no sirve. El
 * catálogo de cara al público es el mapa del negocio, no el inventario de la
 * tabla.
 *
 * Vive aquí, y no dentro de la consulta, porque es una REGLA DE PRODUCTO y se
 * prueba sin base de datos. El panel no la usa: al asignarle categorías a una
 * empresa hay que ver el catálogo entero, o una categoría vacía nunca podría
 * dejar de estarlo.
 */
export function categoriasVisibles<T extends { companyCount: number }>(categorias: T[]): T[] {
  return categorias.filter((c) => c.companyCount > 0)
}

export interface CompanyStats {
  totalMembers: number
  activePromotions: number
  averageRating: number | null
  totalRatings: number
}

export interface MarketplaceFilters {
  search?: string
  category?: string
  city?: string
  country?: string
  type?: string
  featured?: boolean
  limit?: number
  offset?: number
}

export interface PromotionFilters {
  search?: string
  company?: string
  type?: string
  tag?: string
  limit?: number
  offset?: number
}
