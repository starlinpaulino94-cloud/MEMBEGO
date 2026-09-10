import Link from 'next/link'
import { Gift, Share2 } from 'lucide-react'

/**
 * El banner de referidos del rediseño violeta: tarjeta en el degradado de la
 * cabecera con el sello cian «Invita y gana», titular, copy y el botón
 * blanco «Compartir mi enlace». La marca de agua es el regalo, recortada por
 * la propia tarjeta.
 *
 * El copy es el del programa REAL (regalo de bienvenida + puntos); las
 * cifras de maqueta del export («1 semana gratis», «100 puntos») no viajan:
 * prometer números que el programa no fija es deuda con el cliente.
 */
export function VibeReferidos() {
  return (
    <section className="mt-6 px-4" aria-labelledby="vibe-referidos">
      <div className="grad-vibe-header relative overflow-hidden rounded-2xl p-4 elevation-2">
        <Gift
          aria-hidden
          className="pointer-events-none absolute -bottom-6 -right-6 size-36 text-white/10"
        />
        <div className="relative z-10 max-w-[85%] space-y-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-retail-cyan px-2.5 py-0.5 text-label-sm font-bold uppercase tracking-wider text-white">
            <Gift className="size-3.5" aria-hidden />
            Invita y gana
          </span>
          <h3 id="vibe-referidos" className="text-h2 leading-tight text-white">
            Regala beneficios, gana premios
          </h3>
          <p className="text-small text-vibe-borde">
            Tus amigos reciben <span className="font-bold text-white">un regalo de bienvenida</span>{' '}
            y tú acumulas <span className="font-bold text-vibe-aqua">puntos canjeables</span>.
          </p>
          <div className="pt-2">
            <Link
              href="/cliente/invita-y-gana"
              className="inline-flex items-center gap-2 rounded-full bg-card px-6 py-2.5 text-label-md font-bold text-vibe-deep elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-white active:scale-95"
            >
              <Share2 className="size-4 text-vibe-violet" aria-hidden />
              Compartir mi enlace
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
