'use client'

import Link from 'next/link'
import { CalendarDays, Compass, Trash2, Users } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { RUTA_CARRITO_EXCURSIONES } from '@/modules/comercio/rutas'
import { Button } from '@/components/ui/button'
import { useExcursionCart } from './ExcursionCarritoContext'

/**
 * La sección de EXCURSIONES del carrito único de la app (`/cliente/carrito`).
 *
 * Es un resumen: cada excursión con su fecha, hora y pasajeros, y el total. Las reservas se confirman (en destino o en
 * línea) en `/cliente/carrito/excursiones`, que es el checkout de excursiones de siempre: el carrito de excursiones
 * guarda lo suyo y se paga por su propia acción, pero se VE junto con el de productos y servicios.
 */
export function ExcursionesEnElCarrito() {
  const { items, removeItem, subtotal } = useExcursionCart()
  if (items.length === 0) return null
  const moneda = items[0].moneda
  return (
    <section className="rounded-lg border border-border" data-testid="carrito-excursiones" aria-label="Excursiones del carrito">
      <header className="flex items-center gap-2 border-b border-border p-4">
        <Compass className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-h3 text-foreground">Excursiones</h2>
      </header>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-start justify-between gap-3 p-4" data-testid="carrito-excursion-renglon">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{it.nombreExcursion}</p>
              <p className="text-sm text-muted-foreground">{it.varianteNombre}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  {it.fecha}
                  {it.hora ? ` · ${it.hora}` : ''}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {it.adultos} {it.adultos === 1 ? 'adulto' : 'adultos'}
                  {it.ninos > 0 ? ` · ${it.ninos} ${it.ninos === 1 ? 'niño' : 'niños'}` : ''}
                </span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="tabular-nums text-foreground">{formatMoney(it.adultos * it.precioAdulto + it.ninos * it.precioNino, { moneda: it.moneda })}</p>
              <button type="button" onClick={() => removeItem(it.id)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" aria-label={`Quitar ${it.nombreExcursion}`}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
        <p className="text-sm text-muted-foreground">
          Total <span className="ml-1 text-lg font-semibold text-foreground tabular-nums">{formatMoney(subtotal, { moneda })}</span>
        </p>
        <Button asChild>
          <Link href={RUTA_CARRITO_EXCURSIONES}>Revisar y reservar</Link>
        </Button>
      </footer>
    </section>
  )
}
