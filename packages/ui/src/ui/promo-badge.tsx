import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

/**
 * MDS · PromoBadge — etiquetas de MARKETING (Nuevo, Hot, VIP, Expira…).
 *
 * Distinto del `Badge` semántico (estados del sistema: activo, pendiente,
 * error): estas etiquetas venden. Colores fijos de la escala de marca —
 * NO cambian con el tema — para que una promo se vea igual de urgente en
 * modo claro y oscuro. Ver docs/MDS.md § Badges.
 */
const promoBadgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide [&>svg]:size-3',
  {
    variants: {
      tono: {
        /** Nuevo / Hoy — llegada reciente. */
        nuevo: 'bg-info text-white',
        /** Hot / Oferta — demanda alta, rebaja. */
        hot: 'bg-gradient-to-r from-orange-500 to-rose-500 text-white',
        /** Premium / VIP / Exclusivo — estatus. */
        premium: 'bg-gradient-to-r from-amber-400 to-yellow-500 text-warning',
        /** Expira / Limitado — urgencia (el único rojo de marketing). */
        urgencia: 'bg-destructive text-white',
        /** Gratis / Regalo — beneficio sin costo (verde de marca). */
        gratis: 'bg-success text-white',
        /** Recomendado — sugerencia del sistema. */
        recomendado: 'bg-violet-500 text-white',
        /** Neutro — metadatos sin carga emocional (categoría, cupo). */
        neutro: 'bg-black/60 text-white backdrop-blur-sm',
      },
    },
    defaultVariants: { tono: 'neutro' },
  }
)

function PromoBadge({
  className,
  tono,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof promoBadgeVariants>) {
  return (
    <span
      data-slot="promo-badge"
      className={cn(promoBadgeVariants({ tono }), className)}
      {...props}
    />
  )
}

export { PromoBadge, promoBadgeVariants }
