import { z } from 'zod'
import { conEmpresa } from '@/lib/tenant'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { LocationConsentService } from '@/modules/geo/consentimiento/service'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { getCategoriesPublic, getFeaturedCompanies, getPlanesPublic, getFeaturedPromotions } from '@/modules/marketplace/cached'
import { excursionesDestacadas } from '@/modules/excursiones/catalogo/search-queries'
import { formatMoney } from '@/lib/format'
import { formatDescuento } from '@/lib/promociones'
import type { SessionUser } from '@/types'
import { getHomePublicada } from './composicion'
import { HeroSlide, Segmentacion, TIPOS_BLOQUE, type TipoBloque } from './esquema'
import { admiteAudienciaHome } from './audiencia'
import { heroPublico } from './hero-publico'
import { contextoHeroPorDefecto, duracionLegible, hechosDeEmpresas, totalesVitrina } from './vitrina'
import type { EmpresaInicio, ExperienciaInicio, HeroInicio, InicioVista, PlanInicio } from './vista'

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

  const [categorias, empresas, planes, excursiones, promociones, totales] = await Promise.all([
    tipos.includes('CATEGORIAS') ? getCategoriesPublic() : Promise.resolve([]),
    tipos.includes('DESTACADAS') ? getFeaturedCompanies(6) : Promise.resolve([]),
    tipos.includes('MEMBRESIAS') ? getPlanesPublic({ limit: 6 }) : Promise.resolve([]),
    tipos.includes('EXPERIENCIAS') ? excursionesDestacadas(4) : Promise.resolve([]),
    // Las promociones alimentan el relámpago siempre, y el hero cuando no hay
    // composición: se piden una vez (van cacheadas 120 s).
    getFeaturedPromotions(6),
    totalesVitrina(),
  ])

  const heroes = publicada
    ? (await Promise.all(publicada.slides.map((slide) => heroPublico(publicada.companyId, slide)))).filter(
        (h): h is HeroInicio => h !== null
      )
    : await heroesPorDefecto(promociones)

  // Las reseñas y los planes de cada empresa se piden en un solo lote, y solo
  // para las que se van a pintar (empresas destacadas + las de los planes:
  // las estrellas del bloque «Relacionado» son de la empresa del plan).
  const hechos = await hechosDeEmpresas([
    ...empresas.map((e) => e.id),
    ...planes.map((p) => p.company.id),
  ])

  // Tarjeta relámpago del rediseño: las promociones comprables y vigentes,
  // ordenadas por la que vence antes. El countdown global es el de la más
  // urgente; cada fila lleva su propio vencimiento.
  // new Date() en la comparación: tras `unstable_cache` la fecha llega como
  // STRING y `string > Date` compara texto — el bloque desaparecía solo en
  // cargas cacheadas (la familia del Decimal de siempre).
  const ahora = new Date()
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
    planesTotal: totales.planes,
    empresas: empresas.map((e): EmpresaInicio => ({
      id: e.id, nombre: e.name, rubro: e.description, ciudad: e.ciudad,
      imagen: e.bannerUrl ?? e.logoUrl, href: `/cliente/empresas/${e.slug}`,
      valoracion: e.averageRating,
      resenas: hechos.get(e.id)?.resenas ?? 0,
      planes: hechos.get(e.id)?.planes ?? 0,
      planDesde: e.desdePlan?.nombre ?? null,
    })),
    planes: planes.map((p): PlanInicio => ({
      id: p.id, nombre: p.nombre, empresa: p.company.name, descripcion: p.descripcion,
      imagen: p.company.logoUrl, href: `/plan/${p.id}`,
      precio: formatMoney(p.precio, p.company), periodo: `/ ${p.vigenciaDias} días`,
      valoracion: p.company.averageRating,
      resenas: hechos.get(p.company.id)?.resenas ?? 0,
    })),
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
