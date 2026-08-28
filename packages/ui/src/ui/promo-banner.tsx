import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

/**
 * MUK · PromoBanner — banner de marketing (héroes, flash sale, invita y
 * gana, bienvenida, campañas).
 *
 * Presentacional y server-safe: el contenido interactivo (CTA, Countdown,
 * botón de cerrar) se pasa como children/slots. Tonos fijos de marketing
 * que NO cambian con el tema — la oferta se ve igual en claro y oscuro.
 *
 *   <PromoBanner tono="brand" size="hero"
 *     titulo="Invita y gana" descripcion="RD$200 por cada amigo">
 *     <Button variant="secondary">Invitar ahora</Button>
 *   </PromoBanner>
 */
const promoBannerVariants = cva(
  'relative flex w-full flex-col gap-3 overflow-hidden text-white sm:flex-row sm:items-center sm:justify-between',
  {
    variants: {
      tono: {
        /**
         * Gradiente azul→cyan de marca — beneficios y bienvenida.
         *
         * Era `from-emerald-600 to-cyan-500`. El verde dejó de ser color de
         * marca en el DS 2.0 y sobrevive solo como semántica de éxito, pero
         * este banner —la pieza más grande del home del cliente— seguía
         * pintándolo, así que lo primero que veía un cliente al entrar
         * contradecía al resto de la app. Ahora arranca en el azul de marca y
         * mantiene el cyan del cierre, que sí es del sistema.
         */
        brand: 'bg-gradient-to-br from-blue-600 to-cyan-500',
        /** Flash sale / oferta limitada — urgencia cálida. */
        hot: 'bg-gradient-to-br from-orange-500 to-rose-600',
        /** Premium / VIP — dorado sobre navy. */
        premium: 'bg-gradient-to-br from-slate-900 to-slate-800 [&_[data-banner-titulo]]:text-warning',
        /** Informativo de marca — navy profundo del logo. */
        navy: 'bg-gradient-to-br from-slate-900 to-slate-950',
        /** Celebración — violeta festivo (premios, felicidades). */
        celebracion: 'bg-gradient-to-br from-violet-600 to-fuchsia-500',
      },
      size: {
        /** Tarjeta de banner en listas y homes. */
        base: 'rounded-2xl p-5 shadow-card',
        /** Protagonista de la pantalla. */
        hero: 'rounded-2xl p-6 shadow-hero sm:p-8',
        /** Franja fina (avisos de campaña sticky). */
        slim: 'rounded-xl px-4 py-2.5 text-sm',
      },
    },
    defaultVariants: { tono: 'brand', size: 'base' },
  }
)

function PromoBanner({
  titulo,
  descripcion,
  eyebrow,
  media,
  className,
  tono,
  size,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof promoBannerVariants> & {
    titulo: React.ReactNode
    descripcion?: React.ReactNode
    /** Etiqueta pequeña sobre el título ("SOLO HOY", "NUEVO"). */
    eyebrow?: React.ReactNode
    /** Icono/emoji/imagen decorativa a la derecha. */
    media?: React.ReactNode
  }) {
  return (
    <div data-slot="promo-banner" className={cn(promoBannerVariants({ tono, size }), className)} {...props}>
      {/* Textura sutil para dar profundidad sin imágenes externas */}
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-white/10 blur-2xl" />
      <div className="relative min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-white/80">{eyebrow}</p>
        )}
        <p data-banner-titulo className={cn('font-bold', size === 'hero' ? 'text-h2' : 'text-h3')}>
          {titulo}
        </p>
        {descripcion && <p className="mt-1 text-sm text-white/85">{descripcion}</p>}
      </div>
      <div className="relative flex shrink-0 items-center gap-4">
        {media}
        {children}
      </div>
    </div>
  )
}

export { PromoBanner, promoBannerVariants }
