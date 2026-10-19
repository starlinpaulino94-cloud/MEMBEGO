'use client'

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { RUTA_CARRITO } from '@/modules/comercio/rutas'
import { useExcursionCart } from '@/components/excursiones/ExcursionCarritoContext'
import { useCarrito } from './useCarrito'

/**
 * El carrito en el encabezado de la APP: círculo blanco sobre el degradado de marca, como la campana y el avatar.
 * Es UN solo carrito visible, con productos, servicios y excursiones: el número suma las unidades de productos y
 * servicios más las excursiones (cada excursión del carrito cuenta una, sin importar cuántos pasajeros lleve).
 *
 * El carrito existe únicamente dentro de `/cliente`; la landing no tiene. Cada tipo guarda lo suyo y paga por su propia
 * acción; aquí solo se cuenta.
 */
export function IconoCarrito() {
  const { unidades } = useCarrito()
  const { items } = useExcursionCart()
  const total = unidades + items.length
  return (
    <Link
      href={RUTA_CARRITO}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white bg-white text-vibe-deep outline-none shadow-sm transition-colors duration-fast hover:bg-vibe-niebla focus-visible:ring-2 focus-visible:ring-white active:scale-95"
      aria-label={total > 0 ? `Carrito, ${total} ${total === 1 ? 'elemento' : 'elementos'}` : 'Carrito'}
      data-testid="carrito-icono"
    >
      <ShoppingCart className="h-5 w-5" aria-hidden />
      {total > 0 && (
        <span data-testid="carrito-contador" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground tabular-nums">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  )
}
