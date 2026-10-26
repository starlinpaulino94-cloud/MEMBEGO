import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Un bloque de «Hoy · requiere acción» del Resumen (docs/auditoria-admin/fase-3/prototipos/resumen.html).
 *
 * Es una tarjeta con un título, un total y hasta cuatro líneas, cada una un enlace a LA pantalla donde se resuelve (la cola
 * concreta, no «Pagos» a secas: 05 · D-05). De servidor y sin estado. El enlace solo existe si la sección se puede abrir:
 * quien lo arma pasa `href` únicamente cuando puede (D-07), y una línea sin `href` es texto.
 */

export interface FilaAccion {
  etiqueta: ReactNode
  /** La cifra o el dato de la derecha. */
  valor?: ReactNode
  href?: string
  /** Dato secundario (una fecha, «y 4 más»): se escribe más suave. */
  atenuada?: boolean
}

export function TarjetaAccion({
  id,
  titulo,
  total,
  filas,
  ir,
}: {
  /** Une el título con la sección (`aria-labelledby`). */
  id: string
  titulo: string
  total?: number | string
  filas: FilaAccion[]
  ir?: { href: string; texto: string }
}) {
  const claseFila = 'flex items-baseline justify-between gap-3 py-2 text-small'
  return (
    <section
      aria-labelledby={id}
      data-slot="tarjeta-accion"
      className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-h3 text-foreground">
          {titulo}
        </h3>
        {total !== undefined ? (
          <span className="text-h2 tabular-nums text-foreground" aria-label={`Total: ${total}`}>
            {total}
          </span>
        ) : null}
      </div>
      <ul className="mt-2 divide-y divide-border">
        {filas.map((f, i) => (
          <li key={i}>
            {f.href ? (
              <Link href={f.href} className={`${claseFila} rounded-lg text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
                <span className="min-w-0 truncate">{f.etiqueta}</span>
                {f.valor !== undefined ? <span className="shrink-0 font-semibold tabular-nums">{f.valor}</span> : null}
              </Link>
            ) : (
              <div className={`${claseFila} ${f.atenuada ? 'text-muted-foreground' : 'text-foreground'}`}>
                <span className="min-w-0 truncate">{f.etiqueta}</span>
                {f.valor !== undefined ? <span className="shrink-0 font-semibold tabular-nums">{f.valor}</span> : null}
              </div>
            )}
          </li>
        ))}
      </ul>
      {ir ? (
        <Link
          href={ir.href}
          className="mt-3 inline-flex items-center gap-1 self-start text-small font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {ir.texto} <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </section>
  )
}
