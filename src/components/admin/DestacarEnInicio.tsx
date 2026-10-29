'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { PieBanner, TarjetaBanner, llevaPie } from '@/components/cliente/inicio/TarjetaBanner'
import { destacarPieza, vistaDeDestacar, type VistaDeDestacar } from '@/modules/home/banners-acciones'
import type { FormatoBanner } from '@/modules/home/banner-formatos'

/**
 * «¿LO DESTACAMOS EN EL INICIO?» — la pregunta justo después de publicar algo.
 *
 * La pieza YA entró sola a las novedades del inicio; esto solo ofrece fijarla
 * arriba. Enseña la tarjeta tal como la verá el cliente (la misma
 * `TarjetaBanner`) con la plantilla que se eligió sola y las alternativas que
 * caben. «Ahora no» no hace nada: no bloquea ni cambia lo publicado.
 *
 * Si la pieza todavía no es pública (un producto sin «disponible en el
 * marketplace», por ejemplo), no hay nada que enseñar y el aviso se cierra solo
 * sin molestar.
 */
export function DestacarEnInicio({
  origen,
  id,
  abierto,
  alCerrar,
}: {
  origen: 'PROMOCION' | 'CATALOGO' | 'OFERTA' | 'PLAN'
  id: string
  abierto: boolean
  alCerrar: () => void
}) {
  const [vista, setVista] = useState<VistaDeDestacar | null>(null)
  const [plantilla, setPlantilla] = useState<FormatoBanner | null>(null)
  const [pendiente, empezar] = useTransition()
  // Por ref: un `alCerrar` escrito en línea cambia en cada render y, como
  // dependencia, relanzaría la consulta una y otra vez.
  const cerrarRef = useRef(alCerrar)
  useEffect(() => {
    cerrarRef.current = alCerrar
  })

  useEffect(() => {
    if (!abierto) return
    let vivo = true
    vistaDeDestacar(origen, id)
      .then((r) => {
        if (!vivo) return
        if (!r.ok) {
          cerrarRef.current()
          return
        }
        setVista(r)
        setPlantilla(r.plantilla)
      })
      .catch(() => {
        if (vivo) cerrarRef.current()
      })
    return () => {
      vivo = false
    }
  }, [abierto, origen, id])

  if (!abierto || !vista || !plantilla) return null
  const hero = { ...vista.hero, formato: plantilla }

  function destacar() {
    empezar(async () => {
      const r = await destacarPieza(origen, id, plantilla)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Destacada: va primera en el inicio de tus clientes.')
      alCerrar()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>¿La destacamos en el inicio?</DialogTitle>
          <DialogDescription>
            Ya entró a las novedades del inicio. Si la destacas, va primera en el carrusel hasta que venza o la quites.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
          <div>
            <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">Así se verá en el inicio</p>
            <TarjetaBanner hero={hero} className="aspect-[4/5] w-full" sinOptimizar compacta />
            {llevaPie(hero) ? <PieBanner hero={hero} compacta /> : null}
          </div>

          <div className="flex flex-col gap-4">
            <fieldset>
              <legend className="mb-2 text-label-md font-bold text-foreground">Plantilla</legend>
              <div className="grid grid-cols-2 gap-2">
                {vista.plantillas.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    variant="outline"
                    aria-pressed={plantilla === p.id}
                    onClick={() => setPlantilla(p.id)}
                    className={cn('h-auto justify-start whitespace-normal p-2.5 text-left text-small', plantilla === p.id && 'border-primary ring-2 ring-primary/15')}
                  >
                    <span className="flex flex-col items-start">
                      <span className="font-bold text-foreground">{p.nombre}</span>
                      {p.id === vista.plantilla ? <span className="text-label-sm font-normal text-muted-foreground">Recomendada</span> : null}
                    </span>
                  </Button>
                ))}
              </div>
            </fieldset>
            {vista.yaFijada ? <p className="text-small text-muted-foreground">Ya estaba fijada: se guarda la plantilla que elijas.</p> : null}
            <p className="mt-auto text-caption text-muted-foreground">Lo cambias cuando quieras en Editor de inicio → Carrusel.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={destacar} disabled={pendiente}>
                {pendiente ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <Star className="mr-2 size-4" aria-hidden />}
                Destacar ahora
              </Button>
              <Button type="button" variant="outline" onClick={alCerrar} disabled={pendiente}>
                Ahora no
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
