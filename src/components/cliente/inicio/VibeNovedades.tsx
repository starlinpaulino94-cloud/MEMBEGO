import Link from 'next/link'
import Image from 'next/image'
import type { InicioVista } from '@/modules/home/vista'

/**
 * NOVEDADES Y PROMOCIONES — lo que está vigente ahora en toda la vitrina.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO ES UN DISEÑO NUEVO
 *
 * Reusa las piezas que el Inicio ya tiene: carrusel horizontal con `snap` como
 * el héroe, tarjeta `rounded-xl` con borde `vibe-borde` y `elevation-1` como
 * «Relacionado», arte sobre `vibe-niebla` con la inicial de respaldo, y el dato
 * protagonista en violeta. Una sección que introduce una forma nueva obliga al
 * ojo a aprenderla; ésta se lee igual que las de al lado desde el primer
 * segundo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PROMOCIONES Y MEMBRESÍAS EN LA MISMA FILA, Y SE DISTINGUEN
 *
 * Las dos cosas son «lo que puedes conseguir hoy», y separarlas en dos
 * carruseles obligaría a recorrer la pantalla dos veces para la misma
 * pregunta. Lo que no se mezcla es la etiqueta: cada tarjeta dice si es una
 * promoción o una membresía, porque una se canjea y la otra se paga cada mes.
 *
 * El sello «Nuevo» solo va en lo publicado en los últimos catorce días. Si lo
 * llevara todo, dejaría de significar nada.
 */
export function VibeNovedades({ novedades }: { novedades: InicioVista['novedades'] }) {
  // Sin nada vigente no se pinta una sección vacía: en una portada, un hueco
  // con título y sin contenido se lee como un fallo de carga.
  if (novedades.length === 0) return null

  return (
    <section className="mt-6" aria-labelledby="vibe-novedades">
      <div className="mb-3 flex items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <h3 id="vibe-novedades" className="text-h2 text-foreground">
            Novedades y promociones
          </h3>
          <p className="mt-0.5 text-small text-muted-foreground">
            Lo que está activo ahora en los negocios de MembeGo
          </p>
        </div>
        <Link
          href="/cliente/promociones"
          className="shrink-0 text-label-sm font-bold text-vibe-violet hover:underline"
        >
          Ver todas
        </Link>
      </div>

      <ul className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
        {novedades.map((n) => (
          <li key={`${n.tipo}-${n.id}`} className="flex w-44 shrink-0 snap-start">
            <Link
              href={n.href}
              className="flex w-full flex-col rounded-xl border border-vibe-borde bg-card p-3 elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.99]"
            >
              <span className="relative mb-2 block h-24 w-full overflow-hidden rounded-lg bg-vibe-niebla">
                {n.imagen ? (
                  <Image
                    src={n.imagen}
                    alt=""
                    fill
                    sizes="11rem"
                    className="object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex size-full items-center justify-center text-h1 text-vibe-violet"
                  >
                    {n.titulo.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {n.nuevo ? (
                  <span className="grad-vibe absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-label-sm font-bold text-white">
                    Nuevo
                  </span>
                ) : null}
              </span>

              <span className="block truncate text-label-md text-muted-foreground">
                {n.empresa}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-h4 leading-tight text-foreground">
                {n.titulo}
              </span>

              <span className="mt-auto block pt-2">
                {n.dato ? (
                  <span className="text-h3 tabular-nums text-vibe-violet">{n.dato}</span>
                ) : null}
                {n.detalle ? (
                  <span className="block text-label-md text-muted-foreground">{n.detalle}</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
