import { z } from 'zod'
import { differenceInDays } from 'date-fns'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { LocationConsentService } from '@/modules/geo/consentimiento/service'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { getCategoriesPublic, getCompaniesPublic, getPlanesPublic, getFeaturedPromotions, getPromotionsPublic } from '@/modules/marketplace/cached'
import { excursionesDestacadas } from '@/modules/excursiones/catalogo/search-queries'
import { getMisEmpresas, getPromoFeed } from '@/modules/social/queries'
import { formatMoney } from '@/lib/format'
import { formatDescuento, PROMO_TIPO_LABEL } from '@/lib/promociones'
import { EMPRESA_EN_VITRINA, promocionVigente } from '@/modules/promociones/vigencia'
import type { SessionUser } from '@/types'
import { getHomePublicada } from './composicion'
import { HeroSlide, Segmentacion, TIPOS_BLOQUE, type TipoBloque } from './esquema'
import { admiteAudienciaHome } from './audiencia'
import { heroPublico } from './hero-publico'
import { seleccionarNovedadesHero } from './novedades'
import { contextoHeroPorDefecto, duracionLegible, hechosDeEmpresas, totalesVitrina } from './vitrina'
import type {
  EmpresaInicio,
  EmpresaScrollItem,
  ExperienciaInicio,
  HeroInicio,
  InicioVista,
  NovedadHero,
  PlanInicio,
  PromoNovedadItem,
  PromocionesNovedadesVista,
} from './vista'

async function novedadesHero(categoriaSlug: string | undefined, ahora: Date): Promise<readonly NovedadHero[]> {
  const categoria = categoriaSlug
    ? { categories: { some: { category: { slug: categoriaSlug } } } }
    : {}
  const companyVitrina = { ...EMPRESA_EN_VITRINA, ...categoria }

  const [promociones, planes, empresas] = await sinEmpresa(
    'inicio: novedades públicas recientes de promociones, planes y empresas',
    (tx) => Promise.all([
      tx.promocion.findMany({
        where: {
          ...promocionVigente(ahora),
          visibilidad: 'publica',
          company: companyVitrina,
        },
        select: {
          id: true,
          titulo: true,
          descripcion: true,
          imagenUrl: true,
          tipo: true,
          descuento: true,
          vigenciaHasta: true,
          createdAt: true,
          company: { select: { name: true, logoUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      tx.plan.findMany({
        where: { activo: true, company: companyVitrina },
        select: {
          id: true,
          nombre: true,
          descripcion: true,
          imagenUrl: true,
          precio: true,
          vigenciaDias: true,
          esIlimitado: true,
          lavadosIncluidos: true,
          createdAt: true,
          company: { select: { name: true, slug: true, logoUrl: true, moneda: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      tx.company.findMany({
        where: { ...companyVitrina },
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          description: true,
          logoUrl: true,
          bannerUrl: true,
          ciudad: true,
          averageRating: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]),
  )

  const candidatas: NovedadHero[] = [
    ...promociones.map((promo): NovedadHero => ({
      tipo: 'PROMOCION',
      id: promo.id,
      creadoEn: promo.createdAt.toISOString(),
      titulo: promo.titulo,
      descripcion: promo.descripcion,
      empresa: promo.company.name,
      imagen: promo.imagenUrl ?? promo.company.logoUrl,
      href: `/cliente/promociones/${promo.id}`,
      descuento: promo.descuento != null
        ? formatDescuento(Number(promo.descuento), promo.tipo)
        : promo.tipo === '2x1' ? '2×1' : promo.tipo === '3x2' ? '3×2' : null,
      vigenciaHasta: promo.vigenciaHasta?.toISOString() ?? null,
    })),
    ...planes.map((plan): NovedadHero => ({
      tipo: 'MEMBRESIA',
      id: plan.id,
      creadoEn: plan.createdAt.toISOString(),
      titulo: plan.nombre,
      descripcion: plan.descripcion ?? (plan.lavadosIncluidos != null
        ? `Incluye ${plan.lavadosIncluidos} servicios`
        : plan.esIlimitado ? 'Servicios ilimitados' : null),
      empresa: plan.company.name,
      imagen: plan.imagenUrl ?? plan.company.logoUrl,
      href: `/cliente/planes/${plan.id}`,
      precio: formatMoney(Number(plan.precio), plan.company),
      periodo: plan.vigenciaDias ? `/${plan.vigenciaDias} días` : plan.esIlimitado ? 'Ilimitada' : '',
    })),
    ...empresas.map((empresa): NovedadHero => ({
      tipo: 'EMPRESA',
      id: empresa.id,
      creadoEn: empresa.createdAt.toISOString(),
      titulo: empresa.name,
      descripcion: empresa.description ?? empresa.type,
      empresa: empresa.name,
      imagen: empresa.bannerUrl ?? empresa.logoUrl,
      href: `/cliente/empresas/${empresa.slug}`,
      ciudad: empresa.ciudad,
      valoracion: empresa.averageRating != null ? Number(empresa.averageRating) : null,
    })),
  ]

  return seleccionarNovedadesHero(candidatas, ahora)
}

/**
 * EL INICIO DEL DISEÑO ES EL ESTADO POR DEFECTO, NO UN PREMIO POR PUBLICAR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * Esta lectura devolvía `null` salvo que la empresa activa tuviera una
 * composición PUBLICADA que además admitiera a la persona. Con una base real
 * donde ninguna empresa ha publicado, eso significaba que el Inicio de Stitch
 * no lo veía NADIE: todo el mundo caía al respaldo de ofertas, que era la
 * pantalla vieja con otro nombre. El rediseño quedaba condicionado a un acto
 * administrativo que quizá nunca ocurre.
 *
 * Ahora la vista SIEMPRE existe. Sin composición, los siete bloques del
 * contrato se arman con los datos del marketplace que ya alimentan cada
 * sección —empresas destacadas, planes, categorías, excursiones— y el hero
 * sale de las promociones destacadas, que son contenido real publicado por
 * los negocios. La composición publicada no habilita el diseño: LO CURA — qué
 * bloques, en qué orden, con qué banners propios y para qué audiencia.
 *
 * Si la segmentación de la composición no admite a la persona, cae al defecto,
 * no a la nada: excluir de una campaña no puede ser excluir de la app.
 */

/** La composición publicada, solo si existe Y admite a esta persona. */
async function composicionAdmitida(user: SessionUser) {
  const companyId = user.metadata.companyId
  if (!companyId) return null
  const revision = await getHomePublicada(companyId)
  if (!revision) return null
  const cabecera = revision.bloques.find((b) => b.tipo === 'CABECERA')
  const configuracion = z.object({ segmentacion: Segmentacion }).safeParse(cabecera?.config)
  if (!configuracion.success) return null
  const [empresa, membresia, ubicacion, consentimientos] = await Promise.all([
    conEmpresa(companyId, (tx) => tx.company.findFirst({
      where: { id: companyId, isActive: true, isPublished: true, esDemo: false },
      select: { latitud: true, longitud: true },
    })),
    conEmpresa(companyId, (tx) => tx.membership.count({
      where: { companyId, cliente: { supabaseId: user.supabaseId }, ...membresiaVigente() },
    })),
    LocationService.primaria(user.metadata.dbUserId),
    LocationConsentService.estadoDe(user.metadata.dbUserId),
  ])
  const centro = empresa?.latitud != null && empresa.longitud != null
    ? { latitud: empresa.latitud, longitud: empresa.longitud } : null
  const punto = consentimientos.MARKETING_GEO && ubicacion?.consentForPersonalization &&
    ubicacion.latitud != null && ubicacion.longitud != null
    ? { latitud: ubicacion.latitud, longitud: ubicacion.longitud } : null
  if (!admiteAudienciaHome(configuracion.data.segmentacion, { centro, ubicacion: punto, membresiaActiva: membresia > 0 }, new Date())) return null
  const tipos = z.enum(TIPOS_BLOQUE).array().parse(revision.bloques.filter((b) => b.activo).map((b) => b.tipo))
  const hero = revision.bloques.find((b) => b.tipo === 'HERO' && b.activo)
  const slides = hero ? z.object({ slides: HeroSlide.array().max(3) }).parse(hero.config).slides : []
  return { revision, tipos, slides, companyId }
}

/** El hero por defecto: las promociones activas destacadas con descuento, precio y contexto del negocio. */
async function heroesPorDefecto(
  promociones: any[],
  limite = 4
): Promise<HeroInicio[]> {
  const candidatas = [...promociones]
    .filter((p) => p && p.titulo)
    .sort((a, b) => {
      // Priorizar las que tienen imagen o descuento
      const hasImgA = a.imagenUrl || a.company?.logoUrl || a.empresa?.logoUrl ? 1 : 0
      const hasImgB = b.imagenUrl || b.company?.logoUrl || b.empresa?.logoUrl ? 1 : 0
      const hasDescA = a.descuento || a.descuentoTexto || a.tipo === '2x1' ? 1 : 0
      const hasDescB = b.descuento || b.descuentoTexto || b.tipo === '2x1' ? 1 : 0
      return (hasImgB + hasDescB) - (hasImgA + hasDescA)
    })
    .slice(0, limite)

  if (candidatas.length === 0) return []

  const companyIds = candidatas
    .map((p) => p.company?.id ?? p.empresa?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const contexto = await contextoHeroPorDefecto(companyIds)

  return candidatas.map((p) => {
    const compId = p.company?.id ?? p.empresa?.id
    const compName = p.company?.name ?? p.empresa?.nombre ?? 'Negocio afiliado'
    const compLogo = p.company?.logoUrl ?? p.empresa?.logoUrl ?? null
    const ctx = compId ? contexto.get(compId) : null

    const descuento = p.descuentoTexto ?? (
      p.descuento != null
        ? formatDescuento(Number(p.descuento), p.tipo)
        : p.tipo === '2x1'
          ? '2×1'
          : p.tipo === '3x2'
            ? '3×2'
            : null
    )

    const precio = p.precioTexto ?? (
      p.venta ? formatMoney(p.venta.precio) : (p.precio ? formatMoney(Number(p.precio)) : null)
    )

    return {
      titulo: p.titulo,
      subtitulo: p.descripcion,
      empresa: compName,
      ciudad: ctx?.ciudad ?? p.company?.ciudad ?? null,
      imagen: p.imagenUrl ?? compLogo ?? null,
      href: p.href ?? `/cliente/promociones/${p.id}`,
      cta: descuento ? 'Aprovechar oferta' : 'Ver beneficio',
      planDesde: ctx?.planDesde ?? null,
      color: ctx?.color ?? null,
      valoracion: ctx?.valoracion ?? (p.company?.averageRating != null ? Number(p.company.averageRating) : null),
      descuento,
      precio,
      etiqueta: descuento ? 'Oferta destacada' : 'Novedad destacada',
    }
  })
}

export async function getInicioVista(
  user: SessionUser,
  categoriaSlug?: string
): Promise<InicioVista> {
  const publicada = await composicionAdmitida(user).catch(() => null)
  const tipos: readonly TipoBloque[] = publicada?.tipos ?? TIPOS_BLOQUE
  let dbUserId = user.metadata.dbUserId
  const ahora = new Date()

  if (!dbUserId && (user.supabaseId || user.email)) {
    const dbUser = await sinEmpresa('resolver o vincular dbUserId para inicio', async (tx) => {
      let u = user.supabaseId
        ? await tx.user.findUnique({
            where: { supabaseId: user.supabaseId },
            select: { id: true, supabaseId: true },
          })
        : null

      if (!u && user.email) {
        u = await tx.user.findUnique({
          where: { email: user.email },
          select: { id: true, supabaseId: true },
        })
        if (u && user.supabaseId && u.supabaseId !== user.supabaseId) {
          await tx.user.update({
            where: { id: u.id },
            data: { supabaseId: user.supabaseId },
          })
        }
      }

      if (!u && user.supabaseId && user.email) {
        u = await tx.user
          .create({
            data: {
              supabaseId: user.supabaseId,
              email: user.email,
              name: user.email.split('@')[0],
              role: 'CLIENTE',
            },
            select: { id: true, supabaseId: true },
          })
          .catch(() => null)
      }

      return u
    }).catch(() => null)

    if (dbUser) {
      dbUserId = dbUser.id
    }
  }

  const userIds = [dbUserId, user.supabaseId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  )
  const userIdentities = [
    ...(user.supabaseId ? [{ supabaseId: user.supabaseId }] : []),
    ...(user.email ? [{ email: user.email }] : []),
  ]

  const [
    categorias,
    empresas,
    planesRaw,
    excursiones,
    promociones,
    totales,
    misEmpresas,
    promoFeed,
    planesActivosIds,
    novedadesHeroData,
    userFollows,
    clientesEmpresas,
    membresiasEmpresas,
  ] = await Promise.all([
    tipos.includes('CATEGORIAS') ? getCategoriesPublic() : Promise.resolve([]),
    getCompaniesPublic({ category: categoriaSlug, limit: 15, sortBy: 'rating' }),
    getPlanesPublic({ category: categoriaSlug, limit: 20 }),
    tipos.includes('EXPERIENCIAS') && (!categoriaSlug || ['tours', 'turismo', 'excursiones'].includes(categoriaSlug.toLowerCase()))
      ? excursionesDestacadas(4)
      : Promise.resolve([]),
    // Las promociones activas (públicas y destacadas) alimentan el hero, novedades y relámpago
    getPromotionsPublic({ category: categoriaSlug, limit: 20 }).catch(() =>
      categoriaSlug ? [] : getFeaturedPromotions(10)
    ),
    totalesVitrina(),
    dbUserId ? getMisEmpresas(dbUserId).catch(() => []) : Promise.resolve([]),
    dbUserId ? getPromoFeed(dbUserId).catch(() => null) : Promise.resolve(null),
    sinEmpresa('membresías activas del usuario para exclusión en inicio', async (tx) => {
      const rows = await tx.membership.findMany({
        where: {
          cliente: { supabaseId: user.supabaseId },
          estado: 'ACTIVA',
          OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: ahora } }],
        },
        select: { planId: true },
      })
      return new Set(rows.map((r) => r.planId))
    }).catch(() => new Set<string>()),
    novedadesHero(categoriaSlug, ahora),
    userIds.length > 0
      ? sinEmpresa('lectura: follows directos para favoritos', (tx) =>
          tx.companyFollow.findMany({
            where: { userId: { in: userIds } },
            select: { companyId: true, esFavorita: true },
          })
        ).catch(() => [])
      : Promise.resolve([]),
    userIdentities.length > 0
      ? sinEmpresa('lectura: empresas cliente directo', (tx) =>
          tx.cliente.findMany({
            where: {
              OR: userIdentities,
              company: { isActive: true },
            },
            select: { companyId: true },
          })
        ).catch(() => [])
      : Promise.resolve([]),
    userIdentities.length > 0
      ? sinEmpresa('lectura: empresas membresia activa', (tx) =>
          tx.membership.findMany({
            where: {
              cliente: { OR: userIdentities },
              estado: 'ACTIVA',
              OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: ahora } }],
            },
            select: { companyId: true },
          })
        ).catch(() => [])
      : Promise.resolve([]),
  ])

  const misEmpresasIds = new Set(misEmpresas.map((me) => me.company.id))
  const misEmpresasClienteIds = new Set([
    ...misEmpresas.filter((me) => me.esCliente).map((me) => me.company.id),
    ...clientesEmpresas.map((c) => c.companyId),
    ...membresiasEmpresas.map((m) => m.companyId),
  ])
  const empresasIdsDeCategoria = new Set(empresas.map((e) => e.id))

  const favoritasSet = new Set<string>()
  const seguidasSet = new Set<string>()
  for (const f of userFollows) {
    if (f.esFavorita) favoritasSet.add(f.companyId)
    seguidasSet.add(f.companyId)
  }
  for (const me of misEmpresas) {
    if (me.esFavorita) favoritasSet.add(me.company.id)
    if (me.sigo) seguidasSet.add(me.company.id)
  }
  const misEmpresasMap = new Map(misEmpresas.map((me) => [me.company.id, me]))

  const UN_MES_MS = 30 * 24 * 60 * 60 * 1000
  const esNuevaFn = (createdAt?: Date | string | null) => {
    if (!createdAt) return false
    const fecha = new Date(createdAt)
    const diff = ahora.getTime() - fecha.getTime()
    return diff >= 0 && diff < UN_MES_MS
  }

  // Scroll horizontal de empresas: ordenadas por mejor valoración (calificación y reseñas),
  // combinando las empresas de la persona y las del marketplace (máx. 10).
  const scrollMap = new Map<string, EmpresaScrollItem>()
  for (const me of misEmpresas) {
    if (scrollMap.size >= 20) break
    if (categoriaSlug && !empresasIdsDeCategoria.has(me.company.id)) continue
    const esFav = favoritasSet.has(me.company.id) || Boolean(me.esFavorita)
    const esCliente = misEmpresasClienteIds.has(me.company.id) || me.esCliente
    const sigo = seguidasSet.has(me.company.id) || Boolean(me.sigo)
    scrollMap.set(me.company.id, {
      id: me.company.id,
      nombre: me.company.name,
      slug: me.company.slug,
      rubro: me.company.description ?? me.company.type,
      ciudad: me.company.ciudad,
      logoUrl: me.company.logoUrl,
      bannerUrl: me.company.bannerUrl,
      href: `/cliente/empresas/${me.company.slug}`,
      valoracion: me.company.averageRating != null ? Number(me.company.averageRating) : null,
      resenas: 0,
      esMia: true,
      esFavorita: esFav,
      etiquetaRelacion: esCliente ? 'Miembro' : (sigo || esFav) ? 'Siguiendo' : null,
      esNueva: esNuevaFn(me.company.createdAt),
      creadoEn: me.company.createdAt ? new Date(me.company.createdAt).toISOString() : null,
    })
  }

  for (const fe of empresas) {
    if (scrollMap.size >= 20) break
    if (!scrollMap.has(fe.id)) {
      const relacion = misEmpresasMap.get(fe.id)
      const esFav = favoritasSet.has(fe.id) || Boolean(relacion?.esFavorita)
      const sigo = seguidasSet.has(fe.id) || Boolean(relacion?.sigo)
      const esCliente = misEmpresasClienteIds.has(fe.id) || Boolean(relacion?.esCliente)
      const esMia = esCliente || sigo || esFav || misEmpresasIds.has(fe.id)

      scrollMap.set(fe.id, {
        id: fe.id,
        nombre: fe.name,
        slug: fe.slug,
        rubro: fe.description,
        ciudad: fe.ciudad,
        logoUrl: fe.logoUrl,
        bannerUrl: fe.bannerUrl,
        href: `/cliente/empresas/${fe.slug}`,
        valoracion: fe.averageRating != null ? Number(fe.averageRating) : null,
        resenas: 0,
        esMia,
        esFavorita: esFav,
        etiquetaRelacion: esCliente ? 'Miembro' : (sigo || esFav) ? 'Siguiendo' : null,
        esNueva: esNuevaFn(fe.createdAt),
        creadoEn: fe.createdAt ? new Date(fe.createdAt).toISOString() : null,
      })
    }
  }

  const empresasScrollBase = [...scrollMap.values()]

  // Calificaciones y conteos de planes/reseñas en un solo lote
  const hechos = await hechosDeEmpresas([
    ...empresas.map((e) => e.id),
    ...planesRaw.map((p) => p.company.id),
    ...empresasScrollBase.map((e) => e.id),
  ])

  const empresasScroll: EmpresaScrollItem[] = empresasScrollBase
    .map((e) => ({
      ...e,
      valoracion: e.valoracion ?? null,
      resenas: hechos.get(e.id)?.resenas ?? e.resenas,
      planes: hechos.get(e.id)?.planes ?? 0,
    }))
    .sort((a, b) => {
      // 1. Mayor valoración (estrellas)
      const valA = a.valoracion != null ? Number(a.valoracion) : 0
      const valB = b.valoracion != null ? Number(b.valoracion) : 0
      if (valB !== valA) return valB - valA

      // 2. Más reseñas
      if (b.resenas !== a.resenas) return b.resenas - a.resenas

      // 3. Desempate por afinidad (favoritas y miembros primero si tienen igual valoración)
      const afinidadA = (a.esFavorita ? 2 : 0) + (a.esMia ? 1 : 0)
      const afinidadB = (b.esFavorita ? 2 : 0) + (b.esMia ? 1 : 0)
      if (afinidadB !== afinidadA) return afinidadB - afinidadA

      // 4. Más planes activos
      return (b.planes ?? 0) - (a.planes ?? 0)
    })
    .slice(0, 10)

  // 1. Excluir planes activos del usuario para no ofrecer lo que ya compró
  const planesDisponibles = planesRaw.filter((p) => !planesActivosIds.has(p.id))

  // 2. Personalización y badges de recomendación
  const planesConAfinidad = planesDisponibles.map((p) => {
    let score = 0
    let motivoRecomendacion: string | null = null

    if (misEmpresasIds.has(p.company.id)) {
      score += 100
      motivoRecomendacion = 'De tus negocios'
    } else if (p.company.averageRating != null && p.company.averageRating >= 4.5) {
      score += 25
      motivoRecomendacion = 'Más popular'
    }

    return { plan: p, score, motivoRecomendacion }
  })

  planesConAfinidad.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.plan.precio - b.plan.precio
  })

  const planesRecomendados: PlanInicio[] = (
    planesConAfinidad.length > 0 ? planesConAfinidad.slice(0, 6) : planesRaw.slice(0, 6).map((p) => ({ plan: p, score: 0, motivoRecomendacion: null }))
  ).map(({ plan: p, motivoRecomendacion }) => ({
    id: p.id,
    nombre: p.nombre,
    empresa: p.company.name,
    esCliente: misEmpresasClienteIds.has(p.company.id),
    descripcion: p.descripcion,
    imagen: p.imagenUrl ?? p.company.logoUrl,
    href: `/cliente/planes/${p.id}`,
    precio: formatMoney(p.precio, p.company),
    periodo: `/ ${p.vigenciaDias} días`,
    valoracion: p.company.averageRating,
    resenas: hechos.get(p.company.id)?.resenas ?? 0,
    motivoRecomendacion,
  }))

  // Construcción del feed de novedades y promociones activas
  const armarPromoItem = (
    p: any,
    motivo: PromoNovedadItem['motivo'] = 'afinidad'
  ): PromoNovedadItem => {
    const dias = p.vigenciaHasta ? differenceInDays(new Date(p.vigenciaHasta), ahora) : null
    const tipoLabel = PROMO_TIPO_LABEL[p.tipo] ?? p.tipo
    const descuentoTexto = p.descuento != null
      ? formatDescuento(Number(p.descuento), p.tipo)
      : p.tipo === '2x1'
        ? '2×1'
        : p.tipo === '3x2'
          ? '3×2'
          : null

    const precioTexto = p.venta ? formatMoney(p.venta.precio) : (p.precio ? formatMoney(Number(p.precio)) : null)

    return {
      id: p.id,
      titulo: p.titulo,
      slug: p.slug ?? null,
      descripcion: p.descripcion,
      imagenUrl: p.imagenUrl,
      tipo: p.tipo,
      tipoEtiqueta: tipoLabel,
      descuentoTexto,
      precioTexto,
      vigenciaHasta: p.vigenciaHasta ? new Date(p.vigenciaHasta).toISOString() : null,
      diasRestantes: dias !== null ? Math.max(0, dias) : null,
      href: `/cliente/promociones/${p.id}`,
      empresa: {
        id: p.company.id,
        nombre: p.company.name,
        slug: p.company.slug,
        logoUrl: p.company.logoUrl,
      },
      esPrivadaMiembros: p.visibilidad === 'privada',
      esDeMiEmpresa: misEmpresasIds.has(p.company.id),
      motivo,
    }
  }

  const promoFeedCandidatas = categoriaSlug
    ? [
      ...(promoFeed?.misEmpresas ?? []),
      ...(promoFeed?.nuevas ?? []),
      ...(promoFeed?.destacadas ?? []),
      ...(promoFeed?.recomendadas ?? []),
    ].filter((p: any) => {
      const compId = p.company?.id ?? p.empresa?.id
      return compId && empresasIdsDeCategoria.has(compId)
    })
    : [
      ...(promoFeed?.misEmpresas ?? []),
      ...(promoFeed?.nuevas ?? []),
      ...(promoFeed?.destacadas ?? []),
      ...(promoFeed?.recomendadas ?? []),
    ]

  const poolPromos: any[] = [
    ...promoFeedCandidatas,
    ...promociones,
  ]

  const uniquePoolMap = new Map<string, any>()
  for (const pr of poolPromos) {
    if (!uniquePoolMap.has(pr.id)) uniquePoolMap.set(pr.id, pr)
  }
  const pool = [...uniquePoolMap.values()]

  const paraTiRaw = [
    ...promoFeedCandidatas,
    ...promociones,
  ]
  const paraTiVistos = new Set<string>()
  const paraTi: PromoNovedadItem[] = []
  for (const p of paraTiRaw) {
    if (paraTiVistos.size >= 8) break
    if (!paraTiVistos.has(p.id)) {
      paraTiVistos.add(p.id)
      paraTi.push(armarPromoItem(p, 'afinidad'))
    }
  }

  const exclusivas: PromoNovedadItem[] = []
  const exclusivasVistos = new Set<string>()
  for (const p of pool) {
    if (exclusivasVistos.size >= 8) break
    if (!exclusivasVistos.has(p.id) && (p.visibilidad === 'privada' || p.tipo === 'vip' || misEmpresasIds.has(p.company.id))) {
      exclusivasVistos.add(p.id)
      exclusivas.push(armarPromoItem(p, 'exclusiva'))
    }
  }

  const descuentos: PromoNovedadItem[] = []
  const descuentosVistos = new Set<string>()
  for (const p of pool) {
    if (descuentosVistos.size >= 8) break
    const esDescuentoFuerte =
      p.tipo === '2x1' ||
      p.tipo === '3x2' ||
      p.tipo === 'happy_hour' ||
      (p.descuento != null && Number(p.descuento) >= 20)
    if (!descuentosVistos.has(p.id) && esDescuentoFuerte) {
      descuentosVistos.add(p.id)
      descuentos.push(armarPromoItem(p, 'descuento'))
    }
  }

  const en7Dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000)
  const porVencer: PromoNovedadItem[] = []
  const porVencerVistos = new Set<string>()
  const candidatosPorVencer = pool
    .filter((p) => p.vigenciaHasta && new Date(p.vigenciaHasta) > ahora && new Date(p.vigenciaHasta) <= en7Dias)
    .sort((a, b) => new Date(a.vigenciaHasta).getTime() - new Date(b.vigenciaHasta).getTime())

  for (const p of candidatosPorVencer) {
    if (porVencerVistos.size >= 8) break
    if (!porVencerVistos.has(p.id)) {
      porVencerVistos.add(p.id)
      porVencer.push(armarPromoItem(p, 'vencimiento'))
    }
  }

  const promocionesNovedades: PromocionesNovedadesVista = {
    paraTi,
    exclusivas,
    descuentos,
    porVencer,
    total: pool.length,
  }

  // Las promociones activas alimentan el Hero principal en la sección de novedades
  const heroesPublicados = publicada
    ? (await Promise.all(publicada.slides.map((slide) => heroPublico(publicada.companyId, slide)))).filter(
      (h): h is HeroInicio => h !== null
    )
    : []

  const heroesPromos = await heroesPorDefecto(
    paraTi.length > 0 ? paraTi : pool,
    4
  )

  const heroes = [...heroesPromos, ...heroesPublicados].slice(0, 4)

  // Tarjeta relámpago del rediseño
  const urgentes = pool
    .filter((p) => p.venta && !p.venta.agotada && p.vigenciaHasta && new Date(p.vigenciaHasta) > ahora)
    .sort((a, b) => new Date(a.vigenciaHasta!).getTime() - new Date(b.vigenciaHasta!).getTime())
    .slice(0, 2)

  return {
    revisionId: publicada?.revision.id ?? null,
    territorio: publicada?.revision.territorio ?? null,
    categoriaActiva: categoriaSlug ?? null,
    bloques: [...tipos],
    heroes,
    novedadesHero: novedadesHeroData,
    categorias,
    empresasTotal: categoriaSlug ? empresas.length : totales.empresas,
    empresasScroll,
    promocionesNovedades,
    planesTotal: categoriaSlug ? planesRecomendados.length : totales.planes,
    empresas: empresas.map((e): EmpresaInicio => ({
      id: e.id, nombre: e.name, rubro: e.description, ciudad: e.ciudad,
      imagen: e.bannerUrl ?? e.logoUrl, href: `/cliente/empresas/${e.slug}`,
      valoracion: e.averageRating,
      resenas: hechos.get(e.id)?.resenas ?? 0,
      planes: hechos.get(e.id)?.planes ?? 0,
      planDesde: e.desdePlan?.nombre ?? null,
    })),
    planes: planesRecomendados,
    experiencias: excursiones.flatMap((e): ExperienciaInicio[] => e.company ? [{
      id: e.id, nombre: e.nombre, empresa: e.company.name, descripcion: e.descripcion,
      imagen: e.portadaUrl, href: `/empresas/${e.company.slug}/excursiones/${e.slug}`,
      precio: e.variantes.length === 0 ? null : formatMoney(Math.min(...e.variantes.map((v) => v.precioAdulto)), { moneda: e.moneda }),
      duracion: duracionLegible(e.duracionMin),
    }] : []),
    relampago: urgentes.length > 0 && urgentes[0].vigenciaHasta
      ? {
        hasta: new Date(urgentes[0].vigenciaHasta).toISOString(),
        promos: urgentes.map((p) => ({
          id: p.id,
          titulo: p.titulo,
          empresa: p.company.name,
          imagen: p.imagenUrl,
          href: `/cliente/promociones/${p.id}`,
          precio: p.venta ? formatMoney(p.venta.precio) : null,
          descuento: p.descuento != null ? formatDescuento(Number(p.descuento), p.tipo) : null,
          hasta: new Date(p.vigenciaHasta!).toISOString(),
        })),
      }
      : null,
  }
}
