import Link from 'next/link'
import Image from 'next/image'
import { Clock, Star } from 'lucide-react'
import type { PromotionPublic } from '@/modules/marketplace/types'
import { formatDescuento } from '@/lib/promociones'
import { formatMoney } from '@/lib/format'
import { PromoCountdown } from './PromoCountdown'

/**
 * TARJETA DE PROMOCIÓN — lenguaje retail (contrato Stitch + dirección Amazon).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE CAMBIÓ Y POR QUÉ
 *
 * La versión anterior era un anuncio estilo Temu: degradados de relleno, chip
 * de cristal, CTA gigante «Aprovechar ahora» en cada tarjeta. La dirección del
 * usuario es la contraria: LA IMAGEN MANDA. La tarjeta entera es el enlace, el
 * arte va en 1:1 (el formato que exige la subida), y el compromiso se pide en
 * el perfil de la promoción — que ahora tiene galería, descripción y reseñas
 * con qué pedirlo.
 *
 * Lo FUNCIONAL se queda, porque es dato y decide: el sello de descuento, el
 * contador cuando vence en <72 h, la fecha de vigencia, el código, el precio,
 * y los estados (por vencer, agotada, expirada). Lo decorativo se fue.
 *
 * La API no cambió: mismas props, mismos consumidores (catálogo del cliente,
 * buscador, landing pública).
 */

interface PromotionCardProps {
  promotion: PromotionPublic
  variant?: 'default' | 'compact'
  /**
   * Base de la ruta del detalle. Público = '/promocion' (Landing); dentro de la
   * app se pasa '/cliente/promociones' para no salir del contexto autenticado.
   */
  hrefBase?: string
  /** Ruta a la que volver desde el detalle (se añade como `?retorno=`). */
  retorno?: string
}

function fechaCorta(d: string | Date) {
  return new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'short' }).format(
    new Date(d)
  )
}

function detalleHref(hrefBase: string, id: string, retorno?: string) {
  const base = `${hrefBase}/${id}`
  return retorno ? `${base}?retorno=${encodeURIComponent(retorno)}` : base
}

/** El arte 1:1 con sus sellos. Sin imagen: inicial sobre tinte de marca. */
function Arte({
  promotion,
  isExpired,
  porVencer,
  agotada,
}: {
  promotion: PromotionPublic
  isExpired: boolean
  porVencer: boolean
  agotada: boolean
}) {
  return (
    <div className="relative aspect-square w-full bg-muted">
      {promotion.imagenUrl ? (
        <Image
          src={promotion.imagenUrl}
          alt=""
          fill
          sizes="(min-width: 1024px) 20rem, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform duration-base group-hover:scale-105"
        />
      ) : (
        <span className="flex size-full items-center justify-center bg-brand-primary-soft text-h1 text-primary" aria-hidden>
          {promotion.titulo.slice(0, 1).toUpperCase()}
        </span>
      )}

      {promotion.descuento && !isExpired ? (
        <span className="absolute left-2 top-2 rounded-full bg-foreground/85 px-2.5 py-1 text-label-lg text-background">
          {formatDescuento(promotion.descuento, promotion.tipo)}
        </span>
      ) : null}

      <span className="absolute right-2 top-2 flex flex-col items-end gap-1">
        {promotion.isFeatured && !isExpired ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-card/95 px-2 py-0.5 text-label-sm font-semibold text-foreground">
            <Star className="size-3 fill-retail-star text-retail-star" aria-hidden /> Destacada
          </span>
        ) : null}
        {porVencer ? (
          <span className="rounded-full bg-destructive px-2 py-0.5 text-label-sm font-semibold text-white">
            Por vencer
          </span>
        ) : null}
        {agotada && !isExpired ? (
          <span className="rounded-full bg-foreground/85 px-2 py-0.5 text-label-sm font-semibold text-background">
            Agotada
          </span>
        ) : null}
      </span>

      {isExpired ? (
        <span className="absolute inset-0 flex items-center justify-center bg-foreground/55">
          <span className="rounded-full border border-white/60 px-4 py-1.5 text-label-lg text-white">
            Expirada
          </span>
        </span>
      ) : null}
    </div>
  )
}

export function PromotionCard({
  promotion,
  variant = 'default',
  hrefBase = '/promocion',
  retorno,
}: PromotionCardProps) {
  const isExpired = Boolean(
    promotion.vigenciaHasta && new Date(promotion.vigenciaHasta) < new Date()
  )

  if (variant === 'compact') {
    return (
      <Link
        href={detalleHref(hrefBase, promotion.id, retorno)}
        className="group block outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="overflow-hidden rounded-lg border border-border bg-card elevation-1 transition-colors duration-fast group-hover:border-primary/40">
          <div className="relative h-24 w-full bg-muted">
            {promotion.imagenUrl ? (
              <Image
                src={promotion.imagenUrl}
                alt=""
                fill
                sizes="12rem"
                className="object-cover transition-transform duration-base group-hover:scale-105"
              />
            ) : (
              <span className="flex size-full items-center justify-center bg-brand-primary-soft text-h3 text-primary" aria-hidden>
                {promotion.titulo.slice(0, 1).toUpperCase()}
              </span>
            )}
            {promotion.descuento ? (
              <span className="absolute right-2 top-2 rounded-full bg-foreground/85 px-2 py-0.5 text-label-sm font-semibold text-background">
                {formatDescuento(promotion.descuento, promotion.tipo)}
              </span>
            ) : null}
          </div>
          <div className="p-3">
            <p className="line-clamp-1 text-label-lg text-foreground">{promotion.titulo}</p>
            <p className="mt-0.5 line-clamp-1 text-caption">{promotion.company.name}</p>
          </div>
        </div>
      </Link>
    )
  }

  // Urgencia real: menos de 72 h de vigencia → contador regresivo en vivo.
  const ahora = new Date()
  const porVencer =
    !isExpired &&
    promotion.vigenciaHasta != null &&
    new Date(promotion.vigenciaHasta) > ahora &&
    new Date(promotion.vigenciaHasta).getTime() - ahora.getTime() < 72 * 60 * 60 * 1000
  const agotada = promotion.venta?.agotada ?? false

  return (
    <Link
      href={detalleHref(hrefBase, promotion.id, retorno)}
      className="group block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card elevation-1 transition-colors duration-fast group-hover:border-primary/40">
        <Arte promotion={promotion} isExpired={isExpired} porVencer={porVencer} agotada={agotada} />

        <div className="flex flex-1 flex-col p-3">
          <h3 className="line-clamp-2 text-label-lg text-foreground">{promotion.titulo}</h3>
          <p className="mt-0.5 line-clamp-1 text-caption">{promotion.company.name}</p>

          {promotion.venta && !isExpired ? (
            <p className="mt-1.5 text-price-lg tabular-nums text-foreground">
              {formatMoney(promotion.venta.precio)}
            </p>
          ) : null}

          {promotion.codigo ? (
            <p className="mt-2 inline-flex w-fit items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1">
              <span className="text-label-sm text-muted-foreground">Código</span>
              <code className="font-mono text-label-md font-bold text-foreground">
                {promotion.codigo}
              </code>
            </p>
          ) : null}

          {/* Urgencia: contador en vivo si vence en <72 h; fecha si no. */}
          <div className="mt-auto pt-2">
            {porVencer && promotion.vigenciaHasta ? (
              <PromoCountdown hasta={promotion.vigenciaHasta} />
            ) : promotion.vigenciaHasta ? (
              <span
                className={`inline-flex items-center gap-1.5 text-label-md ${
                  isExpired ? 'font-semibold text-destructive' : 'text-muted-foreground'
                }`}
              >
                <Clock className="size-3.5" aria-hidden />
                {isExpired ? 'Expiró' : 'Hasta'} el {fechaCorta(promotion.vigenciaHasta)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  )
}
