import Link from 'next/link'
import Image from 'next/image'
import { Star } from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

/** Cinco estrellas rellenas según la valoración (violeta, como el diseño). */
function Estrellas({ valoracion }: { valoracion: number }) {
  const llenas = Math.round(valoracion)
  return (
    <span className="flex" role="img" aria-label={`${valoracion.toFixed(1)} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={`size-3.5 ${n <= llenas ? 'fill-vibe-violet text-vibe-violet' : 'text-vibe-chip'}`}
        />
      ))}
    </span>
  )
}

/**
 * «Relacionado con los artículos que viste» — la rejilla 2×N del rediseño
 * violeta. Los «artículos» son las membresías recomendadas del marketplace
 * (mismo dato del bloque MEMBRESIAS de siempre): imagen, «Empresa ·
 * Plan», estrellas de la empresa con conteo, precio con su periodo y el
 * botón «Aprovechar». Tarjeta entera enlace; sin tachados ni sellos que el
 * dato no respalde.
 */
export function VibeRelacionado({
  planes,
  total,
}: {
  planes: InicioVista['planes']
  total: number
}) {
  if (planes.length === 0) {
    return (
      <RetailEmptyState
        title="Relacionado contigo"
        description="Cuando haya membresías publicadas, aparecerán aquí."
      />
    )
  }

  return (
    <section className="mt-6 px-4" aria-labelledby="vibe-relacionado">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="vibe-relacionado" className="min-w-0 text-h2 text-foreground">
          Relacionado con los artículos que viste
        </h3>
        <Link
          href="/cliente/planes?todos=1"
          className="shrink-0 text-label-sm font-bold text-vibe-violet hover:underline"
        >
          Ver más{total > 0 ? ` (${total})` : ''}
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {planes.slice(0, 4).map((p) => (
          <li key={p.id} className="flex">
            <Link
              href={p.href}
              className="flex w-full flex-col justify-between rounded-xl border border-vibe-borde bg-card p-3 elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.99]"
            >
              <span className="space-y-2">
                <span className="relative block h-32 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                  {p.imagen ? (
                    <Image src={p.imagen} alt="" fill sizes="(min-width: 640px) 20rem, 45vw" className="object-cover" />
                  ) : (
                    <span aria-hidden className="flex size-full items-center justify-center text-h1 text-vibe-violet">
                      {p.empresa.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 block text-label-md font-bold leading-tight text-foreground">
                  {p.empresa} · {p.nombre}
                </span>
                {p.valoracion != null && Number.isFinite(Number(p.valoracion)) ? (
                  <span className="flex items-center gap-1">
                    <Estrellas valoracion={Number(p.valoracion)} />
                    <span className="text-label-sm font-medium text-muted-foreground tabular-nums">
                      {p.resenas.toLocaleString('es-DO')}
                    </span>
                  </span>
                ) : null}
                <span className="block pt-1">
                  <span className="text-h3 tabular-nums text-foreground">{p.precio}</span>{' '}
                  <span className="text-small text-muted-foreground">{p.periodo}</span>
                </span>
              </span>
              <span className="grad-vibe mt-3 block w-full rounded-full py-2 text-center text-label-sm font-bold text-white">
                Aprovechar
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
