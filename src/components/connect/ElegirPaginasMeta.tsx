'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  elegirPaginasAction,
  paginasDisponiblesAction,
  type AltaState,
  type PaginaParaElegir,
} from '@/modules/connect/altaActions'
import { Button } from '@/components/ui/button'
import { StatusBanner } from '@/components/ui/status-banner'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * ELEGIR PÁGINAS (Meta · Fase 3). Lista lo que la persona administra —id,
 * nombre y si puede atender mensajes; nunca tokens— y manda al servidor solo
 * los ids elegidos. El servidor vuelve a pedir las Páginas a Meta con el
 * token guardado: lo que se guarda sale de Meta, no del formulario.
 */

const INIT: AltaState = {}

export function ElegirPaginasMeta({ slug }: { slug: string }) {
  const [paginas, setPaginas] = useState<PaginaParaElegir[] | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [estado, enviar, guardando] = useActionState(elegirPaginasAction, INIT)

  useEffect(() => {
    let vivo = true
    paginasDisponiblesAction(slug).then((r) => {
      if (!vivo) return
      if (!r.ok) {
        setErrorCarga(r.error)
        return
      }
      setPaginas(r.paginas)
      setElegidas(new Set(r.paginas.filter((p) => p.elegida).map((p) => p.id)))
    })
    return () => {
      vivo = false
    }
  }, [slug])

  if (errorCarga) {
    return (
      <StatusBanner variant="destructive" title="No pudimos leer tus Páginas">
        {errorCarga}
      </StatusBanner>
    )
  }
  if (!paginas) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    )
  }
  if (paginas.length === 0) {
    return (
      <StatusBanner variant="warning" title="Meta no devolvió ninguna Página">
        La cuenta con la que te conectaste no administra ninguna Página de Facebook, o no
        marcaste ninguna en la ventana de Meta. Vuelve al paso anterior y elige al menos una.
      </StatusBanner>
    )
  }

  return (
    <form action={enviar} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <fieldset className="space-y-2">
        <legend className="sr-only">Páginas</legend>
        {paginas.map((p) => (
          <label
            key={p.id}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 px-3 py-2.5 transition-colors duration-fast hover:border-primary/40 hover:bg-muted/30"
          >
            <input
              type="checkbox"
              name="paginaId"
              value={p.id}
              checked={elegidas.has(p.id)}
              onChange={(e) =>
                setElegidas((prev) => {
                  const n = new Set(prev)
                  if (e.target.checked) n.add(p.id)
                  else n.delete(p.id)
                  return n
                })
              }
              className="mt-1 h-4 w-4"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{p.nombre}</span>
              <span className="block text-caption text-muted-foreground">
                {p.puedeMensajes
                  ? 'Puedes atender sus mensajes desde Membego.'
                  : 'No tienes permiso para moderar mensajes en esta Página: se conecta, pero no podrás responder.'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {estado.error && (
        <StatusBanner variant="destructive" title="No se pudo guardar">
          {estado.error}
        </StatusBanner>
      )}
      {estado.success && (
        <StatusBanner variant="success" title="Listo">
          {estado.success}
        </StatusBanner>
      )}

      <Button type="submit" disabled={guardando || elegidas.size === 0}>
        {guardando ? 'Conectando…' : 'Conectar las Páginas elegidas'}
      </Button>
    </form>
  )
}
