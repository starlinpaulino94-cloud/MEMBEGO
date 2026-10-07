'use client'

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { useCarrito } from './useCarrito'

/** El carrito en el encabezado: enlace con el número de unidades (solo si hay). */
export function IconoCarrito({ className = '', onClick }: { className?: string; onClick?: () => void }) {
  const { unidades } = useCarrito()
  return (
    <Link href="/carrito" onClick={onClick} className={`relative inline-flex items-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground ${className}`} aria-label={unidades > 0 ? `Carrito, ${unidades} ${unidades === 1 ? 'producto' : 'productos'}` : 'Carrito'}>
      <ShoppingCart className="h-5 w-5" aria-hidden />
      {unidades > 0 && (
        <span data-testid="carrito-contador" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
          {unidades > 99 ? '99+' : unidades}
        </span>
      )}
    </Link>
  )
}
