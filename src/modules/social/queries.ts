import { prisma } from '@/lib/prisma'
import type { CompanyPublic, PromotionPublic } from '@/modules/marketplace/types'
import { SIN_DEMO } from '@/modules/demo'

// ─── FASE 3: capa social — seguir empresas y guardar promociones ────────────

export interface EmpresaSeguida {
  followId: string
  esFavorita: boolean
  seguidaDesde: Date
  company: {
    id: string
    name: string
    slug: string
    type: string
    description: string | null
    logoUrl: string | null
    bannerUrl: string | null
    ciudad: string | null
    activePromotionsCount: number
  }
}

/** Empresas que sigue el usuario, favoritas primero. */
export async function getMisEmpresas(dbUserId: string): Promise<EmpresaSeguida[]> {
  const follows = await prisma.companyFollow.findMany({
    // Seguir una empresa de práctica ya está bloqueado en la acción, pero el
    // filtro va también aquí: si alguna vez se marca como demo una empresa que
    // ya tenía seguidores, esos seguidores dejan de verla en el acto.
    where: { userId: dbUserId, company: { isActive: true, isPublished: true, ...SIN_DEMO } },
    orderBy: [{ esFavorita: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      esFavorita: true,
      createdAt: true,
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          logoUrl: true,
          bannerUrl: true,
          ciudad: true,
          activePromotionsCount: true,
        },
      },
    },
  })

  return follows.map((f) => ({
    followId: f.id,
    esFavorita: f.esFavorita,
    seguidaDesde: f.createdAt,
    company: f.company,
  }))
}

/** IDs de empresas seguidas (para marcar tarjetas). */
export async function getSeguidasIds(dbUserId: string): Promise<Set<string>> {
  const rows = await prisma.companyFollow.findMany({
    where: { userId: dbUserId },
    select: { companyId: true },
  })
  return new Set(rows.map((r) => r.companyId))
}

/** Promociones guardadas por el usuario (vigentes o no, más recientes primero). */
export async function getPromocionesGuardadas(
  dbUserId: string
): Promise<PromotionPublic[]> {
  const guardadas = await prisma.promocionGuardada.findMany({
    where: { userId: dbUserId },
    orderBy: { createdAt: 'desc' },
    select: {
      promocion: {
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
      },
    },
  })

  return guardadas.map((g) => g.promocion) as PromotionPublic[]
}

/** IDs de promociones guardadas (para marcar tarjetas). */
export async function getGuardadasIds(dbUserId: string): Promise<Set<string>> {
  const rows = await prisma.promocionGuardada.findMany({
    where: { userId: dbUserId },
    select: { promocionId: true },
  })
  return new Set(rows.map((r) => r.promocionId))
}

// ─── F3.2: Promociones inteligentes ──────────────────────────────────────────

const PROMO_SELECT = {
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
} as const

/**
 * Condición de promoción vigente y visible públicamente.
 *
 * `esDemo: false` es lo que impide que una promoción de una empresa de
 * práctica aparezca en las secciones de DESCUBRIMIENTO (destacadas, nuevas,
 * las que vencen, recomendadas). Ahí el cliente no pidió ver esa empresa: se
 * la estamos ofreciendo nosotros, y ofrecerle un negocio que no existe le hace
 * perder el viaje.
 */
function promoVigente(now: Date) {
  return {
    activo: true,
    archivada: false,
    visibilidad: 'publica',
    vigenciaDesde: { lte: now },
    OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
    company: { isPublished: true, isActive: true, ...SIN_DEMO },
  }
}

/**
 * Promociones de las empresas PROPIAS de la persona: las que sigue y aquellas
 * donde tiene ficha de cliente.
 *
 * Aquí NO se exige `isPublished` ni se excluyen las de práctica, y es
 * deliberado: quien es cliente de una empresa tiene que ver sus promociones
 * aunque el negocio todavía no se haya publicado en la vitrina — y quien entró
 * por el enlace de la empresa de práctica es cliente de ella. Sin esta
 * excepción, el entrenamiento enseñaría una pantalla de promociones vacía.
 *
 * El acotado real lo pone quien llama, con `companyId: { in: ... }`: solo
 * llegan aquí empresas que ya se comprobó que son suyas.
 */
function promoDeMisEmpresas(now: Date) {
  return {
    activo: true,
    archivada: false,
    vigenciaDesde: { lte: now },
    OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
    company: { isActive: true },
  }
}

export interface PromoFeed {
  /**
   * Promos de las empresas PROPIAS: las que sigue y aquellas donde es cliente
   * (favoritas primero). Incluye las que aún no están publicadas y las de
   * práctica — si son suyas, las ve.
   */
  misEmpresas: PromotionPublic[]
  /** Destacadas del marketplace (sin repetir las de arriba). */
  destacadas: PromotionPublic[]
  /** Publicadas en los últimos 14 días (sin repetir). */
  nuevas: PromotionPublic[]
  /** Vencen en los próximos 7 días (sin repetir). */
  expiranPronto: PromotionPublic[]
  /** Promos de empresas recomendadas que aún no sigue (sin repetir). */
  recomendadas: PromotionPublic[]
  /** Empresas sugeridas para seguir. */
  empresasRecomendadas: CompanyPublic[]
}

/**
 * Feed inteligente de promociones del cliente. Prioriza empresas seguidas
 * (las favoritas primero) y evita duplicados entre secciones: cada promoción
 * aparece solo en la sección de mayor prioridad.
 */
export async function getPromoFeed(dbUserId: string): Promise<PromoFeed> {
  const now = new Date()
  const en7dias = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const hace14dias = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  const [follows, dbUser] = await Promise.all([
    prisma.companyFollow.findMany({
      where: { userId: dbUserId },
      select: { companyId: true, esFavorita: true },
    }),
    prisma.user.findUnique({
      where: { id: dbUserId },
      select: { supabaseId: true },
    }),
  ])
  const seguidasIds = follows.map((f) => f.companyId)
  const favoritasIds = new Set(
    follows.filter((f) => f.esFavorita).map((f) => f.companyId)
  )

  // Empresas donde es MIEMBRO (cuenta de cliente): ahí también ve privadas.
  const miembroIds = dbUser
    ? (
        await prisma.cliente.findMany({
          where: { supabaseId: dbUser.supabaseId },
          select: { companyId: true },
        })
      ).map((c) => c.companyId)
    : []

  const misEmpresasIds = [...new Set([...seguidasIds, ...miembroIds])]

  const [misRaw, destacadasRaw, nuevasRaw, expiranRaw, empresasRecomendadas] =
    await Promise.all([
      // MIS EMPRESAS: las que sigo + aquellas donde soy cliente. Las segundas
      // se incluyen aunque no las siga porque son suyas de verdad — y porque
      // es el único camino por el que un cliente de una empresa de práctica (o
      // de una que aún no se publicó) ve sus propias promociones.
      misEmpresasIds.length > 0
        ? prisma.promocion.findMany({
            where: {
              ...promoDeMisEmpresas(now),
              companyId: { in: misEmpresasIds },
              // Públicas de cualquiera de las mías + privadas solo donde soy
              // cliente: una promo privada es para los miembros, no para
              // cualquiera que le dio a seguir.
              AND: [
                {
                  OR: [
                    { visibilidad: 'publica' },
                    ...(miembroIds.length > 0
                      ? [{ visibilidad: 'privada', companyId: { in: miembroIds } }]
                      : []),
                  ],
                },
              ],
            },
            select: PROMO_SELECT,
            orderBy: [{ prioridad: 'desc' }, { isFeatured: 'desc' }, { publicadaEn: 'desc' }],
            take: 30,
          })
        : Promise.resolve([]),
      prisma.promocion.findMany({
        where: { ...promoVigente(now), isFeatured: true },
        select: PROMO_SELECT,
        orderBy: [{ featuredOrder: 'asc' }, { publicadaEn: 'desc' }],
        take: 12,
      }),
      prisma.promocion.findMany({
        where: { ...promoVigente(now), publicadaEn: { gte: hace14dias } },
        select: PROMO_SELECT,
        orderBy: { publicadaEn: 'desc' },
        take: 12,
      }),
      prisma.promocion.findMany({
        where: {
          ...promoVigente(now),
          vigenciaHasta: { gte: now, lte: en7dias },
        },
        select: PROMO_SELECT,
        orderBy: { vigenciaHasta: 'asc' },
        take: 12,
      }),
      getEmpresasRecomendadas(dbUserId, seguidasIds, 4),
    ])

  // Favoritas primero dentro de "mis empresas".
  const misEmpresas = [...misRaw].sort((a, b) => {
    const favA = favoritasIds.has(a.company.id) ? 1 : 0
    const favB = favoritasIds.has(b.company.id) ? 1 : 0
    return favB - favA
  }) as PromotionPublic[]

  // Deduplicación por prioridad de sección.
  const vistos = new Set(misEmpresas.map((p) => p.id))
  const dedupe = (rows: typeof destacadasRaw, limit: number) => {
    const out: PromotionPublic[] = []
    for (const p of rows) {
      if (vistos.has(p.id)) continue
      vistos.add(p.id)
      out.push(p as PromotionPublic)
      if (out.length >= limit) break
    }
    return out
  }

  const destacadas = dedupe(destacadasRaw, 6)
  const nuevas = dedupe(nuevasRaw, 6)
  const expiranPronto = dedupe(expiranRaw, 6)

  // Recomendadas: promos vigentes de las empresas sugeridas.
  const recomendadasIds = empresasRecomendadas.map((c) => c.id)
  const recomendadasRaw =
    recomendadasIds.length > 0
      ? await prisma.promocion.findMany({
          where: { ...promoVigente(now), companyId: { in: recomendadasIds } },
          select: PROMO_SELECT,
          orderBy: [{ isFeatured: 'desc' }, { publicadaEn: 'desc' }],
          take: 12,
        })
      : []
  const recomendadas = dedupe(recomendadasRaw, 6)

  return { misEmpresas, destacadas, nuevas, expiranPronto, recomendadas, empresasRecomendadas }
}

/**
 * Empresas sugeridas para seguir: comparten categoría con las que ya sigue
 * (y no las sigue aún). Si no hay coincidencias, cae a las más populares.
 */
async function getEmpresasRecomendadas(
  dbUserId: string,
  seguidasIds: string[],
  limit: number
): Promise<CompanyPublic[]> {
  try {
    const companySelect = {
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
      categories: { select: { category: { select: { slug: true } } } },
    } as const

    const baseWhere = {
      isPublished: true,
      isActive: true,
      // Recomendar es ofrecer. Una empresa de práctica nunca se le ofrece a
      // nadie: se llega a ella por su enlace de registro o no se llega.
      ...SIN_DEMO,
      ...(seguidasIds.length > 0 && { id: { notIn: seguidasIds } }),
    }

    // Afinidad: categorías de las empresas seguidas + intereses del usuario
    // (F5.2 — el onboarding B2C alimenta directamente las recomendaciones).
    let candidatas: Awaited<
      ReturnType<typeof prisma.company.findMany<{ select: typeof companySelect }>>
    > = []

    {
      const [cats, intereses] = await Promise.all([
        seguidasIds.length > 0
          ? prisma.companyToCategory.findMany({
              where: { companyId: { in: seguidasIds } },
              select: { categoryId: true },
            })
          : Promise.resolve([]),
        prisma.userInteres.findMany({
          where: { userId: dbUserId },
          select: { categoryId: true },
        }),
      ])
      const categoryIds = [
        ...new Set([
          ...cats.map((c) => c.categoryId),
          ...intereses.map((i) => i.categoryId),
        ]),
      ]
      if (categoryIds.length > 0) {
        candidatas = await prisma.company.findMany({
          where: {
            ...baseWhere,
            categories: { some: { categoryId: { in: categoryIds } } },
          },
          select: companySelect,
          orderBy: [{ isFeatured: 'desc' }, { activePromotionsCount: 'desc' }],
          take: limit,
        })
      }
    }

    // Respaldo: populares del marketplace.
    if (candidatas.length < limit) {
      const extra = await prisma.company.findMany({
        where: {
          ...baseWhere,
          id: { notIn: [...seguidasIds, ...candidatas.map((c) => c.id)] },
        },
        select: companySelect,
        orderBy: [{ isFeatured: 'desc' }, { totalMembersCount: 'desc' }],
        take: limit - candidatas.length,
      })
      candidatas = [...candidatas, ...extra]
    }

    return candidatas.map((c) => ({
      ...c,
      categories: c.categories.map((cc) => cc.category.slug),
    })) as CompanyPublic[]
  } catch (e) {
    console.error('[social] getEmpresasRecomendadas', e)
    return []
  }
}

// ─── F3.4: Audiencia de la empresa ───────────────────────────────────────────

export interface AudienciaStats {
  seguidores: number
  nuevosSeguidores30d: number
  favoritos: number
  clientesNuevos30d: number
  vistasTotales: number
  compartidasTotales: number
  guardadasTotales: number
  /** % de vistas que terminaron en compartir o guardar. */
  ctr: number
  promos: {
    id: string
    titulo: string
    activo: boolean
    vistas: number
    compartidas: number
    guardadas: number
  }[]
}

/** Métricas de audiencia y engagement de una empresa (panel admin). */
export async function getAudienciaEmpresa(
  companyId: string
): Promise<AudienciaStats> {
  const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [
    seguidores,
    nuevosSeguidores30d,
    favoritos,
    clientesNuevos30d,
    agregados,
    guardadasTotales,
    promosRaw,
  ] = await Promise.all([
    prisma.companyFollow.count({ where: { companyId } }),
    prisma.companyFollow.count({
      where: { companyId, createdAt: { gte: hace30dias } },
    }),
    prisma.companyFollow.count({ where: { companyId, esFavorita: true } }),
    prisma.cliente.count({
      where: { companyId, createdAt: { gte: hace30dias } },
    }),
    prisma.promocion.aggregate({
      where: { companyId },
      _sum: { viewCount: true, shareCount: true },
    }),
    prisma.promocionGuardada.count({
      where: { promocion: { companyId } },
    }),
    prisma.promocion.findMany({
      where: { companyId },
      select: {
        id: true,
        titulo: true,
        activo: true,
        viewCount: true,
        shareCount: true,
        _count: { select: { guardadaPor: true } },
      },
      orderBy: { viewCount: 'desc' },
      take: 20,
    }),
  ])

  const vistasTotales = agregados._sum.viewCount ?? 0
  const compartidasTotales = agregados._sum.shareCount ?? 0
  const interacciones = compartidasTotales + guardadasTotales
  const ctr = vistasTotales > 0 ? (interacciones / vistasTotales) * 100 : 0

  return {
    seguidores,
    nuevosSeguidores30d,
    favoritos,
    clientesNuevos30d,
    vistasTotales,
    compartidasTotales,
    guardadasTotales,
    ctr,
    promos: promosRaw.map((p) => ({
      id: p.id,
      titulo: p.titulo,
      activo: p.activo,
      vistas: p.viewCount,
      compartidas: p.shareCount,
      guardadas: p._count.guardadaPor,
    })),
  }
}

// ─── F3.4: Novedades para el inicio del cliente ──────────────────────────────

export interface NovedadInicio {
  id: string
  /** 'PROMOCION' | 'EVENTO' | 'NOTICIA' | 'BENEFICIO' */
  tipo: string
  titulo: string
  companyName: string
  companySlug: string
  /** Fecha del evento (eventos) o de publicación (resto). */
  fecha: Date
  href: string
}

/**
 * Novedades recientes de las empresas que el usuario sigue, para el feed del
 * inicio: promociones nuevas, próximos eventos y publicaciones recientes.
 */
export async function getNovedadesInicio(
  dbUserId: string,
  limit = 6
): Promise<NovedadInicio[]> {
  try {
    const follows = await prisma.companyFollow.findMany({
      where: { userId: dbUserId },
      select: { companyId: true },
    })
    const companyIds = follows.map((f) => f.companyId)
    if (companyIds.length === 0) return []

    const now = new Date()
    const hace14dias = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const companySel = { select: { name: true, slug: true } } as const

    const [promos, posts] = await Promise.all([
      prisma.promocion.findMany({
        where: {
          companyId: { in: companyIds },
          activo: true,
          publicadaEn: { gte: hace14dias },
          OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: now } }],
        },
        select: {
          id: true,
          titulo: true,
          publicadaEn: true,
          company: companySel,
        },
        orderBy: { publicadaEn: 'desc' },
        take: limit,
      }),
      prisma.companyPost.findMany({
        where: {
          companyId: { in: companyIds },
          activo: true,
          OR: [
            // Eventos futuros…
            { tipo: 'EVENTO', fechaEvento: { gte: now } },
            // …y noticias/beneficios recientes.
            { tipo: { not: 'EVENTO' }, publicadaEn: { gte: hace14dias } },
          ],
        },
        select: {
          id: true,
          tipo: true,
          titulo: true,
          fechaEvento: true,
          publicadaEn: true,
          company: companySel,
        },
        orderBy: { publicadaEn: 'desc' },
        take: limit,
      }),
    ])

    const items: NovedadInicio[] = [
      ...promos.map((p) => ({
        id: p.id,
        tipo: 'PROMOCION',
        titulo: p.titulo,
        companyName: p.company.name,
        companySlug: p.company.slug,
        fecha: p.publicadaEn,
        href: `/cliente/promociones/${p.id}`,
      })),
      ...posts.map((p) => ({
        id: p.id,
        tipo: p.tipo as string,
        titulo: p.titulo,
        companyName: p.company.name,
        companySlug: p.company.slug,
        fecha: p.tipo === 'EVENTO' && p.fechaEvento ? p.fechaEvento : p.publicadaEn,
        href: `/cliente/empresas/${p.company.slug}`,
      })),
    ]

    // Más recientes primero (eventos por cercanía se mezclan por fecha).
    items.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    return items.slice(0, limit)
  } catch (e) {
    console.error('[social] getNovedadesInicio', e)
    return []
  }
}

// ─── F5.2: Onboarding del cliente ────────────────────────────────────────────

export interface OnboardingClienteItem {
  key: string
  label: string
  done: boolean
  href: string
  cta: string
}

export interface OnboardingCliente {
  items: OnboardingClienteItem[]
  completados: number
  total: number
}

/**
 * Checklist B2C calculado desde datos reales (retomable por diseño):
 * cuenta → perfil → intereses → seguir empresas → primera membresía.
 */
export async function getOnboardingCliente(
  dbUserId: string,
  supabaseId: string
): Promise<OnboardingCliente> {
  const [cliente, intereses, follows, memberships] = await Promise.all([
    prisma.cliente.findFirst({
      where: { supabaseId },
      select: { fechaNacimiento: true, telefono: true },
    }),
    prisma.userInteres.count({ where: { userId: dbUserId } }),
    prisma.companyFollow.count({ where: { userId: dbUserId } }),
    prisma.membership.count({
      where: { cliente: { supabaseId } },
    }),
  ])

  const items: OnboardingClienteItem[] = [
    {
      key: 'cuenta',
      label: 'Cuenta creada',
      done: true,
      href: '/cliente/perfil',
      cta: '',
    },
    {
      key: 'perfil',
      // El teléfono y la fecha de nacimiento son opcionales en el registro:
      // aquí es donde se SUGIERE completarlos (nunca se exigen).
      label: 'Perfil completado (teléfono y fecha de nacimiento)',
      done: !!cliente?.fechaNacimiento && !!cliente?.telefono,
      href: '/cliente/perfil',
      cta: 'Completar perfil',
    },
    {
      key: 'intereses',
      label: 'Intereses seleccionados',
      done: intereses > 0,
      href: '/cliente/intereses',
      cta: 'Elegir intereses',
    },
    {
      key: 'seguidas',
      label: 'Sigues al menos una empresa',
      done: follows > 0,
      href: '/cliente/explorar',
      cta: 'Descubrir empresas',
    },
    {
      key: 'membresia',
      label: 'Primera membresía',
      done: memberships > 0,
      href: '/cliente/explorar',
      cta: 'Explorar planes',
    },
  ]

  return {
    items,
    completados: items.filter((i) => i.done).length,
    total: items.length,
  }
}
