'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import type { AdminSection } from '@/lib/auth/permissions'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'
import {
  ORIGENES_BANNER,
  FORMATOS_BANNER,
  FORMATOS_BANNER_INFO,
  plantillasDisponibles,
  type FormatoBanner,
  type OrigenBanner,
} from './banner-formatos'
import { SIN_AJUSTE, heroDePieza, plantillaDePieza } from './banner-hero'
import { leerAjustes, leerPiezasPublicas, type FilaDeCarrusel } from './novedades-auto'
import type { HeroInicio } from './vista'

/**
 * LO QUE LA EMPRESA DECIDE SOBRE UN BANNER AUTOMÁTICO: destacarlo (fijarlo
 * arriba), ocultarlo, cambiarle la plantilla, reordenar lo fijado.
 *
 * Cada acción exige la sección del panel DONDE SE CREA la pieza (promociones,
 * catálogo, ofertas, planes): quien puede publicar una promoción puede
 * destacarla, sin necesitar además el editor de inicio. Y nunca se confía en
 * lo que manda el navegador: la empresa sale de la sesión y la pieza tiene que
 * ser PÚBLICA y de ESA empresa; si no, es «no se encontró», igual que si no
 * existiera.
 */

const SECCION_POR_ORIGEN: Record<OrigenBanner, AdminSection> = {
  PROMOCION: 'promociones',
  CATALOGO: 'catalogo',
  OFERTA: 'deals',
  PLAN: 'planes',
}

export type ResultadoBanner = { ok: true } | { ok: false; error: string }

async function contexto(origen: string): Promise<{ companyId: string; origen: OrigenBanner } | null> {
  if (!(ORIGENES_BANNER as readonly string[]).includes(origen)) return null
  const tipo = origen as OrigenBanner
  const user = await requireSection(SECCION_POR_ORIGEN[tipo])
  if (!user) return null
  const companyId = await resolveCompanyId(user)
  return companyId ? { companyId, origen: tipo } : null
}

function refrescar() {
  revalidateTag(MARKETPLACE_TAG, 'max')
  revalidatePath('/admin/personalizacion/carrusel')
  revalidatePath('/cliente/inicio')
}

/** La pieza pública y vigente de ESTA empresa, o null. */
async function piezaDeEmpresa(companyId: string, origen: OrigenBanner, id: string) {
  const clave = `${origen}:${id}`
  const piezas = await leerPiezasPublicas('app')
  return piezas.find((p) => p.clave === clave && p.companyId === companyId) ?? null
}

export interface VistaDeDestacar {
  hero: HeroInicio
  plantilla: FormatoBanner
  plantillas: { id: FormatoBanner; nombre: string }[]
  /** Ya estaba fijada. */
  yaFijada: boolean
}

/**
 * Lo que el aviso «¿Lo destacamos?» necesita: la tarjeta ya armada, la
 * plantilla elegida sola y las alternativas que caben en esa pieza.
 */
export async function vistaDeDestacar(
  origen: string,
  id: string,
): Promise<({ ok: true } & VistaDeDestacar) | { ok: false; error: string }> {
  const ctx = await contexto(origen)
  if (!ctx) return { ok: false, error: 'No autorizado.' }
  const pieza = await piezaDeEmpresa(ctx.companyId, ctx.origen, id)
  if (!pieza) return { ok: false, error: 'Esto todavía no se ve en el marketplace, así que no se puede destacar.' }
  const ajuste = (await leerAjustes([ctx.companyId])).get(pieza.clave) ?? SIN_AJUSTE
  const ahora = new Date()
  const plantilla = plantillaDePieza(pieza, ajuste, ahora)
  const disponibles = plantillasDisponibles({ origen: pieza.origen, nImagenes: pieza.imagenes.length, vence: !!pieza.vence })
  return {
    ok: true,
    hero: heroDePieza(pieza, plantilla, ajuste),
    plantilla,
    plantillas: disponibles.map((f) => ({ id: f, nombre: FORMATOS_BANNER_INFO[f].nombre })),
    yaFijada: ajuste.fijado,
  }
}

/** El `orden` que deja a una pieza recién fijada PRIMERA entre las fijadas. */
async function ordenAlFrente(companyId: string): Promise<number> {
  const primera = await sinEmpresa('banners: primer orden entre los fijados de la empresa', (tx) =>
    tx.bannerInicio.findFirst({ where: { companyId, fijado: true }, orderBy: { orden: 'asc' }, select: { orden: true } })
  )
  return (primera?.orden ?? 1) - 1
}

function plantillaValida(pieza: { origen: OrigenBanner; imagenes: readonly string[]; vence: Date | null }, plantilla: string | null | undefined): FormatoBanner | null {
  if (!plantilla) return null
  if (!(FORMATOS_BANNER as readonly string[]).includes(plantilla)) return null
  const permitidas = plantillasDisponibles({ origen: pieza.origen, nImagenes: pieza.imagenes.length, vence: !!pieza.vence })
  return permitidas.includes(plantilla as FormatoBanner) ? (plantilla as FormatoBanner) : null
}

/** «Destacar ahora»: la pieza va PRIMERA del carrusel hasta que venza o la quiten. */
export async function destacarPieza(origen: string, id: string, plantilla?: string | null): Promise<ResultadoBanner> {
  const ctx = await contexto(origen)
  if (!ctx) return { ok: false, error: 'No autorizado.' }
  const pieza = await piezaDeEmpresa(ctx.companyId, ctx.origen, id)
  if (!pieza) return { ok: false, error: 'Esto todavía no se ve en el marketplace, así que no se puede destacar.' }
  const elegida = plantillaValida(pieza, plantilla)
  const orden = await ordenAlFrente(ctx.companyId)
  await sinEmpresa('banners: destacar una pieza de la empresa', (tx) =>
    tx.bannerInicio.upsert({
      where: { companyId_origenTipo_origenId: { companyId: ctx.companyId, origenTipo: ctx.origen, origenId: id } },
      create: { companyId: ctx.companyId, origenTipo: ctx.origen, origenId: id, fijado: true, oculto: false, orden, plantilla: elegida },
      update: { fijado: true, oculto: false, orden, ...(elegida ? { plantilla: elegida } : {}) },
    })
  )
  refrescar()
  return { ok: true }
}

export interface CambiosBanner {
  plantilla?: string | null
  fijado?: boolean
  oculto?: boolean
}

/** Cambios sueltos desde la lista del panel: plantilla, fijar, ocultar. */
export async function ajustarPieza(origen: string, id: string, cambios: CambiosBanner): Promise<ResultadoBanner> {
  const ctx = await contexto(origen)
  if (!ctx) return { ok: false, error: 'No autorizado.' }
  const pieza = await piezaDeEmpresa(ctx.companyId, ctx.origen, id)
  if (!pieza) return { ok: false, error: 'No se encontró.' }
  const datos: { plantilla?: FormatoBanner | null; fijado?: boolean; oculto?: boolean; orden?: number } = {}
  if ('plantilla' in cambios) {
    // `null` o vacío = volver a la automática; algo que no cabe en la pieza se rechaza.
    if (!cambios.plantilla) datos.plantilla = null
    else {
      const valida = plantillaValida(pieza, cambios.plantilla)
      if (!valida) return { ok: false, error: 'Esa plantilla no cabe en esta pieza.' }
      datos.plantilla = valida
    }
  }
  if (typeof cambios.oculto === 'boolean') datos.oculto = cambios.oculto
  if (typeof cambios.fijado === 'boolean') {
    datos.fijado = cambios.fijado
    if (cambios.fijado) datos.orden = await ordenAlFrente(ctx.companyId)
  }
  await sinEmpresa('banners: ajustar una pieza de la empresa', (tx) =>
    tx.bannerInicio.upsert({
      where: { companyId_origenTipo_origenId: { companyId: ctx.companyId, origenTipo: ctx.origen, origenId: id } },
      create: { companyId: ctx.companyId, origenTipo: ctx.origen, origenId: id, ...datos },
      update: datos,
    })
  )
  refrescar()
  return { ok: true }
}

/** Sube o baja una pieza FIJADA entre las fijadas (intercambia su orden con la vecina). */
export async function moverFijada(origen: string, id: string, direccion: 'arriba' | 'abajo'): Promise<ResultadoBanner> {
  const ctx = await contexto(origen)
  if (!ctx) return { ok: false, error: 'No autorizado.' }
  const hecho = await sinEmpresa('banners: reordenar las piezas fijadas de la empresa', async (tx) => {
    const fijadas = await tx.bannerInicio.findMany({
      where: { companyId: ctx.companyId, fijado: true },
      orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, origenTipo: true, origenId: true },
    })
    const i = fijadas.findIndex((f) => f.origenTipo === ctx.origen && f.origenId === id)
    const j = direccion === 'arriba' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= fijadas.length) return false
    // Se reescribe el orden de TODAS las fijadas (0..n): dos filas con el mismo
    // `orden` (pasa al fijar varias seguidas) no dejarían claro quién va antes.
    const nuevo = fijadas.map((f) => f.id)
    ;[nuevo[i], nuevo[j]] = [nuevo[j]!, nuevo[i]!]
    for (let k = 0; k < nuevo.length; k++) await tx.bannerInicio.update({ where: { id: nuevo[k]! }, data: { orden: k } })
    return true
  })
  if (!hecho) return { ok: false, error: 'No se puede mover más.' }
  refrescar()
  return { ok: true }
}

/** Serializable para el cliente: lo que la lista del panel dibuja. */
export interface FilaDeCarruselVista {
  clave: string
  origen: OrigenBanner
  id: string
  /** Dónde se edita el contenido de la pieza. */
  hrefEditar: string
  titulo: string
  imagen: string | null
  precio: string | null
  publicadoEn: string
  vence: string | null
  plantilla: FormatoBanner
  plantillaManual: boolean
  plantillas: { id: FormatoBanner; nombre: string }[]
  fijado: boolean
  oculto: boolean
  enCarrusel: boolean
  motivoFuera: FilaDeCarrusel['motivoFuera']
}
