import { sinEmpresa } from '@/lib/tenant'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { promocionVigente, EMPRESA_EN_VITRINA } from '@/modules/promociones/vigencia'
import { categoriasVisibles } from './types'
import type {
  CompanyPublic,
  PromotionPublic,
  CategoryPublic,
  MarketplaceFilters,
  PromotionFilters,
  CompanyStats,
} from './types'

/**
 * PUBLIC QUERIES - No authentication required
 * These queries only expose non-sensitive fields
 */

export async function getCompaniesPublic(filters: MarketplaceFilters = {}): Promise<CompanyPublic[]> {
  const {
    search,
    category,
    city,
    country,
    type,
    featured,
    limit = 50,
    offset = 0,
  } = filters

  try {
    const companies = await sinEmpresa('marketplace: vitrina pública', (tx) =>
      tx.company.findMany({
        where: {
          isPublished: true,
          isActive: true,
          // Las empresas de DEMOSTRACIÓN no salen en la vitrina pública: un
          // cliente real no puede tropezarse con la de práctica.
          esDemo: false,
          ...(search && {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }),
          ...(city && { ciudad: city }),
          ...(country && { pais: country }),
          ...(type && { type }),
          ...(featured && { isFeatured: true }),
          ...(category && {
            categories: {
              some: {
                category: { slug: category },
              },
            },
          }),
        },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          logoUrl: true,
          bannerUrl: true,
          galleryImages: true,
          ciudad: true,
          provincia: true,
          pais: true,
          telefono: true,
          whatsapp: true,
          email: true,
          website: true,
          instagram: true,
          facebook: true,
          tiktok: true,
          googleMapsUrl: true,
          horario: true,
          totalMembersCount: true,
          activePromotionsCount: true,
          averageRating: true,
          isFeatured: true,
          createdAt: true,
          categories: {
            select: {
              category: {
                select: { slug: true },
              },
            },
          },
          // Plan de entrada ("desde $X/mes") para las tarjetas del Explorar.
          plans: {
            where: { activo: true },
            orderBy: { precio: 'asc' },
            take: 1,
            select: { nombre: true, precio: true },
          },
        },
        orderBy: [
          { isFeatured: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: offset,
      })
    )

    return companies.map((c) => ({
      ...c,
      categories: c.categories.map((cc) => cc.category.slug),
      desdePlan: c.plans[0]
        ? { nombre: c.plans[0].nombre, precio: Number(c.plans[0].precio) }
        : null,
      plans: undefined,
    })) as unknown as CompanyPublic[]
  } catch (error) {
    console.error('[getCompaniesPublic] Error:', error)
    return []
  }
}

export async function getCompanyPublic(companySlug: string): Promise<CompanyPublic | null> {
  if (!companySlug) return null

  try {
    const company = await sinEmpresa('marketplace: vitrina pública', (tx) =>
      tx.company.findUnique({
        where: { slug: companySlug },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          logoUrl: true,
          bannerUrl: true,
          galleryImages: true,
          ciudad: true,
          provincia: true,
          pais: true,
          telefono: true,
          whatsapp: true,
          email: true,
          website: true,
          instagram: true,
          facebook: true,
          tiktok: true,
          googleMapsUrl: true,
          horario: true,
          totalMembersCount: true,
          activePromotionsCount: true,
          averageRating: true,
          isFeatured: true,
          isPublished: true,
          isActive: true,
          esDemo: true,
          createdAt: true,
          categories: {
            select: {
              category: {
                select: { slug: true },
              },
            },
          },
        },
      })
    )

    if (!company || !company.isPublished || !company.isActive) return null

    return {
      ...company,
      categories: company.categories.map((c) => c.category.slug),
    } as CompanyPublic
  } catch (error) {
    console.error('[getCompanyPublic] Error:', error)
    return null
  }
}

export async function getPromotionsPublic(filters: PromotionFilters = {}): Promise<PromotionPublic[]> {
  const {
    search,
    company,
    category,
    type,
    tag,
    limit = 50,
    offset = 0,
  } = filters

  const now = new Date()

  try {
    const promotions = await sinEmpresa('marketplace: vitrina pública', (tx) =>
      tx.promocion.findMany({
        where: {
          // Una sola definición de «vigente», compartida con el feed del
          // cliente. Antes aquí ponía `vigenciaHasta: { gt: now }`, que
          // descartaba en silencio TODA promoción sin fecha de fin: la oferta
          // permanente salía en el inicio del cliente y desaparecía al
          // buscarla. Ver `src/modules/promociones/vigencia.ts`.
          ...promocionVigente(now),
          visibilidad: 'publica',
          // El filtro por slug se fusiona dentro de company para no sobrescribir
          // (y perder) las condiciones isPublished/isActive.
          company: {
            ...EMPRESA_EN_VITRINA,
            ...(company && { slug: company }),
            ...(category && { categories: { some: { category: { slug: category } } } }),
          },
          // El `OR` de la búsqueda va DENTRO de `AND`: en el primer nivel
          // pisaría al `OR` de la vigencia —Prisma no fusiona claves iguales— y
          // el buscador empezaría a devolver promociones caducadas.
          ...(search && {
            AND: [
              {
                OR: [
                  { titulo: { contains: search, mode: 'insensitive' } },
                  { descripcion: { contains: search, mode: 'insensitive' } },
                ],
              },
            ],
          }),
          ...(type && { tipo: type }),
          ...(tag && {
            tags: {
              has: tag,
            },
          }),
        },
        select: {
          id: true,
          titulo: true,
          slug: true,
          descripcion: true,
          imagenUrl: true,
          tipo: true,
          descuento: true,
          codigo: true,
          vigenciaDesde: true,
          vigenciaHasta: true,
          viewCount: true,
          shareCount: true,
          tags: true,
          isFeatured: true,
          createdAt: true,
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
            },
          },
        },
        orderBy: [
          { isFeatured: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: offset,
      })
    )

    return promotions as PromotionPublic[]
  } catch (error) {
    console.error('[getPromotionsPublic] Error:', error)
    return []
  }
}

/**
 * Promociones vigentes de las empresas donde el cliente tiene cuenta.
 * Devuelve la misma forma pública (PromotionPublic) para reutilizar PromotionCard
 * y que el enlace al detalle /promocion/[id] funcione (mismas condiciones de
 * publicación).
 */
export async function getClientePromociones(
  supabaseId: string
): Promise<PromotionPublic[]> {
  try {
    return await sinEmpresa(
      'marketplace: promociones de las empresas propias del cliente (cruza sus empresas)',
      async (tx) => {
        const clientes = await tx.cliente.findMany({
          where: { supabaseId },
          select: { companyId: true },
        })
        const companyIds = clientes.map((c) => c.companyId)
        if (companyIds.length === 0) return []

        const now = new Date()
        const promotions = await tx.promocion.findMany({
          where: {
            companyId: { in: companyIds },
            activo: true,
            // Miembro de la empresa: ve públicas Y privadas (pero no archivadas).
            archivada: false,
            vigenciaDesde: { lte: now },
            OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
            // Sin `isPublished` ni `esDemo`: estas son las promociones de las
            // empresas DE ESTA PERSONA (el `companyId in` de arriba sale de sus
            // fichas de cliente). Quien es cliente ve lo suyo aunque el negocio no
            // esté publicado, y quien entró por el enlace de la empresa de
            // práctica es cliente de ella.
            company: { isActive: true },
          },
          select: {
            id: true,
            titulo: true,
            slug: true,
            descripcion: true,
            imagenUrl: true,
            tipo: true,
            descuento: true,
            codigo: true,
            vigenciaDesde: true,
            vigenciaHasta: true,
            viewCount: true,
            shareCount: true,
            tags: true,
            isFeatured: true,
            createdAt: true,
            company: {
              select: { id: true, name: true, slug: true, logoUrl: true },
            },
          },
          orderBy: [{ isFeatured: 'desc' }, { publicadaEn: 'desc' }],
          take: 100,
        })

        return promotions as PromotionPublic[]
      }
    )
  } catch (error) {
    console.error('[getClientePromociones] Error:', error)
    throw error
  }
}

export async function getFeaturedPromotions(limit: number = 6): Promise<PromotionPublic[]> {
  const now = new Date()

  try {
    const promotions = await sinEmpresa('marketplace: vitrina pública', (tx) =>
      tx.promocion.findMany({
        where: {
          isFeatured: true,
          // Misma corrección que en la vitrina: una destacada permanente no
          // puede desaparecer por no tener fecha de fin.
          ...promocionVigente(now),
          visibilidad: 'publica',
          company: EMPRESA_EN_VITRINA,
        },
        select: {
          id: true,
          titulo: true,
          slug: true,
          descripcion: true,
          imagenUrl: true,
          tipo: true,
          descuento: true,
          codigo: true,
          vigenciaDesde: true,
          vigenciaHasta: true,
          viewCount: true,
          shareCount: true,
          tags: true,
          isFeatured: true,
          createdAt: true,
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
            },
          },
        },
        orderBy: [
          { featuredOrder: 'asc' },
          { createdAt: 'desc' },
        ],
        take: limit,
      })
    )

    return promotions as PromotionPublic[]
  } catch (error) {
    console.error('[getFeaturedPromotions] Error:', error)
    return []
  }
}

/**
 * Detalle público por SLUG o por ID.
 *
 * Se busca por las dos formas a la vez: los enlaces viejos llevan el id y
 * siguen circulando por WhatsApp meses después, así que tienen que funcionar
 * para siempre. Preguntar por ambas en una sola consulta evita además tener
 * que adivinar cuál es cuál.
 */
export async function getPromotionDetail(
  claveOId: string
): Promise<PromotionPublic | null> {
  if (!claveOId) return null

  const now = new Date()

  try {
    return await sinEmpresa('marketplace: detalle público de promoción', async (tx) => {
      const promotion = await tx.promocion.findFirst({
        where: { OR: [{ id: claveOId }, { slug: claveOId }] },
        select: {
          id: true,
          titulo: true,
          slug: true,
          descripcion: true,
          imagenUrl: true,
          tipo: true,
          descuento: true,
          codigo: true,
          vigenciaDesde: true,
          vigenciaHasta: true,
          viewCount: true,
          shareCount: true,
          tags: true,
          isFeatured: true,
          createdAt: true,
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
              isPublished: true,
              isActive: true,
              // ¿Este negocio vende membresías? El detalle de una promoción
              // invitaba a "ver la empresa y sus planes" sin saberlo: en un
              // negocio que solo publica ofertas, el botón prometía una
              // sección que no existe.
              _count: { select: { plans: { where: { activo: true } } } },
            },
          },
          activo: true,
          archivada: true,
          visibilidad: true,
          // Fase E5: venta directa
          esComprable: true,
          precio: true,
          usosPorCompra: true,
          beneficioVigenciaDias: true,
          beneficioVigenciaHasta: true,
          limitePorCliente: true,
          maxCanjes: true,
          canjes: true,
        },
      })

      if (!promotion || !promotion.activo || promotion.archivada || !promotion.company) return null
      if (!promotion.company.isPublished || !promotion.company.isActive) return null
      if (promotion.vigenciaHasta && promotion.vigenciaHasta < now) return null

      // F4.2: las privadas solo las ve un miembro de esa empresa.
      if (promotion.visibilidad === 'privada') {
        const { getUser } = await import('@/lib/auth')
        const user = await getUser()
        if (!user) return null
        const esMiembro = await tx.cliente.findFirst({
          where: { supabaseId: user.supabaseId, companyId: promotion.company.id },
          select: { id: true },
        })
        if (!esMiembro) return null
      }

      const {
        activo: _activo, archivada: _arch, visibilidad: _vis,
        esComprable, precio, usosPorCompra, beneficioVigenciaDias, beneficioVigenciaHasta,
        limitePorCliente, maxCanjes, canjes,
        ...rest
      } = promotion
      // No exponer flags internos de la empresa en el payload público.
      const { isPublished: _p, isActive: _a, _count, ...companyBase } = rest.company
      const company = { ...companyBase, tienePlanes: _count.plans > 0 }
      const venta = esComprable
        ? {
            precio: Number(precio ?? 0),
            usosPorCompra,
            agotada: maxCanjes != null && canjes >= maxCanjes,
            beneficioVigenciaDias,
            beneficioVigenciaHasta,
            limitePorCliente: limitePorCliente ?? null,
          }
        : null
      return { ...rest, company, venta } as PromotionPublic
    })
  } catch (error) {
    console.error('[getPromotionDetail] Error:', error)
    return null
  }
}

/** Fase E8 · Datos mínimos para la vista previa al compartir (Open Graph).
 *  Solo promociones PÚBLICAS (activa, publicada, no privada, no vencida). */
export interface PromotionOg {
  id: string
  /** Para construir la URL canónica al compartir. */
  slug: string | null
  titulo: string
  descripcion: string
  imagenUrl: string | null
  tipo: string
  beneficioTipo: string
  descuento: number | null
  empresa: string
  logoUrl: string | null
  /** Share Engine: textos propios al compartir (si el negocio los editó). */
  ogTitulo: string | null
  ogDescripcion: string | null
}

export async function getPromotionOg(claveOId: string): Promise<PromotionOg | null> {
  if (!claveOId) return null
  try {
    const now = new Date()
    const p = await sinEmpresa('marketplace: vista previa pública (Open Graph)', (tx) =>
      tx.promocion.findFirst({
        where: {
          activo: true,
          archivada: false,
          visibilidad: 'publica',
          company: { isPublished: true, isActive: true, esDemo: false },
          // Dos condiciones OR distintas (identidad y vigencia) tienen que ir
          // dentro de AND: en el mismo objeto, la segunda pisaría a la primera.
          AND: [
            { OR: [{ id: claveOId }, { slug: claveOId }] },
            { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }] },
          ],
        },
        select: {
          id: true, slug: true, titulo: true, descripcion: true, imagenUrl: true, tipo: true,
          beneficioTipo: true, descuento: true,
          company: { select: { name: true, logoUrl: true } },
        },
      })
    )
    if (!p) return null
    // Textos editables al compartir. Consulta APARTE y defensiva: si la
    // columna shareConfig aún no existe (migración 20260757 pendiente), la
    // vista previa sigue funcionando con los textos base.
    const share = await sinEmpresa('marketplace: textos de compartir (Open Graph)', (tx) =>
      tx.promocion
        .findUnique({ where: { id: p.id }, select: { shareConfig: true } })
        .then((r) => (r?.shareConfig ?? {}) as { ogTitulo?: unknown; ogDescripcion?: unknown })
        .catch(() => ({}) as { ogTitulo?: unknown; ogDescripcion?: unknown })
    )
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return {
      id: p.id, slug: p.slug, titulo: p.titulo, descripcion: p.descripcion, imagenUrl: p.imagenUrl,
      tipo: p.tipo, beneficioTipo: p.beneficioTipo, descuento: p.descuento,
      empresa: p.company.name, logoUrl: p.company.logoUrl,
      ogTitulo: texto(share.ogTitulo), ogDescripcion: texto(share.ogDescripcion),
    }
  } catch (e) {
    console.error('[getPromotionOg]', e)
    return null
  }
}

/** Fase E8 · Membresías promocionables — plan como beneficio público con
 *  landing propia (compartible). Un plan es público si su empresa está
 *  publicada/activa y el plan activo. */
export interface PlanLanding {
  id: string
  nombre: string
  descripcion: string | null
  precio: number
  esIlimitado: boolean
  lavadosIncluidos: number
  beneficios: string[]
  vigenciaDias: number
  condiciones: string | null
  color: string | null
  company: { id: string; name: string; slug: string; logoUrl: string | null }
}

export async function getPlanPublic(planId: string): Promise<PlanLanding | null> {
  if (!planId) return null
  try {
    const plan = await sinEmpresa('marketplace: landing pública de plan', (tx) =>
      tx.plan.findUnique({
        where: { id: planId },
        select: {
          id: true, nombre: true, descripcion: true, precio: true, esIlimitado: true,
          lavadosIncluidos: true, beneficios: true, vigenciaDias: true, condiciones: true,
          color: true, activo: true,
          company: {
            select: { id: true, name: true, slug: true, logoUrl: true, isPublished: true, isActive: true },
          },
        },
      })
    )
    if (!plan || !plan.activo || !plan.company) return null
    if (!plan.company.isPublished || !plan.company.isActive) return null
    const { isPublished: _p, isActive: _a, ...company } = plan.company
    return {
      id: plan.id, nombre: plan.nombre, descripcion: plan.descripcion,
      precio: Number(plan.precio), esIlimitado: plan.esIlimitado,
      lavadosIncluidos: plan.lavadosIncluidos, beneficios: plan.beneficios,
      vigenciaDias: plan.vigenciaDias, condiciones: plan.condiciones, color: plan.color,
      company,
    }
  } catch (e) {
    console.error('[getPlanPublic]', e)
    return null
  }
}

/** Datos mínimos y seguros para la vista previa al compartir un plan. */
export interface PlanOg {
  id: string
  nombre: string
  descripcion: string
  precio: number
  esIlimitado: boolean
  lavadosIncluidos: number
  empresa: string
  logoUrl: string | null
}

export async function getPlanOg(planId: string): Promise<PlanOg | null> {
  if (!planId) return null
  try {
    const plan = await sinEmpresa('marketplace: vista previa pública de plan (Open Graph)', (tx) =>
      tx.plan.findUnique({
        where: { id: planId },
        select: {
          id: true, nombre: true, descripcion: true, precio: true, esIlimitado: true,
          lavadosIncluidos: true, activo: true,
          company: { select: { name: true, logoUrl: true, isPublished: true, isActive: true } },
        },
      })
    )
    if (!plan || !plan.activo || !plan.company) return null
    if (!plan.company.isPublished || !plan.company.isActive) return null
    return {
      id: plan.id, nombre: plan.nombre, descripcion: plan.descripcion ?? '',
      precio: Number(plan.precio), esIlimitado: plan.esIlimitado,
      lavadosIncluidos: plan.lavadosIncluidos,
      empresa: plan.company.name, logoUrl: plan.company.logoUrl,
    }
  } catch (e) {
    console.error('[getPlanOg]', e)
    return null
  }
}

/**
 * Categorías del marketplace, ya filtradas por `categoriasVisibles`: solo las
 * que tienen al menos una empresa publicada (la regla y su porqué, en types).
 *
 * SE FILTRA AQUÍ, EN EL ORIGEN, Y NO EN CADA PANTALLA. Antes solo lo hacía
 * `/cliente/inicio`, así que las mismas categorías vacías que la portada
 * escondía reaparecían en `/cliente/explorar` y en `/empresas`. Con el filtro
 * en la consulta, ninguna pantalla futura puede olvidarlo.
 */
export async function getCategoriesPublic(): Promise<CategoryPublic[]> {
  try {
    const categories = await sinEmpresa('marketplace: catálogo global de categorías', (tx) =>
      tx.businessCategory.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          slug: true,
          icon: true,
          description: true,
          order: true,
          _count: {
            select: {
              companies: {
                where: {
                  company: { isPublished: true, isActive: true, esDemo: false },
                },
              },
            },
          },
        },
        orderBy: { order: 'asc' },
      })
    )

    return categoriasVisibles(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        icon: c.icon,
        description: c.description,
        order: c.order,
        companyCount: c._count.companies,
      }))
    ) as CategoryPublic[]
  } catch (error) {
    console.error('[getCategoriesPublic] Error:', error)
    return []
  }
}

export async function getCompanyStats(companySlug: string): Promise<CompanyStats | null> {
  if (!companySlug) return null

  try {
    const company = await sinEmpresa('marketplace: stats públicas de empresa', (tx) =>
      tx.company.findUnique({
        where: { slug: companySlug },
        select: {
          totalMembersCount: true,
          activePromotionsCount: true,
          averageRating: true,
          // Conteo en la BD; antes se traían todas las filas de ratings.
          _count: { select: { ratings: true } },
        },
      })
    )

    if (!company) return null

    return {
      totalMembers: company.totalMembersCount,
      activePromotions: company.activePromotionsCount,
      averageRating: company.averageRating ? Number(company.averageRating) : null,
      totalRatings: company._count.ratings,
    }
  } catch (error) {
    console.error('[getCompanyStats] Error:', error)
    return null
  }
}

export async function getRecentCompanies(limit: number = 6): Promise<CompanyPublic[]> {
  return getCompaniesPublic({
    featured: false,
    limit,
    offset: 0,
  })
}

export async function getFeaturedCompanies(limit: number = 6): Promise<CompanyPublic[]> {
  return getCompaniesPublic({
    featured: true,
    limit,
    offset: 0,
  })
}

export interface PlatformStats {
  empresas: number
  membresiasActivas: number
  promocionesVigentes: number
  ciudades: number
}

/** Métricas reales de la plataforma para la landing (nunca datos personales). */
export async function getPlatformStats(): Promise<PlatformStats> {
  try {
    const now = new Date()
    const [empresas, membresiasActivas, promocionesVigentes, ciudadesRows] =
      await sinEmpresa('marketplace: métricas globales de la plataforma', (tx) =>
        Promise.all([
          tx.company.count({ where: { isActive: true, isPublished: true, esDemo: false } }),
          tx.membership.count({ where: membresiaVigente() }),
          tx.promocion.count({
            where: {
              activo: true,
              archivada: false,
              visibilidad: 'publica',
              vigenciaDesde: { lte: now },
              OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
              company: { isPublished: true, isActive: true, esDemo: false },
            },
          }),
          tx.company.findMany({
            where: { isActive: true, isPublished: true, ciudad: { not: null } },
            select: { ciudad: true },
            distinct: ['ciudad'],
          }),
        ])
      )
    return {
      empresas,
      membresiasActivas,
      promocionesVigentes,
      ciudades: ciudadesRows.length,
    }
  } catch (error) {
    console.error('[getPlatformStats] Error:', error)
    return { empresas: 0, membresiasActivas: 0, promocionesVigentes: 0, ciudades: 0 }
  }
}

export interface PlanPublic {
  id: string
  nombre: string
  precio: number
  esIlimitado: boolean
  lavadosIncluidos: number
  descripcion: string | null
  beneficios: string[]
  vigenciaDias: number
}

/** Un plan con el negocio que lo ofrece, para el catálogo global. */
export interface PlanConEmpresa extends PlanPublic {
  company: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    ciudad: string | null
    /**
     * Moneda e idioma de SU negocio. En un catálogo que mezcla empresas, un
     * precio formateado con la moneda de otra no es un detalle de estilo: son
     * 800 pesos mostrados como 800 dólares.
     */
    moneda: string | null
    idioma: string | null
  }
}

/**
 * EL CATÁLOGO DE PLANES DE TODA LA PLATAFORMA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ FALTABA
 *
 * «Planes» enseñaba los de UNA empresa: la que el cliente tuviera activa. Con
 * una sola empresa publicada eso era toda la verdad; con dos, la mitad. Y a
 * quien todavía no es cliente de nadie le enseñaba un estado vacío, que es la
 * peor respuesta posible a «quiero ver qué membresías hay».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MIRAR AQUÍ, CONTRATAR ALLÍ
 *
 * Esta consulta es de VITRINA: nombre, precio y qué incluye. No decide
 * elegibilidad ni precio por categoría de vehículo — eso lo hace
 * `planesElegibles` con la ficha del cliente en esa empresa, y sigue viviendo
 * en la pantalla de la empresa. Aquí no se contrata nada: cada plan lleva al
 * perfil de su negocio, donde el motor de elegibilidad decide qué se le puede
 * ofrecer y a qué precio.
 *
 * Mezclar las dos cosas sería enseñar un precio que a esa persona no le
 * corresponde.
 */
export async function getPlanesPublic(
  filtros: { search?: string; category?: string; limit?: number } = {}
): Promise<PlanConEmpresa[]> {
  const { search, category, limit = 60 } = filtros
  try {
    const planes = await sinEmpresa('marketplace: catálogo global de planes', (tx) =>
      tx.plan.findMany({
        where: {
          activo: true,
          company: {
            ...EMPRESA_EN_VITRINA,
            ...(category && { categories: { some: { category: { slug: category } } } }),
          },
          ...(search && {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { descripcion: { contains: search, mode: 'insensitive' } },
              { company: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }),
        },
        orderBy: [{ company: { isFeatured: 'desc' } }, { precio: 'asc' }],
        take: limit,
        select: {
          id: true, nombre: true, precio: true, esIlimitado: true,
          lavadosIncluidos: true, descripcion: true, beneficios: true, vigenciaDias: true,
          company: {
            select: {
              id: true, name: true, slug: true, logoUrl: true, ciudad: true,
              moneda: true, idioma: true,
            },
          },
        },
      })
    )
    return planes.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: Number(p.precio),
      esIlimitado: p.esIlimitado,
      lavadosIncluidos: p.lavadosIncluidos,
      descripcion: p.descripcion,
      beneficios: p.beneficios,
      vigenciaDias: p.vigenciaDias,
      company: p.company,
    }))
  } catch (error) {
    console.error('[getPlanesPublic] Error:', error)
    return []
  }
}

/** Planes activos de una empresa para mostrar en su perfil público. */
export async function getCompanyPlanesPublic(companyId: string): Promise<PlanPublic[]> {
  try {
    const planes = await sinEmpresa('marketplace: planes públicos de empresa', (tx) =>
      tx.plan.findMany({
        where: { companyId, activo: true },
        orderBy: [{ orden: 'asc' }, { precio: 'asc' }],
        select: {
          id: true, nombre: true, precio: true, esIlimitado: true,
          lavadosIncluidos: true, descripcion: true, beneficios: true, vigenciaDias: true,
        },
      })
    )
    return planes.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: Number(p.precio),
      esIlimitado: p.esIlimitado,
      lavadosIncluidos: p.lavadosIncluidos,
      descripcion: p.descripcion,
      beneficios: p.beneficios,
      vigenciaDias: p.vigenciaDias,
    }))
  } catch (error) {
    console.error('[getCompanyPlanesPublic] Error:', error)
    return []
  }
}

// ─── Sucursales públicas (Fase 4 · detalle sucursal-consciente) ─────────────

export interface SucursalPublic {
  id: string
  nombre: string
  direccion: string | null
  telefono: string | null
  latitud: number | null
  longitud: number | null
  ciudadTexto: string | null
  sectorTexto: string | null
  ubicacionVerificada: boolean
  /** Horario estructurado (parsed); null = desconocido. */
  horarioDetallado: Record<string, unknown> | null
}

/**
 * Sucursales visibles al público de una empresa (activas, con coordenadas y
 * marcadas para el mapa). El detalle del mapa llega con `?sucursal=`; aquí se
 * resuelve la ficha. Es la misma vitrina que alimenta "Cerca de mí".
 */
export async function getSucursalesPublic(companyId: string): Promise<SucursalPublic[]> {
  try {
    const sucursales = await sinEmpresa('marketplace: sucursales públicas de empresa', (tx) =>
      tx.sucursal.findMany({
        where: { companyId, activa: true, mostrarEnMapa: true },
        select: {
          id: true,
          nombre: true,
          direccion: true,
          telefono: true,
          latitud: true,
          longitud: true,
          ciudadTexto: true,
          sectorTexto: true,
          ubicacionVerificada: true,
          horarioDetallado: true,
        },
        orderBy: { createdAt: 'asc' },
      })
    )
    return sucursales.map((s) => ({
      ...s,
      // El horario viaja como objeto JSON (Prisma lo expone como JsonValue);
      // la UI lo interpreta con las reglas del módulo geo/cercanos/horario.
      horarioDetallado: (s.horarioDetallado as Record<string, unknown> | null) ?? null,
    }))
  } catch (error) {
    console.error('[getSucursalesPublic] Error:', error)
    return []
  }
}

// ─── F3.3: Publicaciones públicas de la empresa ──────────────────────────────

export interface CompanyPostPublic {
  id: string
  tipo: string
  titulo: string
  contenido: string
  imagenUrl: string | null
  fechaEvento: Date | null
  lugar: string | null
  publicadaEn: Date
}

export interface CompanyPostsPublic {
  beneficios: CompanyPostPublic[]
  eventos: CompanyPostPublic[]
  noticias: CompanyPostPublic[]
}

/** Beneficios, eventos futuros y noticias recientes del perfil público. */
export async function getCompanyPostsPublic(
  companyId: string
): Promise<CompanyPostsPublic> {
  const empty: CompanyPostsPublic = { beneficios: [], eventos: [], noticias: [] }
  try {
    const now = new Date()
    const select = {
      id: true,
      tipo: true,
      titulo: true,
      contenido: true,
      imagenUrl: true,
      fechaEvento: true,
      lugar: true,
      publicadaEn: true,
    } as const

    const [beneficios, eventos, noticias] = await sinEmpresa(
      'marketplace: publicaciones públicas de empresa',
      (tx) =>
        Promise.all([
          tx.companyPost.findMany({
            where: { companyId, activo: true, tipo: 'BENEFICIO' },
            select,
            orderBy: { publicadaEn: 'desc' },
            take: 12,
          }),
          tx.companyPost.findMany({
            where: {
              companyId,
              activo: true,
              tipo: 'EVENTO',
              fechaEvento: { gte: now },
            },
            select,
            orderBy: { fechaEvento: 'asc' },
            take: 12,
          }),
          tx.companyPost.findMany({
            where: { companyId, activo: true, tipo: 'NOTICIA' },
            select,
            orderBy: { publicadaEn: 'desc' },
            take: 12,
          }),
        ])
    )

    return { beneficios, eventos, noticias }
  } catch (error) {
    console.error('[getCompanyPostsPublic] Error:', error)
    return empty
  }
}
