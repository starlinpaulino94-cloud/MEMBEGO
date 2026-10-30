'use client'

import { duracionLegible, urlCartel, urlVideo, type Tutorial } from '@/modules/tutoriales/catalogo'

/**
 * El video de un tutorial con su título y, debajo, lo que dice la voz (para quien no puede escuchar). Reproduce
 * solo al cargar porque se abre a petición de la persona, nunca solo.
 */
export function ReproductorTutorial({ tutorial, compacto = false }: { tutorial: Tutorial; compacto?: boolean }) {
  return (
    <div className="space-y-3">
      <video
        key={tutorial.id}
        className="aspect-video w-full rounded-xl bg-black"
        src={urlVideo(tutorial.id)}
        poster={urlCartel(tutorial.id)}
        controls
        autoPlay
        playsInline
        preload="metadata"
      />
      {!compacto && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {tutorial.modulo} · {duracionLegible(tutorial.duracionS)}
          </p>
          <p className="text-sm leading-relaxed text-foreground/90">{tutorial.texto}</p>
        </div>
      )}
    </div>
  )
}
