import Link from 'next/link'
import { ArrowRight, Gift } from 'lucide-react'
import { FeedNovedades } from '@/components/cliente/FeedNovedades'
import type { NovedadInicio } from '@/modules/social/queries'

/**
 * El cierre del Inicio: invitar y enterarse.
 *
 * Va al final a propósito. Antes era un `PromoBanner` con degradado de
 * celebración; en retail es una fila fina, porque compite con la wallet y las
 * ofertas y no debe ganarles la mirada.
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
    <section className="bg-background px-4 py-5 md:px-6 md:py-6" aria-labelledby="retail-descubre">
      <div className="mx-auto max-w-6xl">
        <h2 id="retail-descubre" className="text-h2 text-foreground">
          Descubre más
        </h2>

        {mostrarInvitaYGana ? (
          <Link
            href="/cliente/invita-y-gana"
            className="mt-3 flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card p-4 outline-none transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Gift className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-small font-semibold text-foreground">
                Regala beneficios, gana premios
              </span>
              <span className="mt-0.5 block text-caption text-muted-foreground">
                Comparte tu enlace: tus amigos reciben un regalo y tú acumulas recompensas.
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        ) : null}

        {novedades.length > 0 ? (
          <div className="mt-4">
            <FeedNovedades novedades={[...novedades]} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
