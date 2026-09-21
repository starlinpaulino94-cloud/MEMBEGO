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
 *
 * «Mi QR» lleva la misma cara elevada que en el dock (gradiente de marca +
 * glow): es la misma navegación en dos formatos y la acción nº 1 se reconoce
 * en ambos. Mismo `href`, misma etiqueta.
 */

/** El destino elevado: mismo `href` y misma etiqueta, solo otra cara. */
const HREF_QR = '/cliente/qr'

export function TabsEscritorio() {
  const pathname = usePathname()

  return (
    <nav aria-label="Secciones" className="hidden border-b border-border bg-card lg:block">
      <ul className="mx-auto flex w-full max-w-7xl items-center gap-1 px-6">
        {DESTINOS_CLIENTE.map((t) => {
          const activo = esDestinoActivo(pathname, t)
          const esQR = t.href === HREF_QR
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={activo ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center px-4 text-sm font-semibold outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-primary',
                  esQR
                    ? cn(
                        'grad-vibe-cta shadow-glow my-1 rounded-full py-2 text-white hover:brightness-110 active:scale-[0.98]',
                        activo && 'ring-2 ring-primary'
                      )
                    : cn(
                        'border-b-2 py-3',
                        activo
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      )
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
