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
 * Accesos rápidos por categoría — píldoras con icono y etiqueta debajo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOBRE LOS ICONOS
 *
 * `BusinessCategory` tiene una columna `icon`, pero está vacía y no la pinta
 * nadie: es otra configuración sin dueño, como los sinónimos de búsqueda. Le
 * toca su pantalla en F3.
 *
 * Mientras tanto el icono se deduce del slug, que sí es un dato real, con una
 * reserva neutra para lo que no reconozca. Es preferible a inventarse un icono
 * por categoría en el código, y sobre todo a que la fila se vea vacía.
 *
 * `Todos` cierra la fila, como en el diseño: siempre hay salida al catálogo
 * completo aunque ninguna categoría le sirva a quien mira.
 */

const ICONOS: Record<string, LucideIcon> = {
  lavado: Car,
  lavados: Car,
  carwash: Car,
  automotriz: Car,
  vehiculos: Car,
  gastronomia: UtensilsCrossed,
  restaurante: UtensilsCrossed,
  restaurantes: UtensilsCrossed,
  comida: UtensilsCrossed,
  tours: Compass,
  turismo: Compass,
  excursiones: Compass,
  bienestar: HeartPulse,
  salud: HeartPulse,
  spa: Sparkles,
  belleza: Scissors,
  barberia: Scissors,
  salon: Scissors,
  gimnasio: Dumbbell,
  fitness: Dumbbell,
  servicios: Wrench,
  tienda: ShoppingBag,
  tiendas: ShoppingBag,
  comercio: ShoppingBag,
}

function iconoDe(slug: string): LucideIcon {
  return ICONOS[slug.toLowerCase()] ?? LayoutGrid
}

function Pildora({
  href,
  etiqueta,
  Icono,
  destacada = false,
}: {
  href: string
  etiqueta: string
  Icono: LucideIcon
  destacada?: boolean
}) {
  return (
    <Link
      href={href}
      className="flex w-16 flex-col items-center gap-1.5 rounded-lg p-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span
        className={`flex size-12 items-center justify-center rounded-lg border transition-colors duration-fast ${
          destacada
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-primary hover:border-primary/40'
        }`}
      >
        <Icono className="size-5" aria-hidden />
      </span>
      <span className="line-clamp-2 text-label-md text-foreground">{etiqueta}</span>
    </Link>
  )
}

export function RetailCategorias({ categorias }: { categorias: InicioVista['categorias'] }) {
  if (categorias.length === 0) {
    return (
      <RetailEmptyState
        title="Categorías"
        description="No hay categorías disponibles para explorar ahora."
      />
    )
  }

  return (
    <section className="border-b border-border bg-card py-3" aria-label="Categorías">
      <ul className="relative no-scrollbar mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 md:px-6">
        {categorias.map((categoria) => (
          <li key={categoria.id} className="shrink-0">
            <Pildora
              href={`/cliente/explorar?category=${encodeURIComponent(categoria.slug)}`}
              etiqueta={categoria.name}
              Icono={iconoDe(categoria.slug)}
            />
          </li>
        ))}
        <li className="shrink-0">
          <Pildora href="/cliente/explorar" etiqueta="Todos" Icono={LayoutGrid} destacada />
        </li>
      </ul>
    </section>
  )
}
