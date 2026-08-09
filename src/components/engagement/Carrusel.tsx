import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'

/**
 * Engagement Engine · Fase 3 — fila horizontal tipo Netflix.
 *
 * Presentacional: cabecera (icono + título + "Ver todo") y un carril con
 * scroll-snap horizontal (swipe en móvil, rueda/trackpad en escritorio; barra
 * oculta). El llamador provee los ítems ya envueltos en un ancho fijo.
 */
export function Carrusel({
  icon: Icon,
  iconClass = 'text-primary',
  titulo,
  subtitulo,
  verTodoHref,
  children,
}: {
  icon: LucideIcon
  iconClass?: string
  titulo: string
  subtitulo?: string
  verTodoHref?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Icon className={`h-4.5 w-4.5 ${iconClass}`} />
          </span>
          <div className="min-w-0">
            <h2 className="text-h3 text-foreground">{titulo}</h2>
            {subtitulo && <p className="truncate text-caption">{subtitulo}</p>}
          </div>
        </div>
        {verTodoHref && (
          <Link
            href={verTodoHref}
            className="flex min-h-11 shrink-0 items-center gap-0.5 text-small font-semibold text-primary hover:underline"
          >
            Ver todo
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>

      {/* Carril: scroll-snap + padding lateral para que el último ítem respire. */}
      <div className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-1 px-1 pb-2">
        {children}
      </div>
    </section>
  )
}

/** Envoltura de cada ítem del carrusel: ancho fijo y snap al inicio. */
export function CarruselItem({ children }: { children: React.ReactNode }) {
  return <div className="w-[15.5rem] shrink-0 snap-start sm:w-[16.5rem]">{children}</div>
}
