import Link from 'next/link'
import Image from 'next/image'
import { Compass } from 'lucide-react'
import { plural } from '@/lib/plural'
import type { InicioVista } from '@/modules/home/vista'
import { RetailSeccionPie } from './RetailSeccion'

/**
 * DESCUBRE MÁS EMPRESAS — los negocios que el cliente todavía no conoce.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO ES UN DISEÑO NUEVO: ES LA RECETA DE «OFERTAS RELÁMPAGO»
 *
 * Panel `vibe-lavanda` redondeado con filas blancas dentro, cabecera con icono
 * violeta a la izquierda y píldora de dato a la derecha. Es exactamente el
 * patrón que el Inicio ya usa para AGRUPAR cosas que van juntas, así que la
 * pantalla no aprende una forma más.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES LO MISMO QUE «EMPRESAS DESTACADAS»
 *
 * Destacadas lee `isFeatured`: son las que el negocio decidió promocionar.
 * Ésta lee TODAS las publicadas. Hoy, con pocas empresas, la lista es el
 * catálogo entero —que es justo lo que se pidió—; cuando crezca, el tope de la
 * consulta hace el recorte y el pie sigue llevando a Explorar sin cambiar nada
 * aquí. Si las dos leyeran `isFeatured`, la portada enseñaría la misma lista
 * dos veces y la segunda sobraría.
 */
export function VibeDescubre({
  empresas,
  total,
}: {
  empresas: InicioVista['porDescubrir']
  total: number
}) {
  // Sin empresas publicadas no hay nada que descubrir: no se pinta un panel
  // vacío invitando a explorar la nada.
  if (empresas.length === 0) return null

  // El pie solo aparece cuando de verdad queda algo fuera. «Explorar las 3
  // empresas» debajo de una lista con esas mismas 3 es una vuelta al mismo
  // sitio, y enseña a ignorar los pies de sección.
  const hayMas = total > empresas.length

  return (
    <section className="mt-6 px-4" aria-labelledby="vibe-descubre">
      <div className="space-y-3 rounded-2xl bg-vibe-lavanda p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Compass className="size-5 shrink-0 text-vibe-violet" aria-hidden />
            <h3 id="vibe-descubre" className="truncate text-h3 text-foreground">
              Descubre más empresas
            </h3>
          </div>
          <span className="shrink-0 rounded-full border border-vibe-chip bg-card px-2.5 py-1 text-label-sm font-bold tracking-tight text-vibe-violet">
            {plural(total, 'negocio', 'negocios')}
          </span>
        </div>

        <ul className="space-y-3">
          {empresas.slice(0, 6).map((e) => (
            <li key={e.id} className="flex">
              <Link
                href={e.href}
                className="flex w-full items-center gap-2 rounded-xl border border-vibe-borde bg-card p-2 elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.99]"
              >
                <span className="relative block size-14 shrink-0 overflow-hidden rounded-lg bg-vibe-niebla">
                  {e.imagen ? (
                    <Image src={e.imagen} alt="" fill sizes="3.5rem" className="object-cover" />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-full items-center justify-center text-h3 text-vibe-violet"
                    >
                      {e.nombre.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-h4 text-foreground">{e.nombre}</span>
                  {e.rubro ? (
                    <span className="block truncate text-small text-muted-foreground">
                      {e.rubro}
                    </span>
                  ) : null}
                  {/* El número de planes es el dato que responde «¿y esto qué
                      me da?». Sin planes no se escribe «0 planes»: se calla,
                      que dice menos pero no desanima con una cifra que el
                      negocio quizá está a punto de llenar. */}
                  {e.planes > 0 ? (
                    <span className="block truncate text-label-md text-muted-foreground">
                      {plural(e.planes, 'membresía', 'membresías')}
                      {e.ciudad ? ` · ${e.ciudad}` : ''}
                    </span>
                  ) : e.ciudad ? (
                    <span className="block truncate text-label-md text-muted-foreground">
                      {e.ciudad}
                    </span>
                  ) : null}
                </span>

                <span className="grad-vibe shrink-0 rounded-full px-3 py-1.5 text-label-sm font-bold text-white">
                  Ver
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {hayMas ? (
        <RetailSeccionPie href="/cliente/explorar">
          Explorar {plural(total, 'empresa asociada', 'empresas asociadas')}
        </RetailSeccionPie>
      ) : null}
    </section>
  )
}
