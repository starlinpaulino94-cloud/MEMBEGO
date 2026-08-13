import {
  CAMPANA_ESTADOS,
  CAMPANA_ESTADO_LABELS,
  POR_PAGINA,
  type FiltroCampanas,
} from './campanasGlobales'

// Se reexportan para que la pantalla siga pidiéndoselos al módulo de filtros,
// que es donde se buscan. La definición vive en el dominio: ver el comentario
// de `POR_PAGINA` allí.
export { POR_PAGINA }
export type { FiltroCampanas }

/**
 * FILTROS DE CAMPAÑAS CONJUNTAS. Módulo PURO: se prueba sin base de datos.
 *
 * La lista traía las últimas 100 y punto. Con eso no se podía hacer la pregunta
 * operativa del módulo —«¿cuáles quedaron a medias?»— más que leyendo fila por
 * fila buscando la insignia roja de errores.
 */

/** `todos` = sin filtro. `con-errores` no es un estado: es una pregunta. */
export const FILTROS_ESTADO = ['todos', 'con-errores', ...CAMPANA_ESTADOS] as const
export type FiltroEstadoCampana = (typeof FILTROS_ESTADO)[number]

export const FILTRO_ESTADO_LABEL: Record<FiltroEstadoCampana, string> = Object.fromEntries(
  FILTROS_ESTADO.map((e) => [
    e,
    e === 'todos'
      ? 'Todos los estados'
      : e === 'con-errores'
        ? 'Con errores'
        : CAMPANA_ESTADO_LABELS[e],
  ])
) as Record<FiltroEstadoCampana, string>

const enLista = <T extends string>(lista: readonly T[], v: string | undefined, pordefecto: T): T =>
  (lista as readonly string[]).includes(v ?? '') ? (v as T) : pordefecto

export function leerFiltroCampanas(sp: Record<string, string | undefined>): FiltroCampanas {
  const pagina = Number(sp.pagina)
  return {
    q: (sp.q ?? '').trim().slice(0, 80),
    estado: enLista(FILTROS_ESTADO, sp.estado, 'todos'),
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.floor(pagina) : 1,
  }
}

export function hayFiltro(f: FiltroCampanas): boolean {
  return Boolean(f.q || f.estado !== 'todos')
}

/** URL con estos filtros. La página 1 no se escribe: la URL limpia es canónica. */
export function hrefCampanas(
  f: FiltroCampanas,
  base: string,
  cambios: Partial<FiltroCampanas> = {}
): string {
  const v = { ...f, ...cambios }
  const s = new URLSearchParams()
  if (v.q) s.set('q', v.q)
  if (v.estado !== 'todos') s.set('estado', v.estado)
  if (v.pagina > 1) s.set('pagina', String(v.pagina))
  const qs = s.toString()
  return qs ? `${base}?${qs}` : base
}
