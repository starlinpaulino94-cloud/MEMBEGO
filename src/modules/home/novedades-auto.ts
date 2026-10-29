import { unstable_cache } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { getSupabaseUrl } from '@/lib/env'
import { formatDescuento } from '@/lib/promociones'
import { formatearPrecio } from '@/modules/catalog/formato'
import { novedadesDeCatalogo } from '@/modules/catalog/publico'
import { capacidadesDeEmpresa, type CategoriaNegocio } from '@/modules/capacidades/catalogo'
import { ofertasPublicas } from '@/modules/deals/publico'
import { rutaDeItem, rutaDePlan, type Espacio } from '@/modules/comercio/rutas'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import { FORMATOS_BANNER, esHex, type FormatoBanner, type OrigenBanner } from './banner-formatos'
import {
  SIN_AJUSTE,
  armarCola,
  estaVigente,
  heroDePieza,
  plantillaDePieza,
  type AjusteBanner,
  type PiezaBanner,
} from './banner-hero'
import { colorDominanteDeUrl } from './color-dominante'
import type { HeroInicio } from './vista'

/**
 * LA COLA AUTOMÁTICA DEL CARRUSEL (aprobado 2026-10-29).
 *
 * Reúne lo que las empresas públicas publicaron —promociones, productos y
 * servicios, ofertas, planes—, le aplica lo que cada empresa decidió
 * (`banners_inicio`: fijar, ocultar, plantilla) y lo ordena: primero lo
 * fijado, después de lo más reciente a lo más viejo, con un tope por empresa
 * para que una sola no acapare el carrusel.
 *
 * No depende de la persona que mira: se cachea con el tag del marketplace y lo
 * invalidan las mismas acciones que ya lo invalidan al publicar o pausar algo
 * (más las de ajustar un banner).
 */

const EMPRESA_VISIBLE = { isPublished: true, isActive: true, esDemo: false } as const
/** Cuántas piezas de cada origen se leen: con las más recientes sobra para llenar seis. */
const LECTURA_POR_ORIGEN = 30
/** Cuántos colores se calculan por pasada: cada uno baja una imagen. */
const MAX_COLORES_POR_PASADA = 3

interface DatosEmpresa {
  id: string
  nombre: string
  slug: string
  colorMarca: string | null
  rubro: CategoriaNegocio | null
}

function colorMarcaValido(c: string | null): string | null {
  return c && esHex(c) ? c : null
}

async function leerEmpresas(filtro: { ids?: string[]; slugs?: string[] }): Promise<Map<string, DatosEmpresa>> {
  const filas = await sinEmpresa('banners: datos públicos de las empresas con piezas', (tx) =>
    tx.company.findMany({
      where: {
        ...EMPRESA_VISIBLE,
        ...(filtro.ids ? { id: { in: filtro.ids } } : {}),
        ...(filtro.slugs ? { slug: { in: filtro.slugs } } : {}),
      },
      select: { id: true, name: true, slug: true, colorPrimario: true, type: true, tipoNegocioCodigo: true, capacidades: true },
    })
  )
  const mapa = new Map<string, DatosEmpresa>()
  for (const f of filas) {
    mapa.set(f.id, {
      id: f.id,
      nombre: f.name,
      slug: f.slug,
      colorMarca: colorMarcaValido(f.colorPrimario),
      rubro: capacidadesDeEmpresa({ type: f.type, tipoNegocioCodigo: f.tipoNegocioCodigo, capacidades: f.capacidades }).categoria,
    })
  }
  return mapa
}

/** `-30%`, `2×1`, `3×2` o null. */
function descuentoDePromo(p: { descuento: number | null; tipo: string }): string | null {
  if (p.descuento != null) return formatDescuento(p.descuento, p.tipo)
  if (p.tipo === '2x1') return '2×1'
  if (p.tipo === '3x2') return '3×2'
  return null
}

function precioPlan(precio: number, vigenciaDias: number): string {
  return `${formatearPrecio(precio, 'DOP')} / ${vigenciaDias} días`
}

/** Todas las piezas públicas vigentes, sin ajustes aplicados todavía. */
export async function leerPiezasPublicas(espacio: Espacio, ahora = new Date()): Promise<PiezaBanner[]> {
  const piezas: PiezaBanner[] = []

  const [promos, planes, novedadesCatalogo, ofertas] = await Promise.all([
    sinEmpresa('banners: promociones públicas vigentes', (tx) =>
      tx.promocion.findMany({
        where: {
          activo: true,
          archivada: false,
          visibilidad: 'publica',
          publicadaEn: { lte: ahora },
          vigenciaDesde: { lte: ahora },
          OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gt: ahora } }],
          company: EMPRESA_VISIBLE,
        },
        orderBy: [{ publicadaEn: 'desc' }, { id: 'asc' }],
        take: LECTURA_POR_ORIGEN,
        select: {
          id: true, companyId: true, titulo: true, descripcion: true, imagenUrl: true, imagenes: true,
          tipo: true, descuento: true, publicadaEn: true, vigenciaHasta: true, precio: true, esComprable: true,
        },
      })
    ),
    sinEmpresa('banners: planes activos de empresas públicas', (tx) =>
      tx.plan.findMany({
        where: { activo: true, company: EMPRESA_VISIBLE },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LECTURA_POR_ORIGEN,
        select: {
          id: true, companyId: true, nombre: true, descripcion: true, imagenUrl: true, precio: true,
          vigenciaDias: true, beneficios: true, createdAt: true,
        },
      })
    ),
    novedadesDeCatalogo(LECTURA_POR_ORIGEN),
    ofertasPublicas({ limite: LECTURA_POR_ORIGEN }, ahora),
  ])

  // Una sola lectura de las empresas dueñas, por id y por slug (las ofertas solo traen el slug).
  const ids = new Set<string>([...promos.map((p) => p.companyId), ...planes.map((p) => p.companyId), ...novedadesCatalogo.map((n) => n.companyId)])
  const slugsOfertas = [...new Set(ofertas.map((o) => o.empresa.slug))]
  const [porId, porSlug] = await Promise.all([
    leerEmpresas({ ids: [...ids] }),
    slugsOfertas.length > 0 ? leerEmpresas({ slugs: slugsOfertas }) : Promise.resolve(new Map<string, DatosEmpresa>()),
  ])
  const slugAEmpresa = new Map([...porSlug.values()].map((e) => [e.slug, e]))

  const pieza = (p: Omit<PiezaBanner, 'clave' | 'companyId' | 'empresa'> & { origen: OrigenBanner; empresa: DatosEmpresa }): PiezaBanner => ({
    ...p,
    clave: `${p.origen}:${p.id}`,
    companyId: p.empresa.id,
    empresa: { nombre: p.empresa.nombre, slug: p.empresa.slug, colorMarca: p.empresa.colorMarca, rubro: p.empresa.rubro },
  })

  for (const p of promos) {
    const empresa = porId.get(p.companyId)
    if (!empresa || !p.titulo) continue
    const imagenes = [p.imagenUrl, ...(p.imagenes ?? [])].filter((u): u is string => !!u)
    piezas.push(
      pieza({
        origen: 'PROMOCION',
        id: p.id,
        empresa,
        titulo: p.titulo,
        subtitulo: p.descripcion ?? '',
        imagen: imagenes[0] ?? null,
        imagenes: [...new Set(imagenes)],
        precio: p.esComprable && p.precio != null ? (Number(p.precio) === 0 ? 'Gratis' : formatearPrecio(Number(p.precio), 'DOP')) : null,
        precioAntes: null,
        descuento: descuentoDePromo(p),
        detalle: null,
        vence: p.vigenciaHasta,
        publicadoEn: p.publicadaEn,
        href: `/cliente/promociones/${p.id}`,
        verbo: descuentoDePromo(p) ? 'Aprovechar oferta' : 'Ver beneficio',
      })
    )
  }

  for (const n of novedadesCatalogo) {
    const empresa = porId.get(n.companyId)
    if (!empresa) continue
    piezas.push(
      pieza({
        origen: 'CATALOGO',
        id: n.item.id,
        empresa,
        titulo: n.item.name,
        subtitulo: '',
        imagen: n.imagenes[0] ?? n.item.imageUrl,
        imagenes: n.imagenes,
        precio: n.item.priceFrom != null ? `${n.item.hasVariants ? 'Desde ' : ''}${formatearPrecio(n.item.priceFrom, n.item.currency)}` : null,
        precioAntes: null,
        descuento: null,
        detalle: null,
        vence: null,
        publicadoEn: n.publicadoEn,
        href: rutaDeItem(espacio, n.item.company.slug, n.item.slug),
      })
    )
  }

  for (const o of ofertas) {
    const empresa = slugAEmpresa.get(o.empresa.slug)
    if (!empresa) continue
    piezas.push(
      pieza({
        origen: 'OFERTA',
        id: o.id,
        empresa,
        titulo: o.title || o.itemName,
        subtitulo: o.itemName,
        imagen: o.imageUrl,
        imagenes: o.imageUrl ? [o.imageUrl] : [],
        precio: formatearPrecio(o.precioAhora, o.currency),
        precioAntes: formatearPrecio(o.precioAntes, o.currency),
        descuento: o.etiqueta,
        detalle: null,
        vence: o.endsAt ? new Date(o.endsAt) : null,
        publicadoEn: o.publicadaEn ? new Date(o.publicadaEn) : new Date(0),
        href: `${espacio === 'app' ? '/cliente' : ''}/ofertas/${o.id}`,
        verbo: 'Obtener oferta',
      })
    )
  }

  for (const p of planes) {
    const empresa = porId.get(p.companyId)
    if (!empresa) continue
    piezas.push(
      pieza({
        origen: 'PLAN',
        id: p.id,
        empresa,
        titulo: p.nombre,
        subtitulo: p.descripcion ?? '',
        imagen: p.imagenUrl,
        imagenes: p.imagenUrl ? [p.imagenUrl] : [],
        precio: precioPlan(Number(p.precio), p.vigenciaDias),
        precioAntes: null,
        descuento: null,
        detalle: p.beneficios.slice(0, 2).join(' · ') || null,
        vence: null,
        publicadoEn: p.createdAt,
        href: rutaDePlan(espacio, p.id),
        verbo: 'Contrata',
      })
    )
  }
  return piezas
}

/** Los ajustes que las empresas guardaron, por clave de pieza. */
export async function leerAjustes(companyIds: readonly string[]): Promise<Map<string, AjusteBanner>> {
  const mapa = new Map<string, AjusteBanner>()
  if (companyIds.length === 0) return mapa
  const filas = await sinEmpresa('banners: ajustes de las empresas con piezas', (tx) =>
    tx.bannerInicio.findMany({ where: { companyId: { in: [...companyIds] } } })
  )
  for (const f of filas) {
    mapa.set(`${f.origenTipo}:${f.origenId}`, {
      plantilla: (FORMATOS_BANNER as readonly string[]).includes(f.plantilla ?? '') ? (f.plantilla as FormatoBanner) : null,
      fijado: f.fijado,
      oculto: f.oculto,
      orden: f.orden,
      colorDominante: f.colorDominante && esHex(f.colorDominante) ? f.colorDominante : null,
    })
  }
  return mapa
}

/** Solo las plantillas que pintan el color de la foto lo necesitan. */
const PLANTILLAS_CON_COLOR: readonly FormatoBanner[] = ['PRECIO_GRANDE', 'ANTES_AHORA']

/**
 * Calcula, y guarda, el color dominante de las fotos que lo necesitan y aún no
 * lo tienen. Mejor esfuerzo: sin imagen, sin red o con un fallo se queda con el
 * color de marca o el del rubro, y no rompe el carrusel.
 */
async function completarColores(
  elegidas: { pieza: PiezaBanner; plantilla: FormatoBanner; ajuste: AjusteBanner }[],
): Promise<void> {
  const pendientes = elegidas
    .filter((e) => PLANTILLAS_CON_COLOR.includes(e.plantilla) && e.pieza.imagen && !e.ajuste.colorDominante)
    .slice(0, MAX_COLORES_POR_PASADA)
  const base = `${getSupabaseUrl().replace(/\/+$/, '')}/storage/v1/object/public/`
  await Promise.all(
    pendientes.map(async (e) => {
      try {
        const color = await colorDominanteDeUrl(e.pieza.imagen!, base)
        if (!color) return
        ;(e as { ajuste: AjusteBanner }).ajuste = { ...e.ajuste, colorDominante: color }
        await sinEmpresa('banners: guardar el color dominante calculado de una pieza', (tx) =>
          tx.bannerInicio.upsert({
            where: { companyId_origenTipo_origenId: { companyId: e.pieza.companyId, origenTipo: e.pieza.origen, origenId: e.pieza.id } },
            create: { companyId: e.pieza.companyId, origenTipo: e.pieza.origen, origenId: e.pieza.id, colorDominante: color },
            update: { colorDominante: color },
          })
        )
      } catch (error) {
        console.warn('[banners] no se pudo calcular el color dominante:', error instanceof Error ? error.name : 'unknown')
      }
    })
  )
}

/** La cola ya ordenada, con tope por empresa y tope total. */
export async function heroesAutomaticosSinCache(espacio: Espacio, ahora = new Date()): Promise<HeroInicio[]> {
  const piezas = await leerPiezasPublicas(espacio, ahora)
  if (piezas.length === 0) return []
  const ajustes = await leerAjustes([...new Set(piezas.map((p) => p.companyId))])
  const elegidas = armarCola(piezas, ajustes, ahora)
  await completarColores(elegidas)
  return elegidas.map((e) => heroDePieza(e.pieza, e.plantilla, e.ajuste))
}

/** Una pieza de la lista del panel: lo que se ve, lo que se decidió y si está dentro del carrusel. */
export interface FilaDeCarrusel {
  pieza: PiezaBanner
  ajuste: AjusteBanner
  plantilla: FormatoBanner
  /** Está HOY en el carrusel de los clientes. */
  enCarrusel: boolean
  /** Por qué no está, si no está. */
  motivoFuera: 'OCULTO' | 'VENCIDO' | 'ANTIGUO' | 'LLENO' | null
}

/**
 * La lista del panel: TODAS las piezas públicas de la empresa (también las que
 * hoy no entran) con su plantilla y su estado, en el orden en que salen: lo
 * que está dentro del carrusel primero, después lo demás por fecha.
 */
export async function filasDeCarrusel(companyId: string, ahora = new Date()): Promise<FilaDeCarrusel[]> {
  const piezas = await leerPiezasPublicas('app', ahora)
  const ajustes = await leerAjustes([...new Set(piezas.map((p) => p.companyId))])
  const dentro = new Set(armarCola(piezas, ajustes, ahora).map((e) => e.pieza.clave))
  const mias = piezas.filter((p) => p.companyId === companyId)
  const filas = mias.map((pieza): FilaDeCarrusel => {
    const ajuste = ajustes.get(pieza.clave) ?? SIN_AJUSTE
    const enCarrusel = dentro.has(pieza.clave)
    let motivoFuera: FilaDeCarrusel['motivoFuera'] = null
    if (!enCarrusel) {
      if (ajuste.oculto) motivoFuera = 'OCULTO'
      else if (pieza.vence && pieza.vence.getTime() <= ahora.getTime()) motivoFuera = 'VENCIDO'
      else if (!estaVigente(pieza, ajuste, ahora)) motivoFuera = 'ANTIGUO'
      else motivoFuera = 'LLENO'
    }
    return { pieza, ajuste, plantilla: plantillaDePieza(pieza, ajuste, ahora), enCarrusel, motivoFuera }
  })
  return filas.sort((a, b) => {
    if (a.enCarrusel !== b.enCarrusel) return a.enCarrusel ? -1 : 1
    if (a.ajuste.fijado !== b.ajuste.fijado) return a.ajuste.fijado ? -1 : 1
    if (a.ajuste.fijado && b.ajuste.fijado && a.ajuste.orden !== b.ajuste.orden) return a.ajuste.orden - b.ajuste.orden
    return b.pieza.publicadoEn.getTime() - a.pieza.publicadoEn.getTime()
  })
}

/**
 * Con caché de 2 minutos y el tag del marketplace: lo que se publica o se
 * ajusta lo invalida (`revalidateTag(MARKETPLACE_TAG)`).
 */
export async function getHeroesAutomaticos(espacio: Espacio): Promise<HeroInicio[]> {
  const fn = unstable_cache(() => heroesAutomaticosSinCache(espacio), ['home-novedades-auto', espacio], {
    revalidate: 120,
    tags: [MARKETPLACE_TAG],
  })
  return fn()
}
