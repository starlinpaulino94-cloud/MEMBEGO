'use client'

import { useEffect, useRef, useActionState } from 'react'
import { ArrowRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SinonimoFila } from '@/modules/busqueda/sinonimos'
import type { SinonimoState } from '@/modules/busqueda/actions'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: SinonimoState = {}

/**
 * Panel de sinónimos de búsqueda — compartido por los dos ámbitos.
 *
 * La plataforma (/superadmin/busqueda) y la empresa (/admin/sinonimos) hacen
 * exactamente lo mismo con datos distintos: escribir «cuando busquen ESTO,
 * encuentra también AQUELLO» y borrar lo que ya no aplica. Las acciones
 * llegan por props porque el ámbito (y su guardia de rol) lo decide la
 * página, no este componente.
 *
 * El modelo admite UNA equivalencia por término y ámbito: guardar sobre un
 * término existente la reemplaza — se dice en la ayuda, no se descubre.
 */
export function SinonimosPanel({
  filas,
  guardar,
  eliminar,
}: {
  filas: SinonimoFila[]
  guardar: (prev: SinonimoState, fd: FormData) => Promise<SinonimoState>
  eliminar: (fd: FormData) => Promise<void>
}) {
  const [state, formAction, pending] = useActionState(guardar, init)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success) {
      toast.success('Sinónimo guardado.')
      formRef.current?.reset()
    }
  }, [state])

  return (
    <div className="max-w-2xl space-y-5">
      {/* ── Alta ───────────────────────────────────────────────────────── */}
      <form
        ref={formRef}
        action={formAction}
        className="rounded-lg border border-border bg-card p-4 elevation-1"
      >
        {state.error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="sin-termino" className="mb-1 block text-overline">
              Cuando busquen
            </label>
            <input
              id="sin-termino"
              name="termino"
              required
              maxLength={80}
              placeholder="p. ej. lavado"
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-small outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:mb-3.5 sm:block sm:self-end" aria-hidden />
          <div className="min-w-0 flex-1">
            <label htmlFor="sin-equivalencia" className="mb-1 block text-overline">
              Encuentra también
            </label>
            <input
              id="sin-equivalencia"
              name="equivalencia"
              required
              maxLength={80}
              placeholder="p. ej. car wash"
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-small outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-label-lg text-primary-foreground transition-colors duration-fast hover:bg-brand-primary-hover disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Añadir
          </button>
        </div>
        <p className="mt-3 text-caption">
          Se guarda en minúsculas y sin espacios de más. Si el término ya
          existe, la nueva equivalencia reemplaza a la anterior.
        </p>
      </form>

      {/* ── Vigentes ───────────────────────────────────────────────────── */}
      {filas.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-small text-muted-foreground">
          Todavía no hay sinónimos en este ámbito.
        </p>
      ) : (
        <ul className="space-y-2">
          {filas.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 elevation-1"
            >
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-words rounded-full bg-retail-mist px-3 py-1 text-label-md font-semibold text-retail-deep">
                  {f.termino}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="break-words rounded-full border border-border px-3 py-1 text-label-md text-foreground">
                  {f.equivalencia}
                </span>
              </span>
              <form action={eliminar}>
                <input type="hidden" name="id" value={f.id} />
                <button
                  type="submit"
                  aria-label={`Eliminar el sinónimo ${f.termino} → ${f.equivalencia}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-fast hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
