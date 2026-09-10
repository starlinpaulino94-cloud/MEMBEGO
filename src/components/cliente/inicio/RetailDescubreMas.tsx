import Link from 'next/link'
import { Gift } from 'lucide-react'
import { FeedNovedades } from '@/components/cliente/FeedNovedades'
import type { NovedadInicio } from '@/modules/social/queries'

/**
 * El cierre del Inicio: enterarse e invitar.
 *
 * La cabecera «Descubre más» se retiró (2026-09-09): solo titulaba la
 * invitación, y un título para una sola fila es ruido. Quedan las dos piezas
 * con las recetas del Inicio de Stitch:
 *
 *   NOVEDADES — filas densas sobre la banda azul niebla (FeedNovedades trae
 *   su propia cabecera de sección con «Ver todas ›»).
 *   INVITA Y GANA — la fila clara de «¿Tienes un código de comercio?»: banda
 *   azul niebla, texto en azul profundo y la píldora azul de acción.
 *
 * `mostrarInvitaYGana` llega en falso cuando el motor de experiencias YA eligió
 * los referidos como protagonista de la pantalla: la misma invitación dos
 * veces se lee como un error, no como insistencia.
 */
export function RetailDescubreMas({
  novedades,
  mostrarInvitaYGana,
}: {
  novedades: readonly NovedadInicio[]
  mostrarInvitaYGana: boolean
}) {
  if (!mostrarInvitaYGana && novedades.length === 0) return null

  return (
    <>
      {novedades.length > 0 ? (
        <section
          className="bg-retail-mist px-4 py-5 md:px-6 md:py-6"
          aria-labelledby="retail-novedades"
        >
          <div className="mx-auto max-w-6xl">
            <FeedNovedades novedades={[...novedades]} />
          </div>
        </section>
      ) : null}

      {mostrarInvitaYGana ? (
        <section className="bg-background px-4 py-5 md:px-6 md:py-6" aria-label="Invita y gana">
          <div className="mx-auto max-w-6xl">
            <Link
              href="/cliente/invita-y-gana"
              className="flex min-h-14 items-center gap-3 rounded-xl bg-retail-mist p-4 outline-none transition-colors duration-fast hover:bg-brand-primary-soft focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
            >
              <Gift className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-small font-bold text-retail-deep">
                  Regala beneficios, gana premios
                </span>
                <span className="mt-0.5 block text-caption text-retail-deep/75">
                  Tus amigos reciben un regalo y tú acumulas puntos.
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-primary px-4 py-2 text-label-md font-semibold text-primary-foreground">
                Compartir
              </span>
            </Link>
          </div>
        </section>
      ) : null}
    </>
  )
}
