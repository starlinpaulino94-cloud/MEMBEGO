'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  User,
  QrCode,
  Menu,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DESTINOS_CLIENTE, esDestinoActivo } from './destinos-cliente'

/**
 * MOB · Navegación inferior del cliente — 4 destinos fijos (contrato Stitch).
 *
 * La lista y la regla de «cuál está activo» viven en `destinos-cliente`, junto
 * con las pestañas de escritorio: son la misma navegación en dos formatos y no
 * pueden separarse. Aquí solo se le pone cara.
 *
 * «Mi QR» es la acción central elevada (`docs/MOBILE_FIRST.md:14-29`):
 * mostrar el código en el local es la acción nº 1, así que su icono vive en
 * un botón circular con el gradiente de marca (`grad-vibe-cta`), glow y ring,
 * más alto que el resto. Los otros tres destinos no cambian.
 *
 * El alto sale de `--dock-inferior`, la MISMA variable con la que el shell
 * calcula el hueco que le reserva al contenido (ver `globals.css`).
 */
const ICONOS: Record<string, LucideIcon> = {
  '/cliente/inicio': Home,
  '/cliente/perfil': User,
  '/cliente/qr': QrCode,
  '/cliente/menu': Menu,
}

/** El destino elevado: mismo `href` y misma etiqueta, solo otra cara. */
const HREF_QR = '/cliente/qr'

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul
        className="mx-auto flex max-w-md items-stretch justify-around md:max-w-3xl"
        style={{ minHeight: 'var(--dock-inferior)' }}
      >
        {DESTINOS_CLIENTE.map((d) => {
          const activo = esDestinoActivo(pathname, d)
          const Icon = ICONOS[d.href] ?? Home
          if (d.href === HREF_QR) {
            return (
              <li key={d.href} className="flex-1">
                <Link
                  href={d.href}
                  prefetch={false}
                  aria-current={activo ? 'page' : undefined}
                  className={cn(
                    'flex min-h-20 flex-col items-center justify-center gap-1 px-1 pb-1.5 pt-2 text-[12px] font-medium transition-colors duration-fast active:scale-[0.96]',
                    activo ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="grad-vibe-cta shadow-glow relative z-10 flex h-12 w-12 -translate-y-1 items-center justify-center rounded-full text-white ring-4 ring-card transition-transform duration-base">
                    <Icon className="h-6 w-6" strokeWidth={activo ? 2.4 : 2} />
                  </span>
                  <span className={cn('-mt-1 truncate transition-opacity', activo ? 'font-semibold' : 'opacity-90')}>
                    {d.label}
                  </span>
                </Link>
              </li>
            )
          }
          return (
            <li key={d.href} className="flex-1 self-center">
              <Link
                href={d.href}
                prefetch={false}
                aria-current={activo ? 'page' : undefined}
                className={cn(
                  'group flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[12px] font-medium transition-colors duration-fast active:scale-[0.96]',
                  activo ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-all duration-base',
                    activo && 'bg-primary/12'
                  )}
                >
                  <Icon
                    className={cn('h-5 w-5 transition-transform duration-base', activo && 'scale-110')}
                    strokeWidth={activo ? 2.4 : 2}
                  />
                </span>
                <span className={cn('truncate transition-opacity', activo ? 'font-semibold' : 'opacity-90')}>
                  {d.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
