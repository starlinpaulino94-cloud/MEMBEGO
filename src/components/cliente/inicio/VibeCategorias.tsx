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
import { RailOverflowHint } from '@/components/ui/RailOverflowHint'
import { cn } from '@/lib/utils'
import { RetailEmptyState } from './RetailEmptyState'

/**
 * Chips de categoría del rediseño violeta: «Todos» abre la fila en violeta
 * sólido (el único activo honesto en el Inicio: lleva al catálogo completo)
 * y cada categoría real va en píldora con SU color de la gama —tinte de
 * fondo, borde e icono— en ciclo.
 *
 * El texto va en tinta oscura siempre: el color es decorativo y así se lee
 * igual con cualquier acento, sin depender del contraste de cada uno.
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

const CLASE_BOTON = 'flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-label-sm font-bold text-white shadow-sm outline-none transition-[box-shadow,transform] duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-95'
const COLORES = [
  'bg-gradient-to-r from-vibe-violet to-vibe-cobalt',
  'bg-gradient-to-r from-cyan-500 to-sky-500',
  'bg-gradient-to-r from-amber-500 to-orange-500',
  'bg-gradient-to-r from-pink-500 to-rose-500',
  'bg-gradient-to-r from-emerald-500 to-teal-500',
  'bg-gradient-to-r from-indigo-500 to-blue-500',
] as const

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
      <RailOverflowHint className="from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-1 pr-12">
          <Link
            href="/cliente/explorar"
            aria-current="page"
            className={cn(
              CLASE_BOTON,
              COLORES[0],
              'border-2 border-white ring-2 ring-white ring-offset-2 ring-offset-vibe-fondo'
            )}
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
                className={cn(CLASE_BOTON, COLORES[i % COLORES.length])}
              >
                <Icono className="size-4" aria-hidden />
                <span className="text-label-sm font-bold text-white">{c.name}</span>
              </Link>
            )
          })}
        </div>
      </RailOverflowHint>
    </section>
  )
}
