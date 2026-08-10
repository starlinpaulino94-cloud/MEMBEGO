import { OG_ASPECTO } from '@/lib/share/og-tamano'

/**
 * Share Engine · "Vista previa al compartir": muestra en el panel cómo se verá
 * el enlace en WhatsApp/Facebook/Telegram ANTES de compartirlo. La imagen es
 * la MISMA tarjeta real que generará el sistema (endpoint opengraph-image),
 * así que lo que se ve aquí es exactamente lo que verá quien reciba el enlace.
 */

export function SharePreviewCard({
  imageSrc,
  titulo,
  descripcion,
  urlMostrada,
}: {
  /** URL de la tarjeta social real (ej: /promocion/<id>/opengraph-image). */
  imageSrc: string
  titulo: string
  descripcion: string
  /** Dominio/ruta que muestra el mensajero bajo la tarjeta. */
  urlMostrada: string
}) {
  return (
    <div className="space-y-2">
      {/* Burbuja estilo chat */}
      <div className="max-w-sm rounded-2xl rounded-tr-sm bg-[#075E54]/10 p-2 dark:bg-[#075E54]/25">
        <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={`Vista previa al compartir: ${titulo}`}
            className="w-full bg-muted object-cover"
            /* La proporción sale de `OG_SIZE`, y va en `style` y no en una clase
               de Tailwind: Tailwind genera sus clases leyendo el código, y una
               construida con una plantilla no existe cuando eso ocurre.
               Escrita a mano, además, esta vista previa acabaría enseñando un
               recorte distinto del que ve quien recibe el enlace — justo lo que
               esta tarjeta existe para evitar. */
            style={{ aspectRatio: OG_ASPECTO }}
            loading="lazy"
          />
          <div className="space-y-0.5 p-3">
            <p className="line-clamp-1 text-sm font-semibold text-foreground">{titulo}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{descripcion}</p>
            <p className="pt-0.5 text-[11px] text-muted-foreground/70">{urlMostrada}</p>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Así se verá el enlace en WhatsApp, Facebook, Telegram y demás apps al
        compartirlo. La tarjeta se genera sola con los datos de arriba: si cambias
        el título, la imagen o el beneficio, se actualiza automáticamente.
      </p>
    </div>
  )
}
