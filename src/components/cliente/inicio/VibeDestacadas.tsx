import Link from 'next/link'
import Image from 'next/image'
import { Star } from 'lucide-react'
import { plural } from '@/lib/plural'
import type { InicioVista } from '@/modules/home/vista'

/**
 * EMPRESAS DESTACADAS — las que el negocio decidió promocionar (`isFeatured`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO NO SE DISEÑÓ: SE VOLVIÓ A ENCENDER
 *
 * El bloque, su consulta y sus datos —foto, valoración, reseñas, planes,
 * «desde»— llevaban construidos desde antes del rediseño violeta. Lo que pasó
 * el 10-09-2026 es que el mapa de bloques lo apagó con un `return null`, y con
 * él se apagó también la consulta, que solo se lanza si el bloque está activo.
 * No faltaba dato ni pantalla: faltaba el cable.
 *
 * La tarjeta es la misma receta que el resto del Inicio —carrusel con `snap`,
 * `rounded-xl`, borde `vibe-borde`, `elevation-1`, arte sobre `vibe-niebla`,
 * estrellas violeta— para que entre sin que se note la costura.
 *
 * Sin valoración no se pinta una estrella vacía ni un «(0)»: decir «este
 * negocio tiene cero» cuando lo que pasa es que nadie ha opinado todavía es
 * peor que no decir nada.
 */
export function VibeDestacadas({
  empresas,
  total,
}: {
  empresas: InicioVista['empresas']
  total: number
}) {
  if (empresas.length === 0) return null

  return (
    <section className="mt-6" aria-labelledby="vibe-destacadas">
      <div className="mb-3 flex items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <h3 id="vibe-destacadas" className="text-h2 text-foreground">
            Empresas destacadas
          </h3>
          <p className="mt-0.5 text-small text-muted-foreground">
            Negocios verificados con membresía MembeGo
          </p>
        </div>
        <Link
          href="/cliente/explorar"
          className="shrink-0 text-label-sm font-bold text-vibe-violet hover:underline"
        >
          Ver todas{total > 0 ? ` (${total})` : ''}
        </Link>
      </div>

      <ul className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {empresas.map((e) => (
          <li key={e.id} className="flex w-52 shrink-0 snap-start">
            <Link
              href={e.href}
              className="flex w-full flex-col rounded-xl border border-vibe-borde bg-card p-3 elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.99]"
            >
              <span className="relative mb-2 block h-28 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                {e.imagen ? (
                  <Image src={e.imagen} alt="" fill sizes="13rem" className="object-cover" />
                ) : (
                  <span
                    aria-hidden
                    className="flex size-full items-center justify-center text-h1 text-vibe-violet"
                  >
                    {e.nombre.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>

              <span className="line-clamp-2 block text-h4 leading-tight text-foreground">
                {e.nombre}
              </span>
              {e.rubro ? (
                <span className="mt-0.5 block truncate text-small text-muted-foreground">
                  {e.rubro}
                </span>
              ) : null}

              {e.valoracion != null && Number.isFinite(Number(e.valoracion)) ? (
                <span className="mt-1.5 flex items-center gap-1">
                  <Star className="size-3.5 fill-vibe-violet text-vibe-violet" aria-hidden />
                  <span className="text-label-md font-bold tabular-nums text-foreground">
                    {Number(e.valoracion).toFixed(1)}
                  </span>
                  {e.resenas > 0 ? (
                    <span className="text-label-md text-muted-foreground tabular-nums">
                      ({e.resenas.toLocaleString('es-DO')})
                    </span>
                  ) : null}
                </span>
              ) : null}

              <span className="mt-auto block pt-2 text-label-md text-muted-foreground">
                {e.planes > 0 ? plural(e.planes, 'membresía', 'membresías') : 'Ver el negocio'}
                {e.ciudad ? ` · ${e.ciudad}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
