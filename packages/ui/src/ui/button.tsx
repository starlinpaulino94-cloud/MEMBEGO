import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 aria-invalid:ring-destructive/20 aria-invalid:border-destructive select-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:opacity-90 active:scale-[0.98]",
        destructive:
          "bg-destructive text-white shadow-sm hover:bg-destructive/90 active:scale-[0.98] focus-visible:ring-destructive/30",
        outline:
          "border border-border bg-background shadow-sm hover:bg-muted hover:text-foreground active:scale-[0.98] dark:bg-transparent dark:hover:bg-white/5",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:scale-[0.98]",
        ghost:
          "hover:bg-muted hover:text-foreground active:scale-[0.98] dark:hover:bg-white/8",
        link:
          "text-primary underline-offset-4 hover:underline p-0 h-auto font-medium",
        success:
          "bg-success text-success-foreground shadow-sm hover:bg-success/90 active:scale-[0.98] focus-visible:ring-success/30",
        /* MUK: gradiente de marca sin glow — CTAs de marketing en listas. */
        gradient:
          "bg-gradient-brand text-white shadow-sm hover:opacity-90 active:scale-[0.98]",
        /* MUK: EL CTA protagonista — gradiente + glow. Máximo uno por pantalla. */
        premium:
          "bg-gradient-brand text-white shadow-glow hover:shadow-glow-strong hover:opacity-95 active:scale-[0.98]",
        /* MUK: cristal — solo sobre imágenes o gradientes (héroes, banners). */
        glass:
          "glass-surface text-foreground hover:bg-card/80 active:scale-[0.98]",
      },
      /**
       * DS 2.0 · Alturas y área táctil.
       *
       * `tokens.minTouchTarget` declara 44px desde hace tiempo y nada lo
       * consumía: el tamaño por defecto era de 36px. Toda la escala sube un
       * paso, y `lg` (44px) es EL tamaño de las superficies táctiles —
       * scanner, área de cliente, hojas inferiores, formularios en móvil.
       *
       * `default` se queda en 40px a propósito: 44 en cada botón de una
       * tabla de administración convierte el panel en un mando a distancia.
       * Es el compromiso entre densidad de escritorio y dedo.
       */
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm:      "h-9 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5 text-[13px]",
        lg:      "h-11 rounded-xl px-6 has-[>svg]:px-4 text-base",
        xl:      "h-12 rounded-xl px-8 has-[>svg]:px-5 text-base font-semibold",
        icon:    "size-10 rounded-xl",
        "icon-sm": "size-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** MUK: muestra spinner y deshabilita mientras la acción está en curso. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <svg
            className="size-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
