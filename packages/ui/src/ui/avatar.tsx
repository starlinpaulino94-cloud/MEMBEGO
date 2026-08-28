/* eslint-disable @next/next/no-img-element */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

/**
 * MUK · Avatar / AvatarStack — personas y logos de empresa.
 *
 * Con `src` muestra la imagen; sin ella, iniciales sobre fondo de marca
 * (determinista: siempre el mismo tono para el mismo nombre). `AvatarStack`
 * apila avatares con solape y "+N" (prueba social: "12 personas ya usan…").
 */
const avatarVariants = cva(
  'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-background',
  {
    variants: {
      size: {
        xs: 'size-6 text-xs',
        sm: 'size-8 text-xs',
        md: 'size-10 text-sm',
        lg: 'size-14 text-lg',
        xl: 'size-20 text-2xl',
      },
    },
    defaultVariants: { size: 'md' },
  }
)

/** Tonos de iniciales — fijos, generados por hash del nombre. */
const TONOS = [
  'bg-primary-100 text-primary-800',
  'bg-info text-info',
  'bg-violet-100 text-violet-800',
  'bg-warning text-warning',
  'bg-destructive text-destructive',
] as const

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?'
}

function tonoDe(nombre: string): string {
  let h = 0
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % TONOS.length
  return TONOS[h]
}

function Avatar({
  src,
  nombre,
  className,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof avatarVariants> & {
    src?: string | null
    /** Nombre para iniciales y alt. */
    nombre: string
  }) {
  return (
    <span
      data-slot="avatar"
      className={cn(avatarVariants({ size }), !src && tonoDe(nombre), className)}
      {...props}
    >
      {src ? (
        <img src={src} alt={nombre} className="size-full object-cover" />
      ) : (
        <span aria-hidden>{iniciales(nombre)}</span>
      )}
    </span>
  )
}

function AvatarStack({
  items,
  max = 4,
  size = 'sm',
  className,
}: {
  items: { src?: string | null; nombre: string }[]
  max?: number
  size?: VariantProps<typeof avatarVariants>['size']
  className?: string
}) {
  const visibles = items.slice(0, max)
  const resto = items.length - visibles.length
  return (
    <span data-slot="avatar-stack" className={cn('inline-flex items-center -space-x-2', className)}>
      {visibles.map((it, i) => (
        <Avatar key={i} size={size} src={it.src} nombre={it.nombre} />
      ))}
      {resto > 0 && (
        <span className={cn(avatarVariants({ size }), 'bg-secondary text-secondary-foreground')}>
          +{resto}
        </span>
      )}
    </span>
  )
}

export { Avatar, AvatarStack }
