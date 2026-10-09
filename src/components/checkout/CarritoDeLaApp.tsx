'use client'

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { useExcursionCart } from '@/components/excursiones/ExcursionCarritoContext'
import { ExcursionesEnElCarrito } from '@/components/excursiones/ExcursionesEnElCarrito'
import { Button } from '@/components/ui/button'
import { CarritoVista } from './CarritoVista'
import { useCarrito } from './useCarrito'

/**
 * EL CARRITO ÚNICO DE LA APP (`/cliente/carrito`): productos y servicios, y excursiones, en una sola pantalla.
 *
 * No se unifica el modelo: cada tipo guarda lo suyo en el navegador y se paga por su propia acción (un pedido por
 * negocio; una reserva por excursión). Lo que es uno es lo que la persona VE: una pantalla, un contador en el
 * encabezado, un solo «Tu carrito está vacío».
 */
export function CarritoDeLaApp() {
  const { carrito } = useCarrito()
  const { items } = useExcursionCart()
  const hayProductos = Object.keys(carrito.negocios).length > 0
  const hayExcursiones = items.length > 0

  if (!hayProductos && !hayExcursiones) {
    return (
      <div className="mt-10 rounded-lg border border-border py-16 text-center text-muted-foreground">
        <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
        <p className="font-medium">Tu carrito está vacío</p>
        <p className="text-sm">Agrega productos desde la ficha de cualquier negocio, o excursiones desde su ficha.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/cliente/explorar">Ver negocios</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/cliente/excursiones">Ver excursiones</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-8">
      {hayProductos && (
        <section aria-label="Productos y servicios">
          {hayExcursiones && <h2 className="mb-3 text-h3 text-foreground">Productos y servicios</h2>}
          <CarritoVista />
        </section>
      )}
      {hayExcursiones && <ExcursionesEnElCarrito />}
    </div>
  )
}
