'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { DESTINOS_CLIENTE, esDestinoActivo } from './destinos-cliente'

/**
 * Fila de pestañas del cliente en escritorio — los MISMOS cuatro destinos del
 * dock móvil, con el mismo vocabulario y el mismo orden.
 *
 * Marca dónde estás: sin `aria-current` ni indicador visible, las cuatro
 * pestañas se ven idénticas en cualquier pantalla y la barra deja de orientar
 * (y un lector de pantalla no puede anunciar la sección actual).
 */
export function TabsEscritorio() {
  const pathname = usePathname()

  return (
    <nav aria-label="Secciones" className="hidden border-b border-border bg-card lg:block">
      <ul className="mx-auto flex w-full max-w-7xl items-center gap-1 px-6">
        {DESTINOS_CLIENTE.map((t) => {
          const activo = esDestinoActivo(pathname, t)
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={activo ? 'page' : undefined}
                className={cn(
                  'block border-b-2 px-4 py-3 text-sm font-semibold outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-primary',
                  activo
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
