import { z } from 'zod'
import { differenceInDays } from 'date-fns'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { LocationConsentService } from '@/modules/geo/consentimiento/service'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { getCategoriesPublic, getFeaturedCompanies, getPlanesPublic, getFeaturedPromotions } from '@/modules/marketplace/cached'
import { excursionesDestacadas } from '@/modules/excursiones/catalogo/search-queries'
import { getMisEmpresas, getPromoFeed } from '@/modules/social/queries'
import { formatMoney } from '@/lib/format'
import { formatDescuento, PROMO_TIPO_LABEL } from '@/lib/promociones'
import type { SessionUser } from '@/types'
import { getHomePublicada } from './composicion'
import { HeroSlide, Segmentacion, TIPOS_BLOQUE, type TipoBloque } from './esquema'
import { admiteAudienciaHome } from './audiencia'
import { heroPublico } from './hero-publico'
import { contextoHeroPorDefecto, duracionLegible, hechosDeEmpresas, totalesVitrina } from './vitrina'
import type {
  EmpresaInicio,
  EmpresaScrollItem,
  ExperienciaInicio,
  HeroInicio,
  InicioVista,
  PlanInicio,
  PromoNovedadItem,
  PromocionesNovedadesVista,
} from './vista'

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

/** El hero por defecto: las promociones destacadas del marketplace, con la
 *  ciudad y el plan más barato de su negocio. Contenido real, no maqueta. */
async function heroesPorDefecto(
  promociones: Awaited<ReturnType<typeof getFeaturedPromotions>>
): Promise<HeroInicio[]> {
  const primeras = promociones.filter((p) => p.imagenUrl).slice(0, 3)
  const contexto = await contextoHeroPorDefecto(primeras.map((p) => p.company.id))
  return primeras.map((p) => ({
    titulo: p.titulo,
    subtitulo: p.descripcion,
    empresa: p.company.name,
    ciudad: contexto.get(p.company.id)?.ciudad ?? null,
    imagen: p.imagenUrl,
    href: `/cliente/promociones/${p.id}`,
    cta: 'Ver beneficios',
    planDesde: contexto.get(p.company.id)?.planDesde ?? null,
    color: contexto.get(p.company.id)?.color ?? null,
    valoracion: contexto.get(p.company.id)?.valoracion ?? null,
  }))
}

export async function getInicioVista(user: SessionUser): Promise<InicioVista> {
  const publicada = await composicionAdmitida(user).catch(() => null)
  const tipos: readonly TipoBloque[] = publicada?.tipos ?? TIPOS_BLOQUE
  const dbUserId = user.metadata.dbUserId
  const ahora = new Date()

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
  ] = await Promise.all([
    tipos.includes('CATEGORIAS') ? getCategoriesPublic() : Promise.resolve([]),
    getFeaturedCompanies(10),
    getPlanesPublic({ limit: 20 }),
    tipos.includes('EXPERIENCIAS') ? excursionesDestacadas(4) : Promise.resolve([]),
    // Las promociones alimentan el relámpago siempre, y el hero cuando no hay composición
    getFeaturedPromotions(10),
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
  ])

  const misEmpresasIds = new Set(misEmpresas.map((me) => me.company.id))

  // Scroll horizontal híbrido de empresas: primero las que sigue o donde es cliente,
  // completadas con empresas populares del marketplace (máx. 10).
  const scrollMap = new Map<string, EmpresaScrollItem>()
  for (const me of misEmpresas) {
    if (scrollMap.size >= 10) break
    scrollMap.set(me.company.id, {
      id: me.company.id,
      nombre: me.company.name,
      slug: me.company.slug,
      rubro: me.company.description ?? me.company.type,
      ciudad: me.company.ciudad,
      logoUrl: me.company.logoUrl,
      bannerUrl: me.company.bannerUrl,
      href: `/cliente/empresas/${me.company.slug}`,
      valoracion: null,
      resenas: 0,
      esMia: true,
      etiquetaRelacion: me.esCliente ? 'Miembro' : me.esFavorita ? 'Favorita' : 'Siguiendo',
    })
  }

  for (const fe of empresas) {
    if (scrollMap.size >= 10) break
    if (!scrollMap.has(fe.id)) {
      scrollMap.set(fe.id, {
        id: fe.id,
        nombre: fe.name,
        slug: fe.slug,
        rubro: fe.description,
        ciudad: fe.ciudad,
        logoUrl: fe.logoUrl,
        bannerUrl: fe.bannerUrl,
        href: `/cliente/empresas/${fe.slug}`,
        valoracion: fe.averageRating,
        resenas: 0,
        esMia: misEmpresasIds.has(fe.id),
        etiquetaRelacion: null,
      })
    }
  }

  const empresasScrollBase = [...scrollMap.values()]

  const heroes = publicada
    ? (await Promise.all(publicada.slides.map((slide) => heroPublico(publicada.companyId, slide)))).filter(
        (h): h is HeroInicio => h !== null
      )
    : await heroesPorDefecto(promociones)

  // Calificaciones y conteos de planes/reseñas en un solo lote
  const hechos = await hechosDeEmpresas([
    ...empresas.map((e) => e.id),
    ...planesRaw.map((p) => p.company.id),
    ...empresasScrollBase.map((e) => e.id),
  ])

  const empresasScroll: EmpresaScrollItem[] = empresasScrollBase.map((e) => ({
    ...e,
    valoracion: e.valoracion ?? null,
    resenas: hechos.get(e.id)?.resenas ?? e.resenas,
  }))

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
    descripcion: p.descripcion,
    imagen: p.company.logoUrl,
    href: `/plan/${p.id}`,
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

  const poolPromos: any[] = promoFeed
    ? [
        ...promoFeed.misEmpresas,
        ...promoFeed.destacadas,
        ...promoFeed.nuevas,
        ...promoFeed.recomendadas,
      ]
    : promociones

  const uniquePoolMap = new Map<string, any>()
  for (const pr of poolPromos) {
    if (!uniquePoolMap.has(pr.id)) uniquePoolMap.set(pr.id, pr)
  }
  const pool = [...uniquePoolMap.values()]

  const paraTiRaw = promoFeed
    ? [...promoFeed.misEmpresas, ...promoFeed.recomendadas, ...promoFeed.destacadas]
    : promociones
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

  // Tarjeta relámpago del rediseño
  const urgentes = promociones
    .filter((p) => p.venta && !p.venta.agotada && p.vigenciaHasta && new Date(p.vigenciaHasta) > ahora)
    .sort((a, b) => new Date(a.vigenciaHasta!).getTime() - new Date(b.vigenciaHasta!).getTime())
    .slice(0, 2)

  return {
    revisionId: publicada?.revision.id ?? null,
    territorio: publicada?.revision.territorio ?? null,
    bloques: [...tipos],
    heroes,
    categorias,
    empresasTotal: totales.empresas,
    empresasScroll,
    promocionesNovedades,
    planesTotal: totales.planes,
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
