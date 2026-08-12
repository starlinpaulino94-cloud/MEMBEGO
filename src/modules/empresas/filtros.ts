/**
 * Filtros del CRM de empresas. Módulo PURO: se prueba sin base de datos.
 *
 * Viven en la URL y no en el estado del componente. Tres razones, y ninguna es
 * estética:
 *
 *  · Un filtro aplicado se puede COMPARTIR y guardar en marcadores. «Las
 *    empresas en silencio» pasa a ser un enlace que se manda por WhatsApp.
 *  · El botón «atrás» del navegador deshace el último filtro, que es lo que
 *    todo el mundo espera y antes recargaba la lista entera desde cero.
 *  · El servidor puede filtrar de verdad. Con el estado en el cliente había que
 *    traerse TODAS las empresas con todos sus campos en cada carga para poder
 *    filtrarlas después; a 200 empresas eso son cientos de kilobytes por visita,
 *    y el buscador deja de servir justo cuando empieza a hacer falta.
 */

export const ESTADOS = ['todas', 'activas', 'suspendidas', 'sin-publicar'] as const
export type EstadoEmpresa = (typeof ESTADOS)[number]

export const ORDENES = ['nombre', 'clientes', 'ingresos', 'actividad', 'reciente'] as const
export type OrdenEmpresa = (typeof ORDENES)[number]

export const ORDEN_LABEL: Record<OrdenEmpresa, string> = {
  nombre: 'Nombre A-Z',
  clientes: 'Más clientes',
  ingresos: 'Más ingresos',
  actividad: 'Más tiempo en silencio',
  reciente: 'Alta más reciente',
}

export const ESTADO_LABEL: Record<EstadoEmpresa, string> = {
  todas: 'Todas',
  activas: 'Activas',
  suspendidas: 'Suspendidas',
  'sin-publicar': 'Sin publicar',
}

/**
 * Qué se hace con las empresas de práctica.
 *
 * `reales` por defecto, y esa es la corrección: antes se colaban en los cuatro
 * totales y en la lista como si fueran negocios de verdad, mientras el Resumen
 * las restaba. La misma plataforma decía 99 clientes en una pantalla y 100 en la
 * de al lado.
 *
 * Pero no se esconden del todo: `practica` las enseña. Una empresa de prueba que
 * no se ve es una que alguien deja encendida y olvida.
 */
export const AMBITOS = ['reales', 'practica', 'todas'] as const
export type AmbitoEmpresa = (typeof AMBITOS)[number]

export const AMBITO_LABEL: Record<AmbitoEmpresa, string> = {
  reales: 'Empresas reales',
  practica: 'Solo de práctica',
  todas: 'Reales y de práctica',
}

export const POR_PAGINA = 24

export interface FiltroEmpresas {
  q: string
  estado: EstadoEmpresa
  ambito: AmbitoEmpresa
  categoria: string | null
  ciudad: string | null
  orden: OrdenEmpresa
  pagina: number
}

const enLista = <T extends string>(lista: readonly T[], v: string | undefined, pordefecto: T): T =>
  (lista as readonly string[]).includes(v ?? '') ? (v as T) : pordefecto

export function leerFiltroEmpresas(sp: Record<string, string | undefined>): FiltroEmpresas {
  const pagina = Number(sp.pagina)
  return {
    q: (sp.q ?? '').trim().slice(0, 80),
    estado: enLista(ESTADOS, sp.estado, 'todas'),
    ambito: enLista(AMBITOS, sp.ambito, 'reales'),
    // Cadena vacía y "todas" significan lo mismo —sin filtro— y las dos llegan:
    // una desde un `<select>` reseteado y otra desde un enlace escrito a mano.
    categoria: sp.categoria && sp.categoria !== 'todas' ? sp.categoria : null,
    ciudad: sp.ciudad && sp.ciudad !== 'todas' ? sp.ciudad : null,
    orden: enLista(ORDENES, sp.orden, 'nombre'),
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.floor(pagina) : 1,
  }
}

/** ¿Hay algo puesto? Decide si se enseña el botón de limpiar. */
export function hayFiltro(f: FiltroEmpresas): boolean {
  return Boolean(
    f.q || f.estado !== 'todas' || f.ambito !== 'reales' || f.categoria || f.ciudad
  )
}

/**
 * Las fichas de lo aplicado, cada una con la URL que la quita.
 *
 * Se calcula aquí y no en la vista para que quitar un filtro NO pierda los
 * demás: construir esos enlaces a mano en el JSX es exactamente donde se cuelan
 * los «al quitar la ciudad se me fue también el estado».
 */
export function fichasDeFiltro(
  f: FiltroEmpresas,
  base: string
): { clave: string; texto: string; quitarHref: string }[] {
  const fichas: { clave: string; texto: string; quitarHref: string }[] = []
  const sin = (cambios: Partial<FiltroEmpresas>) => {
    const s = new URLSearchParams()
    const v = { ...f, ...cambios, pagina: 1 }
    if (v.q) s.set('q', v.q)
    if (v.estado !== 'todas') s.set('estado', v.estado)
    if (v.ambito !== 'reales') s.set('ambito', v.ambito)
    if (v.categoria) s.set('categoria', v.categoria)
    if (v.ciudad) s.set('ciudad', v.ciudad)
    if (v.orden !== 'nombre') s.set('orden', v.orden)
    const qs = s.toString()
    return qs ? `${base}?${qs}` : base
  }

  if (f.q) fichas.push({ clave: 'q', texto: `«${f.q}»`, quitarHref: sin({ q: '' }) })
  if (f.estado !== 'todas')
    fichas.push({
      clave: 'estado',
      texto: ESTADO_LABEL[f.estado],
      quitarHref: sin({ estado: 'todas' }),
    })
  if (f.ambito !== 'reales')
    fichas.push({
      clave: 'ambito',
      texto: AMBITO_LABEL[f.ambito],
      quitarHref: sin({ ambito: 'reales' }),
    })
  if (f.categoria)
    fichas.push({ clave: 'categoria', texto: f.categoria, quitarHref: sin({ categoria: null }) })
  if (f.ciudad)
    fichas.push({ clave: 'ciudad', texto: f.ciudad, quitarHref: sin({ ciudad: null }) })
  return fichas
}

/** Enlace a otra página conservando todo lo demás. */
export function hrefPagina(f: FiltroEmpresas, base: string, pagina: number): string {
  const s = new URLSearchParams()
  if (f.q) s.set('q', f.q)
  if (f.estado !== 'todas') s.set('estado', f.estado)
  if (f.ambito !== 'reales') s.set('ambito', f.ambito)
  if (f.categoria) s.set('categoria', f.categoria)
  if (f.ciudad) s.set('ciudad', f.ciudad)
  if (f.orden !== 'nombre') s.set('orden', f.orden)
  if (pagina > 1) s.set('pagina', String(pagina))
  const qs = s.toString()
  return qs ? `${base}?${qs}` : base
}
