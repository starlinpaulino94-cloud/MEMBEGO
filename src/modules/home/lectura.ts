import { z } from 'zod'
import { conEmpresa } from '@/lib/tenant'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { LocationConsentService } from '@/modules/geo/consentimiento/service'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import { getCategoriesPublic, getFeaturedCompanies, getPlanesPublic, getFeaturedPromotions } from '@/modules/marketplace/cached'
import { excursionesDestacadas } from '@/modules/excursiones/catalogo/search-queries'
import { formatMoney } from '@/lib/format'
import type { SessionUser } from '@/types'
import { getHomePublicada } from './composicion'
import { HeroSlide, Segmentacion, TIPOS_BLOQUE } from './esquema'
import { admiteAudienciaHome } from './audiencia'
import { heroPublico } from './hero-publico'
import { duracionLegible, hechosDeEmpresas, totalesVitrina } from './vitrina'
import type { EmpresaInicio, ExperienciaInicio, InicioVista, PlanInicio } from './vista'

export async function getInicioPublicado(user: SessionUser): Promise<InicioVista | null> {
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
  const [heroes, categorias, empresas, planes, excursiones, promociones, totales] = await Promise.all([
    Promise.all(slides.map((slide) => heroPublico(companyId, slide))),
    tipos.includes('CATEGORIAS') ? getCategoriesPublic() : Promise.resolve([]),
    tipos.includes('DESTACADAS') ? getFeaturedCompanies(6) : Promise.resolve([]),
    tipos.includes('MEMBRESIAS') ? getPlanesPublic({ limit: 6 }) : Promise.resolve([]),
    tipos.includes('EXPERIENCIAS') ? excursionesDestacadas(4) : Promise.resolve([]),
    tipos.includes('DESTACADAS') ? getFeaturedPromotions(6) : Promise.resolve([]),
    totalesVitrina(),
  ])
  // Las reseñas y los planes de cada empresa se piden en un solo lote, y solo
  // para las que se van a pintar.
  const hechos = await hechosDeEmpresas(empresas.map((e) => e.id))
  const vigente = promociones.find((p) => p.venta && !p.venta.agotada && p.vigenciaHasta && p.vigenciaHasta > new Date())
  return {
    revisionId: revision.id, territorio: revision.territorio, bloques: tipos,
    heroes: heroes.filter((h) => h !== null), categorias,
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
    })),
    experiencias: excursiones.flatMap((e): ExperienciaInicio[] => e.company ? [{
      id: e.id, nombre: e.nombre, empresa: e.company.name, descripcion: e.descripcion,
      imagen: e.portadaUrl, href: `/empresas/${e.company.slug}/excursiones/${e.slug}`,
      precio: e.variantes.length === 0 ? null : formatMoney(Math.min(...e.variantes.map((v) => v.precioAdulto)), { moneda: e.moneda }),
      duracion: duracionLegible(e.duracionMin),
    }] : []),
    relampago: vigente?.vigenciaHasta ? { hasta: vigente.vigenciaHasta.toISOString(), href: `/cliente/promociones/${vigente.id}` } : null,
  }
}
