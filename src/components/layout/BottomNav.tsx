'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  QrCode,
  Megaphone,
  Ticket,
  WalletCards,
  User,
  Compass,
  CalendarDays,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface BottomNavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Prefijos extra que también marcan este ítem como activo. */
  match?: string[]
}

/**
 * MOB · Navegación inferior del cliente — 4 destinos + dock central "Mi QR".
 *
 * El QR es LA acción de la app (se muestra en el local para usar beneficios),
 * así que vive elevado en el centro de la barra: siempre en la zona natural
 * del pulgar y sin tapar contenido (reemplaza al antiguo FAB flotante).
 *
 * Los dos destinos flexibles (uno a cada lado del QR) se eligen de una lista
 * de prioridad, saltando los módulos sin contenido (`hiddenNav`). Inicio y
 * Perfil son fijos; "Mis membresías" cierra la lista como fallback siempre
 * disponible, así la barra nunca queda incompleta.
 */
const INICIO: BottomNavItem = {
  href: '/cliente/inicio',
  label: 'Inicio',
  icon: Home,
  match: ['/cliente/inicio'],
}
const PERFIL: BottomNavItem = {
  href: '/cliente/perfil',
  label: 'Perfil',
  icon: User,
  match: ['/cliente/pagos', '/cliente/historial', '/cliente/ayuda'],
}
/** Candidatos para los 2 slots flexibles, en orden de prioridad. */
const FLEX_CANDIDATOS: BottomNavItem[] = [
  { href: '/cliente/mis-excursiones', label: 'Actividades', icon: CalendarDays, match: ['/cliente/excursiones'] },
  { href: '/mis-membresias', label: 'Membresías', icon: WalletCards },
  { href: '/cliente/cerca', label: 'Cerca', icon: Compass },
  { href: '/cliente/promociones', label: 'Ofertas', icon: Megaphone },
  { href: '/cliente/mis-promociones', label: 'Beneficios', icon: Ticket },
  // Fallbacks siempre disponibles (garantizan 2 slots llenos).
  { href: '/cliente/historial', label: 'Historial', icon: WalletCards },
]

function isActive(pathname: string, item: BottomNavItem) {
  if (pathname === item.href || pathname.startsWith(item.href + '/')) return true
  return (item.match ?? []).some((m) => pathname === m || pathname.startsWith(m + '/'))
}

function TabLink({ item, pathname }: { item: BottomNavItem; pathname: string }) {
  const active = isActive(pathname, item)
  const Icon = item.icon
  return (
    <li className="flex-1">
      <Link
        href={item.href}
        prefetch={false}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[12px] font-medium transition-colors duration-150 active:scale-[0.96]',
          active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <span
          className={cn(
            'flex h-7 w-12 items-center justify-center rounded-full transition-all duration-200',
            active && 'bg-primary/12'
          )}
        >
          <Icon
            className={cn('h-5 w-5 transition-transform duration-200', active && 'scale-110')}
            strokeWidth={active ? 2.4 : 2}
          />
        </span>
        <span className={cn('truncate transition-opacity', active ? 'font-semibold' : 'opacity-90')}>
          {item.label}
        </span>
      </Link>
    </li>
  )
}

/**
 * Barra inferior fija, solo en móvil (oculta en lg+). Cuatro destinos + el
 * dock central del QR. `qrHref` apunta al QR de la membresía activa; sin
 * membresía lleva a la wallet para activar una.
 */
export function BottomNav({
  role,
  qrHref,
  hiddenNav,
}: {
  role: string
  qrHref?: string | null
  hiddenNav?: string[]
}) {
  const pathname = usePathname()
  if (role !== 'CLIENTE') return null

  const oculto = new Set(hiddenNav ?? [])
  // Dos destinos flexibles: primeros dos candidatos con contenido.
  const flex = FLEX_CANDIDATOS.filter((c) => !oculto.has(c.href)).slice(0, 2)
  const izquierda = [INICIO, flex[0]].filter(Boolean) as BottomNavItem[]
  const derecha = [flex[1], PERFIL].filter(Boolean) as BottomNavItem[]

  const qrDestino = qrHref ?? '/mis-membresias'
  const qrActivo = pathname.startsWith('/membresia') || pathname.startsWith('/mis-membresias')

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* El alto sale de `--dock-inferior`, la MISMA variable con la que el
          shell calcula el hueco que le reserva al contenido. Escritos por
          separado ya se separaron una vez: la barra creció con el área segura
          del móvil, el hueco siguió siendo `pb-24` y el botón principal de la
          pantalla quedó debajo de la barra. */}
      <ul
        className="mx-auto flex max-w-md items-stretch justify-around"
        style={{ minHeight: 'var(--dock-inferior)' }}
      >
        {izquierda.map((item) => (
          <TabLink key={item.href} item={item} pathname={pathname} />
        ))}

        {/* Dock central: Mi QR — elevado, con gradiente y glow de marca */}
        <li className="relative flex-1">
          <Link
            href={qrDestino}
            prefetch={false}
            aria-label="Mi código QR"
            aria-current={qrActivo ? 'page' : undefined}
            className="group flex min-h-14 flex-col items-center justify-end gap-0.5 pb-1.5 text-[12px] font-semibold"
          >
            <span
              className={cn(
                'absolute -top-5 flex size-14 items-center justify-center rounded-full bg-gradient-brand text-white ring-4 ring-background transition-all duration-200 group-active:scale-95',
                qrActivo ? 'shadow-glow-strong' : 'shadow-glow group-hover:shadow-glow-strong'
              )}
            >
              <QrCode className="h-6 w-6" aria-hidden />
            </span>
            <span className={cn('mt-8', qrActivo ? 'text-primary' : 'text-muted-foreground')}>
              Mi QR
            </span>
          </Link>
        </li>

        {derecha.map((item) => (
          <TabLink key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  )
}
