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
  X,
  type LucideIcon,
} from 'lucide-react'
import type { InicioVista } from '@/modules/home/vista'
import { RailOverflowHint } from '@/components/ui/RailOverflowHint'
import { cn } from '@/lib/utils'
import { colorDeCategoria } from '@/modules/home/categorias-color'
import { RetailEmptyState } from './RetailEmptyState'

/**
 * Chips de categoría del rediseño violeta: «Todos» abre la fila en violeta
 * sólido (el único activo honesto en el Inicio: lleva al catálogo completo)
 * y cada categoría real va en píldora con SU color de la gama —tinte de
 * fondo, borde e icono—.
 *
 * SU color, y no el que le toque: el reparto vive en `categorias-color.ts` y
 * sale del slug, no de la posición en la lista. Antes ciclaba por índice, así
 * que «Lavados» cambiaba de color el día que se añadiera una categoría antes.
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

const CLASE_BOTON = 'flex items-center rounded-full px-4 py-2 text-sm font-bold text-white shadow-sm outline-none transition-[box-shadow,transform,border-color] duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-95'

/**
 * El violeta de la marca, solo para «Todos».
 *
 * Los degradados viven como clases de `globals.css` —no con la paleta de
 * Tailwind, que no cambia con el tema— y está explicado junto a
 * `grad-vibe-header`. Los de las categorías están en `COLORES_CATEGORIA`, y
 * este NO entra ahí: es el héroe, los botones y los sellos.
 */
const COLOR_TODOS = 'grad-vibe'

export function VibeCategorias({
  categorias,
  categoriaActiva,
}: {
  categorias: InicioVista['categorias']
  categoriaActiva?: string | null
}) {
  if (categorias.length === 0) {
    return (
      <RetailEmptyState
        title="Categorías"
        description="No hay categorías disponibles para explorar ahora."
      />
    )
  }

  const hayFiltro = Boolean(categoriaActiva)
  const categoriaSeleccionada = categorias.find((c) => c.slug === categoriaActiva)

  return (
    <section className="mt-4" aria-label="Categorías">
      <RailOverflowHint className="from-vibe-fondo via-vibe-fondo/90 to-transparent text-vibe-violet">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-1 pr-12">
          <Link
            href="/cliente/inicio"
            scroll={false}
            aria-current={!hayFiltro ? 'page' : undefined}
            className={cn(
              CLASE_BOTON,
              COLOR_TODOS,
              !hayFiltro
                ? 'px-2 py-2 shadow-md'
                : 'opacity-75 hover:opacity-100'
            )}
          >
            <div className={`flex gap-2 items-center ${!hayFiltro ? 'border-white border-3 rounded-full py-1 px-2' : ''}`}>
              <LayoutGrid className="size-4" aria-hidden />
              Todos
            </div>
          </Link>
          {categorias.map((c) => {
            const Icono = ICONOS[c.slug.toLowerCase()] ?? LayoutGrid
            const esActiva = categoriaActiva === c.slug
            const href = esActiva
              ? '/cliente/inicio'
              : `/cliente/inicio?categoria=${encodeURIComponent(c.slug)}`

            return (
              <Link
                key={c.id}
                href={href}
                scroll={false}
                aria-current={esActiva ? 'page' : undefined}
                className={cn(
                  CLASE_BOTON,
                  colorDeCategoria(c.slug),
                  esActiva
                    ? 'shadow-md px-2 py-2'
                    : hayFiltro
                      ? 'opacity-70 hover:opacity-100'
                      : ''
                )}
              >
                <div className={`flex gap-2 items-center ${esActiva ? 'border-white border-3 rounded-full py-1 px-2' : ''}`}>
                  <Icono className="size-4" aria-hidden />
                  <span className="text-label-sm font-bold text-white">{c.name}</span>
                </div>
              </Link>
            )
          })}
        </div>
      </RailOverflowHint>

      {hayFiltro && (
        <div className="mt-2.5 flex items-center justify-between px-4 text-small text-muted-foreground">
          <p className="truncate">
            Filtrando por:{' '}
            <span className="font-bold text-foreground">
              {categoriaSeleccionada?.name ?? categoriaActiva}
            </span>
          </p>
          <Link
            href="/cliente/inicio"
            scroll={false}
            className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-label-sm font-bold text-vibe-violet hover:bg-vibe-niebla"
          >
            <X className="size-3.5" aria-hidden />
            <span>Mostrar todas</span>
          </Link>
        </div>
      )}
    </section>
  )
}
