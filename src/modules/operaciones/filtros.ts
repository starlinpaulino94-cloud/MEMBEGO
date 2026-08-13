/**
 * FILTROS DE «OPERACIONES POR EMPRESA». Módulo PURO: se prueba sin base.
 *
 * La pantalla existe para responder una pregunta —«¿quién no ha configurado
 * esto?»— y no se podía hacer. Había que leer las cuarenta tarjetas buscando a
 * ojo las que dijeran «Sin configurar».
 *
 * De ahí que el filtro principal no sea por atributo sino por AUSENCIA: lo que
 * se busca aquí siempre es lo que falta.
 */

/** Qué le falta a la empresa. `nada` = sin filtro. */
export const FALTAS = ['nada', 'whatsapp', 'promociones', 'reglas'] as const
export type Falta = (typeof FALTAS)[number]

export const FALTA_LABEL: Record<Falta, string> = {
  nada: 'Todas las empresas',
  whatsapp: 'Sin WhatsApp configurado',
  promociones: 'Sin promociones vigentes',
  reglas: 'Sin reglas de referido activas',
}

/** Igual que en el resto del panel: las de práctica ni se cuelan ni se ocultan. */
export const AMBITOS = ['reales', 'practica', 'todas'] as const
export type AmbitoOperaciones = (typeof AMBITOS)[number]

export const AMBITO_LABEL: Record<AmbitoOperaciones, string> = {
  reales: 'Empresas reales',
  practica: 'Solo de práctica',
  todas: 'Reales y de práctica',
}

export const POR_PAGINA = 24

export interface FiltroOperaciones {
  q: string
  falta: Falta
  ambito: AmbitoOperaciones
  pagina: number
}

const enLista = <T extends string>(lista: readonly T[], v: string | undefined, pordefecto: T): T =>
  (lista as readonly string[]).includes(v ?? '') ? (v as T) : pordefecto

export function leerFiltroOperaciones(sp: Record<string, string | undefined>): FiltroOperaciones {
  const pagina = Number(sp.pagina)
  return {
    q: (sp.q ?? '').trim().slice(0, 80),
    falta: enLista(FALTAS, sp.falta, 'nada'),
    ambito: enLista(AMBITOS, sp.ambito, 'reales'),
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.floor(pagina) : 1,
  }
}

export function hayFiltro(f: FiltroOperaciones): boolean {
  return Boolean(f.q || f.falta !== 'nada' || f.ambito !== 'reales')
}

/** URL con estos filtros. `pagina` 1 no se escribe: la URL limpia es la canónica. */
export function hrefFiltro(
  f: Partial<FiltroOperaciones>,
  base: string,
  cambios: Partial<FiltroOperaciones> = {}
): string {
  const v = { ...f, ...cambios }
  const s = new URLSearchParams()
  if (v.q) s.set('q', v.q)
  if (v.falta && v.falta !== 'nada') s.set('falta', v.falta)
  if (v.ambito && v.ambito !== 'reales') s.set('ambito', v.ambito)
  if (v.pagina && v.pagina > 1) s.set('pagina', String(v.pagina))
  const qs = s.toString()
  return qs ? `${base}?${qs}` : base
}

/**
 * Las fichas de lo aplicado, cada una con la URL que la quita.
 *
 * Se calculan aquí y no en el JSX: construir esos enlaces a mano es justo donde
 * se cuela el «al quitar el ámbito se me fue también la búsqueda».
 */
export function fichasDeFiltro(
  f: FiltroOperaciones,
  base: string
): { clave: string; texto: string; quitarHref: string }[] {
  const fichas: { clave: string; texto: string; quitarHref: string }[] = []
  // Quitar un filtro vuelve a la página 1: quedarse en la 3 de una lista que
  // ahora tiene una sola es la forma más rápida de ver «sin resultados».
  const sin = (cambios: Partial<FiltroOperaciones>) =>
    hrefFiltro(f, base, { ...cambios, pagina: 1 })

  if (f.q) fichas.push({ clave: 'q', texto: `«${f.q}»`, quitarHref: sin({ q: '' }) })
  if (f.falta !== 'nada')
    fichas.push({ clave: 'falta', texto: FALTA_LABEL[f.falta], quitarHref: sin({ falta: 'nada' }) })
  if (f.ambito !== 'reales')
    fichas.push({
      clave: 'ambito',
      texto: AMBITO_LABEL[f.ambito],
      quitarHref: sin({ ambito: 'reales' }),
    })
  return fichas
}
