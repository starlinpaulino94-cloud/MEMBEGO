import Link from 'next/link'
import {
  Car,
  Compass,
  Dumbbell,
  HeartPulse,
  LayoutGrid,
  Pizza,
  Scissors,
  ShoppingBag,
  Sparkles,
  UtensilsCrossed,
  Wine,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { RailOverflowHint } from '@/components/ui/RailOverflowHint'
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

/** La gama de las píldoras: tinte, borde e icono del mismo color, en ciclo. */
const GAMA = [
  'border-vibe-violet/40 bg-vibe-violet/15 text-vibe-violet',
  'border-retail-cyan/40 bg-retail-cyan/15 text-retail-cyan',
  'border-retail-star/40 bg-retail-star/15 text-retail-star',
  'border-vibe-cobalt/40 bg-vibe-cobalt/15 text-vibe-cobalt',
  'border-retail-lagoon/40 bg-retail-lagoon/15 text-retail-lagoon',
  'border-vibe-sky/40 bg-vibe-sky/15 text-vibe-sky',
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
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 elevation-1 outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-95 ${GAMA[i % GAMA.length]}`}
              >
                <Icono className="size-4" aria-hidden />
                <span className="text-label-sm font-bold text-foreground">{c.name}</span>
              </Link>
            )
          })}
        </div>
      </RailOverflowHint>
    </section>
  )
}
