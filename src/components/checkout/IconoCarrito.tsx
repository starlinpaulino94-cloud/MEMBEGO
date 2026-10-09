'use client'

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { RUTA_CARRITO } from '@/modules/comercio/rutas'
import { useCarrito } from './useCarrito'

/**
 * El carrito en el encabezado de la APP: círculo blanco sobre el degradado de marca, como la campana y el avatar,
 * con el número de unidades (solo si hay). El carrito existe únicamente dentro de `/cliente`; la landing no tiene.
 */
export function IconoCarrito() {
  const { unidades } = useCarrito()
  return (
    <Link
      href={RUTA_CARRITO}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white bg-white text-vibe-deep outline-none shadow-sm transition-colors duration-fast hover:bg-vibe-niebla focus-visible:ring-2 focus-visible:ring-white active:scale-95"
      aria-label={unidades > 0 ? `Carrito, ${unidades} ${unidades === 1 ? 'producto' : 'productos'}` : 'Carrito'}
      data-testid="carrito-icono"
    >
      <ShoppingCart className="h-5 w-5" aria-hidden />
      {unidades > 0 && (
        <span data-testid="carrito-contador" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground tabular-nums">
          {unidades > 99 ? '99+' : unidades}
        </span>
      )}
    </Link>
  )
}
