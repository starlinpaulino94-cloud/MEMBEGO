import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, CircleHelp, Frown, QrCode } from 'lucide-react'
import { formatDescuento } from '@/lib/promociones'
import { formatMoney } from '@/lib/format'
import type { PromotionPublic } from '@/modules/marketplace/types'
import { RetailSeccionHeader, RetailValoracion } from '@/components/cliente/inicio/RetailSeccion'

/**
 * Mi QR cuando todavía no hay pase que enseñar (contrato Stitch S04).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Un estado vacío no es una pantalla en blanco con mejor tipografía. Esta lo
 * dice y ofrece tres salidas en orden de compromiso: explorar negocios, el
 * beneficio de bienvenida si la empresa lo financia, y el catálogo de lo más
 * popular cerca.
 *
 * El beneficio de bienvenida lleva la barra de acento a la izquierda que marca
 * el diseño: es lo único de esta pantalla que la empresa paga, y se distingue
 * del resto sin necesidad de un color nuevo.
 */

export interface PromoDestacada {
  readonly promo: PromotionPublic
  readonly valoracion: number | null
  readonly resenas: number
}

export function QrSinBeneficio({
  destacadas,
  bienvenida,
  ciudad,
}: {
  destacadas: readonly PromoDestacada[]
  bienvenida: string | null
  ciudad: string | null
}) {
  return (
    <div className="animate-fade-up space-y-5">
      <section className="flex flex-col items-center px-4 pt-6 text-center">
        <span className="relative flex size-28 items-center justify-center rounded-lg bg-brand-primary-soft text-primary">
          <QrCode className="size-14" aria-hidden />
          <span className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full border border-border bg-card text-primary">
            <Frown className="size-5" aria-hidden />
          </span>
        </span>
        <h1 className="mt-4 text-h1 text-foreground">No tienes beneficios activos</h1>
        <p className="mt-1 max-w-xs text-small text-muted-foreground">
          Nada aquí todavía. Solo posibilidades para ahorrar y disfrutar cada día.
        </p>
        <Link
          href="/cliente/explorar"
          className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-label-lg text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          Continuar explorando negocios locales
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      {bienvenida ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-l-4 border-retail-cyan p-4">
            <p className="inline-block rounded-full bg-brand-primary-soft px-2.5 py-1 text-label-sm uppercase tracking-wide text-primary">
              Beneficio exclusivo
            </p>
            <p className="mt-2 text-h4 text-foreground">{bienvenida}</p>
            <Link
              href="/cliente/planes"
              className="mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-label-lg text-primary-foreground outline-none transition-colors duration-fast hover:bg-brand-primary-hover focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.98]"
            >
              Ver membresías disponibles
            </Link>
          </div>
        </section>
      ) : null}

      {destacadas.length > 0 ? (
        <section aria-labelledby="qr-destacadas">
          <RetailSeccionHeader
            id="qr-destacadas"
            titulo="Beneficios y membresías"
            bajada={ciudad ? `Los más populares cerca de ${ciudad}` : 'Los más populares cerca de ti'}
            enlace={{ href: '/cliente/promociones', texto: 'Ver todo' }}
          />

          <ul className="mt-3 grid grid-cols-2 gap-3">
            {destacadas.map(({ promo, valoracion, resenas }) => (
              <li key={promo.id} className="flex">
                {/* La tarjeta entera es el enlace: la imagen invita y el
                    detalle es el perfil de la promoción, con su galería,
                    descripción y reseñas. */}
                <Link
                  href={`/cliente/promociones/${promo.id}`}
                  className="group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1 outline-none transition-colors duration-fast hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
                >
                <div className="relative aspect-square bg-muted">
                  {promo.imagenUrl ? (
                    <Image
                      src={promo.imagenUrl}
                      alt=""
                      fill
                      sizes="(min-width: 768px) 20rem, 50vw"
                      className="object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center bg-brand-primary-soft text-h1 text-primary">
                      {promo.titulo.slice(0, 1)}
                    </span>
                  )}
                  {/* El sello sale del descuento declarado, no de un cálculo:
                      reconstruir el precio anterior sería inventarlo. */}
                  {promo.descuento ? (
                    <span className="absolute left-2 top-2 rounded-full bg-foreground/85 px-2 py-0.5 text-label-sm font-semibold text-background">
                      {formatDescuento(promo.descuento, promo.tipo)}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col p-3">
                  <p className="line-clamp-2 min-h-10 text-label-lg text-foreground">
                    {promo.titulo}
                  </p>
                  <div className="mt-1">
                    <RetailValoracion valoracion={valoracion} resenas={resenas} />
                  </div>
                  {promo.venta ? (
                    <p className="mt-auto pt-1 text-price-lg text-foreground">
                      {formatMoney(promo.venta.precio)}
                    </p>
                  ) : null}
                </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex items-start gap-3 rounded-lg bg-brand-primary-soft p-4">
        <CircleHelp className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="text-label-lg text-foreground">¿Cómo funciona Mi QR?</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            Al suscribirte a cualquier negocio afiliado, tu código personal se activará aquí al
            instante para canjear en caja.
          </p>
        </div>
      </section>
    </div>
  )
}
