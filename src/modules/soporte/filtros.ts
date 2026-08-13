import { COLAS_TICKET, type ColaTicket } from '@/lib/soporte'

/**
 * FILTROS DE LA BANDEJA DE SOPORTE. Módulo PURO: se prueba sin base de datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ PASAN A LA URL
 *
 * La cola elegida y la búsqueda vivían en estado de React, y el filtrado se
 * hacía en el navegador sobre las 200 filas que la consulta traía. Tres cosas
 * salían mal de ahí, y las tres en silencio:
 *
 *  · Buscar un cliente que existe devolvía «sin resultados» si su ticket era el
 *    número 201. El buscador parecía roto justo cuando empezaba a hacer falta.
 *  · No se podía compartir «los pendientes de esta empresa» por enlace, ni
 *    volver con el botón «atrás».
 *  · `listTicketsAdmin` YA aceptaba `estado` y `q` y nadie se los pasaba: la
 *    consulta estaba preparada para filtrar y se le daba la lista entera.
 */

/** `todas` = sin acotar a una empresa. Es el valor por defecto en plataforma. */
export const TODAS_LAS_EMPRESAS = 'todas'

export const AMBITOS = ['reales', 'practica', 'todas'] as const
export type AmbitoTickets = (typeof AMBITOS)[number]

export const AMBITO_LABEL: Record<AmbitoTickets, string> = {
  reales: 'Empresas reales',
  practica: 'Solo de práctica',
  todas: 'Reales y de práctica',
}

export const COLAS = Object.keys(COLAS_TICKET) as ColaTicket[]

export const POR_PAGINA = 25

export interface FiltroTickets {
  /** Qué cola se está mirando. Se arranca en el trabajo pendiente. */
  cola: ColaTicket
  q: string
  /** Id de empresa, o `null` = todas. */
  empresa: string | null
  ambito: AmbitoTickets
  pagina: number
}

const enLista = <T extends string>(lista: readonly T[], v: string | undefined, pordefecto: T): T =>
  (lista as readonly string[]).includes(v ?? '') ? (v as T) : pordefecto

export function leerFiltroTickets(sp: Record<string, string | undefined>): FiltroTickets {
  const pagina = Number(sp.pagina)
  return {
    cola: enLista(COLAS, sp.cola, 'pendientes'),
    q: (sp.q ?? '').trim().slice(0, 80),
    // `company` es el nombre que ya usaba el selector de empresa; se conserva
    // para no romper los enlaces que existan por ahí.
    empresa: sp.company && sp.company !== TODAS_LAS_EMPRESAS ? sp.company : null,
    ambito: enLista(AMBITOS, sp.ambito, 'reales'),
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.floor(pagina) : 1,
  }
}

export function hayFiltro(f: FiltroTickets): boolean {
  return Boolean(f.q || f.empresa || f.ambito !== 'reales')
}

/** URL con estos filtros. La cola por defecto y la página 1 no se escriben. */
export function hrefTickets(
  f: FiltroTickets,
  base: string,
  cambios: Partial<FiltroTickets> = {}
): string {
  const v = { ...f, ...cambios }
  const s = new URLSearchParams()
  if (v.cola !== 'pendientes') s.set('cola', v.cola)
  if (v.q) s.set('q', v.q)
  if (v.empresa) s.set('company', v.empresa)
  if (v.ambito !== 'reales') s.set('ambito', v.ambito)
  if (v.pagina > 1) s.set('pagina', String(v.pagina))
  const qs = s.toString()
  return qs ? `${base}?${qs}` : base
}

/**
 * CUÁNTO LLEVA PARADO UN TICKET ANTES DE QUE SEA UN PROBLEMA.
 *
 * Tres días. Un ticket de soporte que lleva tres días sin que el negocio lo
 * toque ya no es «reciente»: es alguien esperando. El umbral solo se aplica a
 * la cola de pendientes —en «esperando al cliente» la pelota no es del
 * negocio— y por eso la marca no aparece en las otras.
 */
export const DIAS_PARADO = 3

/** ¿Este ticket pendiente lleva demasiado sin moverse? */
export function estaParado(cola: ColaTicket, desdeUltimoMovimientoMs: number): boolean {
  return cola === 'pendientes' && desdeUltimoMovimientoMs >= DIAS_PARADO * 24 * 60 * 60 * 1000
}
