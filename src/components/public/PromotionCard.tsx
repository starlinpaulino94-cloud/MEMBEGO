import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Clock, Gift, Star } from 'lucide-react'
import type { PromotionPublic } from '@/modules/marketplace/types'
import { formatDescuento } from '@/lib/promociones'
import { formatMoney } from '@/lib/format'
import { PromoCountdown } from './PromoCountdown'

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

export function PromotionCard({
  promotion,
  variant = 'default',
  hrefBase = '/promocion',
  retorno,
}: PromotionCardProps) {
  const isExpired =
    promotion.vigenciaHasta && new Date(promotion.vigenciaHasta) < new Date()

  if (variant === 'compact') {
    return (
      <Link href={detalleHref(hrefBase, promotion.id, retorno)} className="group block">
        <div className="card-interactive overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="relative h-24 w-full overflow-hidden bg-gradient-to-br from-blue-600 to-sky-500">
            {promotion.imagenUrl ? (
              <Image
                src={promotion.imagenUrl}
                alt={promotion.titulo}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Gift className="h-6 w-6 text-white/60" />
              </div>
            )}
            {promotion.descuento && (
              <span className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-xs font-bold text-info shadow-sm">
                {formatDescuento(promotion.descuento, promotion.tipo)}
              </span>
            )}
          </div>
          <div className="p-3">
            <p className="line-clamp-1 text-small font-semibold text-foreground">
              {promotion.titulo}
            </p>
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

  // Tarjeta-anuncio (Temu-style): imagen con gradiente, badge de descuento
  // protagonista, urgencia con contador y CTA gigante siempre visible.
  return (
    <Link href={detalleHref(hrefBase, promotion.id, retorno)} className="group block h-full">
      <div className="card-interactive relative flex h-full flex-col overflow-hidden rounded-3xl border border-border/60 bg-card">
        {/* Imagen protagonista */}
        <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500">
          {promotion.imagenUrl ? (
            <Image
              src={promotion.imagenUrl}
              alt={promotion.titulo}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-grid-light opacity-50" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Gift className="h-10 w-10 text-white/50" />
              </div>
            </>
          )}
          {/* Gradiente para legibilidad del chip de empresa */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />

          {/* Descuento: protagonista del anuncio */}
          {promotion.descuento && !isExpired && (
            <span className="absolute left-3 top-3 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 px-3 py-1.5 text-lg font-black tracking-tight text-white shadow-glow">
              {formatDescuento(promotion.descuento, promotion.tipo)}
            </span>
          )}

          {/* Badges de estado (derecha) */}
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
            {promotion.isFeatured && !isExpired && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
                <Star className="h-3 w-3 fill-current" aria-hidden /> Patrocinada
              </span>
            )}
            {porVencer && (
              <span className="animate-pulse rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm [animation-duration:2s]">
                Por vencer
              </span>
            )}
            {agotada && !isExpired && (
              <span className="rounded-full bg-slate-800/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                Agotada
              </span>
            )}
          </div>

          {/* Empresa: chip glass sobre la imagen */}
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-white/90 py-1 pl-1 pr-3 shadow-sm backdrop-blur">
            {promotion.company.logoUrl ? (
              <span className="relative block h-5 w-5 overflow-hidden rounded-full">
                <Image src={promotion.company.logoUrl} alt="" fill className="object-cover" />
              </span>
            ) : (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                {promotion.company.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="max-w-36 truncate text-xs font-medium text-slate-900">
              {promotion.company.name}
            </span>
          </div>

          {/* Expirada */}
          {isExpired && (
            <div className="absolute inset-0 flex items-center justify-center bg-foreground/55 backdrop-blur-[2px]">
              <span className="rounded-full border border-white/30 px-4 py-1.5 text-sm font-semibold text-white">
                Expirada
              </span>
            </div>
          )}
        </div>

        {/* Contenido */}
        <div className="flex flex-1 flex-col p-5">
          <h3 className="line-clamp-2 text-[17px] font-bold leading-snug tracking-tight text-foreground">
            {promotion.titulo}
          </h3>

          {promotion.descripcion && (
            <p className="mt-1.5 line-clamp-2 text-small text-muted-foreground">
              {promotion.descripcion}
            </p>
          )}

          {/* Precio de venta directa (si es comprable) */}
          {promotion.venta && !isExpired && (
            <p className="mt-2.5 text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
              {formatMoney(promotion.venta.precio)}
            </p>
          )}

          {promotion.codigo && (
            <div className="mt-3 inline-flex w-fit items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-2.5 py-1">
              <span className="text-caption">Código</span>
              <code className="font-mono text-xs font-bold text-foreground">
                {promotion.codigo}
              </code>
            </div>
          )}

          {/* Urgencia: contador en vivo si vence en <72h; fecha si no */}
          <div className="mt-3">
            {porVencer && promotion.vigenciaHasta ? (
              <PromoCountdown hasta={promotion.vigenciaHasta} />
            ) : promotion.vigenciaHasta ? (
              <span
                className={`inline-flex items-center gap-1.5 text-xs ${
                  isExpired ? 'font-medium text-destructive' : 'text-muted-foreground'
                }`}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {isExpired ? 'Expiró' : 'Hasta'} el {fechaCorta(promotion.vigenciaHasta)}
              </span>
            ) : null}
          </div>

          {/* CTA gigante, siempre visible (no solo al hover) */}
          <div className="mt-auto pt-4">
            <span
              className={`inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-2xl text-sm font-bold text-white shadow-md transition group-hover:opacity-95 group-active:scale-[0.99] ${
                isExpired || agotada
                  ? 'bg-slate-400'
                  : promotion.descuento
                    ? 'bg-gradient-to-r from-rose-500 to-orange-500'
                    : 'bg-gradient-to-r from-primary to-teal-400'
              }`}
            >
              {isExpired ? 'Ver detalle' : agotada ? 'Agotada · ver detalle' : 'Aprovechar ahora'}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
