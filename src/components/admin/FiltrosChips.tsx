import Link from 'next/link'
import { X } from 'lucide-react'
import { urlConFiltros } from '@/modules/admin/filtrosComunes'

/**
 * Fila de filtros como ENLACES, no como controles de formulario.
 *
 * Se pintan con `<Link>` a propósito: cada combinación de filtros es una URL
 * propia, así que una lista filtrada se puede compartir por WhatsApp, guardar
 * en marcadores y enlazar desde el Resumen. Un filtro que solo vive en el
 * estado del navegador no se puede señalar con el dedo — y señalar con el dedo
 * («mira, estos 17») es justo para lo que se pidieron estos filtros.
 *
 * Pulsar un filtro ya activo lo QUITA. Sin eso, la única forma de deshacer es
 * recargar la pantalla, que es donde la gente se rinde y se lleva el CSV.
 */

export interface GrupoFiltro {
  /** Parámetro de la URL que controla este grupo. */
  clave: string
  /** Título corto encima de las opciones. */
  titulo: string
  opciones: { valor: string; label: string }[]
  /** Valor activo ahora mismo (ya validado). */
  activo?: string
}

export function FiltrosChips({
  base,
  params,
  grupos,
  hayFiltros,
}: {
  base: string
  params: Record<string, string | string[] | undefined>
  grupos: GrupoFiltro[]
  /** Si hay algo que limpiar, se ofrece el atajo. */
  hayFiltros: boolean
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
      {grupos.map((g) => (
        <div key={g.clave} className="flex flex-wrap items-center gap-2">
          <span className="w-full text-overline sm:w-28 sm:shrink-0">{g.titulo}</span>
          {g.opciones.map((o) => {
            const activo = g.activo === o.valor
            return (
              <Link
                key={o.valor}
                // Pulsar el activo lo quita: `undefined` borra el parámetro.
                href={urlConFiltros(base, params, { [g.clave]: activo ? undefined : o.valor })}
                aria-pressed={activo}
                className={
                  activo
                    ? 'inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground'
                    : 'rounded-full border border-border bg-background px-3 py-1 text-sm text-muted-foreground hover:bg-muted'
                }
              >
                {o.label}
                {activo && <X className="h-3 w-3" aria-hidden />}
              </Link>
            )
          })}
        </div>
      ))}

      {hayFiltros && (
        <div className="pt-1">
          <Link
            href={urlConFiltros(
              base,
              params,
              Object.fromEntries(grupos.map((g) => [g.clave, undefined]))
            )}
            className="text-caption text-primary hover:underline"
          >
            Limpiar filtros
          </Link>
        </div>
      )}
    </div>
  )
}
