import type { ReactNode } from 'react'

/** El marco de un paso del formulario de reserva: número, título y, si hace falta, algo a la derecha del título. */
export function Paso({ numero, id, titulo, aside, children }: { numero: number; id: string; titulo: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="w-full min-w-0 max-w-full space-y-4 overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6"
    >
      <div className="flex w-full min-w-0 flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Paso {numero}</span>
          <h2 id={id} className="truncate text-base font-bold text-foreground sm:text-lg">
            {titulo}
          </h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}
