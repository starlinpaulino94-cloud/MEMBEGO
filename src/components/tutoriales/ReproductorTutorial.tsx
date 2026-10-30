'use client'

import { useState } from 'react'
import { VideoOff } from 'lucide-react'
import { duracionLegible, urlCartel, urlVideo, type Tutorial } from '@/modules/tutoriales/catalogo'

/**
 * El video de un tutorial con su título y, debajo, lo que dice la voz (para quien no puede escuchar). Reproduce
 * solo al cargar porque se abre a petición de la persona, nunca solo.
 *
 * Si el archivo no está en Storage (el bucket no existe en ese entorno o el clip no se subió), se dice con
 * claridad en lugar de dejar un reproductor negro que no hace nada; el texto de la voz sigue ahí.
 */
export function ReproductorTutorial({ tutorial, compacto = false }: { tutorial: Tutorial; compacto?: boolean }) {
  const [fallo, setFallo] = useState(false)
  return (
    <div className="space-y-3">
      {fallo ? (
        <div role="alert" className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted px-6 text-center">
          <VideoOff className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Este video no está disponible en este momento.</p>
          <p className="text-xs text-muted-foreground">Lo que dice la voz está justo debajo.</p>
        </div>
      ) : (
        <video
          key={tutorial.id}
          className="aspect-video w-full rounded-xl bg-black"
          src={urlVideo(tutorial.id)}
          poster={urlCartel(tutorial.id)}
          controls
          autoPlay
          playsInline
          preload="metadata"
          onError={() => setFallo(true)}
        />
      )}
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
