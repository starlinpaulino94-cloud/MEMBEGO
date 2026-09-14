import Link from 'next/link'
import {
  Car,
  Compass,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
  Scissors,
  ShoppingBag,
  Sparkles,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { RetailEmptyState } from './RetailEmptyState'

/**
 * Chips de categoría del rediseño violeta: «Todos» abre la fila en violeta
 * sólido (el único activo honesto en el Inicio: lleva al catálogo completo)
 * y cada categoría real va en píldora blanca con borde lila y su icono en
 * uno de los tres acentos del degradado, en ciclo.
 *
 * El icono se deduce del slug (la columna `icon` de BusinessCategory sigue
 * sin dueño); reserva neutra para lo que no se reconozca.
 */

const ICONOS: Record<string, LucideIcon> = {
  lavado: Car, lavados: Car, carwash: Car, automotriz: Car, vehiculos: Car,
  gastronomia: UtensilsCrossed, restaurante: UtensilsCrossed, restaurantes: UtensilsCrossed, comida: UtensilsCrossed,
  tours: Compass, turismo: Compass, excursiones: Compass,
  bienestar: HeartPulse, salud: HeartPulse,
  spa: Sparkles, belleza: Scissors, barberia: Scissors, salon: Scissors,
  gimnasio: Dumbbell, fitness: Dumbbell,
  servicios: Wrench,
  tienda: ShoppingBag, tiendas: ShoppingBag, comercio: ShoppingBag,
}

const ACENTOS = ['text-vibe-violet', 'text-vibe-cobalt', 'text-retail-cyan'] as const

export function VibeCategorias({ categorias }: { categorias: InicioVista['categorias'] }) {
  if (categorias.length === 0) {
    return (
      <RetailEmptyState
        title="Categorías"
        description="No hay categorías disponibles para explorar ahora."
      />
    )
  }

  return (
    <section className="mt-4" aria-label="Categorías">
      <div className="relative no-scrollbar flex gap-2 overflow-x-auto px-4 py-1">
        <Link
          href="/cliente/explorar"
          className="flex shrink-0 items-center gap-2 rounded-full bg-vibe-violet px-4 py-2 text-label-sm font-bold text-white outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-95"
        >
          <LayoutGrid className="size-4" aria-hidden />
          Todos
        </Link>
        {categorias.map((c, i) => {
          const Icono = ICONOS[c.slug.toLowerCase()] ?? LayoutGrid
          return (
            <Link
              key={c.id}
              href={`/cliente/explorar?category=${encodeURIComponent(c.slug)}`}
              className="flex shrink-0 items-center gap-2 rounded-full border border-vibe-chip bg-card px-4 py-2 elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-95"
            >
              <Icono className={`size-4 ${ACENTOS[i % ACENTOS.length]}`} aria-hidden />
              <span className="text-label-sm font-bold text-foreground">{c.name}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
