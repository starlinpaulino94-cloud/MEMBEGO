import Link from 'next/link'
import {
  LayoutGrid,
  Store,
  WalletCards,
  Percent,
  CalendarDays,
  Ticket,
  ReceiptText,
  LifeBuoy,
  LogOut,
  Info,
  ChevronRight,
  ChevronDown,
  Crown,
  Gift,
  Dices,
  CarFront,
  Newspaper,
  Users,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { logout } from '@/modules/auth/actions'
import { getCategoriesPublic } from '@/modules/marketplace/cached'
import { getNavOcultoClienteCached } from '@/modules/cliente/navDisponible'
import { getClientePerfil } from '@/modules/cliente/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Menú' }

interface Fila {
  href: string
  label: string
  icon: LucideIcon
  seccion: string
}

/** Directorio completo de la app (contrato Stitch S03). */
const FILAS: Fila[] = [
  { href: '/cliente/planes', label: 'Planes y precios', icon: Crown, seccion: 'Ahorrar' },
  { href: '/mis-membresias', label: 'Membresías activas y disponibles', icon: WalletCards, seccion: 'Ahorrar' },
  { href: '/cliente/promociones', label: 'Catálogo de beneficios y descuentos', icon: Percent, seccion: 'Ahorrar' },
  { href: '/cliente/regalos', label: 'Regalos y gift cards', icon: Gift, seccion: 'Ahorrar' },
  { href: '/cliente/ruleta', label: 'Ruleta de premios', icon: Dices, seccion: 'Ahorrar' },
  { href: '/cliente/invita-y-gana', label: 'Invita y gana recompensas', icon: Users, seccion: 'Ahorrar' },
  { href: '/cliente/vehiculos', label: 'Mis vehículos', icon: CarFront, seccion: 'Mis cosas' },
  { href: '/cliente/citas', label: 'Mis citas y reservaciones', icon: CalendarDays, seccion: 'Mis cosas' },
  { href: '/cliente/mis-excursiones', label: 'Mis excursiones y boletos', icon: Ticket, seccion: 'Mis cosas' },
  { href: '/cliente/historial', label: 'Historial de visitas y canjes', icon: ReceiptText, seccion: 'Mis cosas' },
  { href: '/cliente/pagos', label: 'Mis pagos y facturación', icon: WalletCards, seccion: 'Mis cosas' },
  { href: '/cliente/empresas', label: 'Empresas y negocios cercanos', icon: Store, seccion: 'Descubrir' },
  { href: '/cliente/novedades', label: 'Novedades y avisos', icon: Newspaper, seccion: 'Descubrir' },
  { href: '/cliente/intereses', label: 'Elegir intereses', icon: SlidersHorizontal, seccion: 'Descubrir' },
  { href: '/cliente/ayuda', label: 'Servicio de atención al cliente y soporte', icon: LifeBuoy, seccion: 'Ayuda' },
]

export default async function MenuPage() {
  const user = await requireRole('CLIENTE')
  const [categorias, ocultas, perfil] = await Promise.all([
    getCategoriesPublic().catch(() => []),
    user.metadata.clienteId
      ? getNavOcultoClienteCached(user.metadata.clienteId, user.metadata.companyId).catch(
          () => [] as string[]
        )
      : Promise.resolve([] as string[]),
    user.metadata.clienteId
      ? getClientePerfil(user.metadata.clienteId).catch(() => null)
      : Promise.resolve(null),
  ])
  const oculto = new Set(ocultas)
  const filas = FILAS.filter((f) => !oculto.has(f.href))
  // Las ocultas ya salieron en el filtro: una sección vacía no se renderiza.
  const secciones: { titulo: string; filas: typeof filas }[] = []
  for (const f of filas) {
    const ultima = secciones[secciones.length - 1]
    if (ultima && ultima.titulo === f.seccion) ultima.filas.push(f)
    else secciones.push({ titulo: f.seccion, filas: [f] })
  }
  const nombre = perfil?.nombre?.split(' ')[0] || user.email

  return (
    <div className="space-y-3 animate-fade-up">
      <h1 className="px-1 text-[22px] font-bold tracking-tight text-foreground">
        Explora Membego
      </h1>

      <details className="group overflow-hidden rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LayoutGrid className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
            Explorar por categorías
          </span>
          <ChevronDown
            className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ul className="border-t border-border">
          {categorias.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">
              No hay categorías disponibles por ahora.
            </li>
          )}
          {categorias.map((c) => (
            <li key={c.id} className="border-b border-border last:border-0">
              <Link
                href={`/cliente/explorar?category=${encodeURIComponent(c.slug)}`}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-foreground outline-none transition hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                {c.name}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </details>

      {secciones.map((s) => (
        <section key={s.titulo} aria-label={s.titulo}>
          <h2 className="px-1 pb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {s.titulo}
          </h2>
          <ul className="space-y-2">
            {s.filas.map((f) => (
              <li key={f.href}>
                <Link
                  href={f.href}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 outline-none transition hover:border-primary/30 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <f.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
                    {f.label}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <form
        action={logout}
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <LogOut className="h-5 w-5" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          ¿No eres {nombre}? Cerrar sesión
        </p>
        <button
          type="submit"
          aria-label="Cerrar sesión"
                className="rounded-lg p-1 text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </form>

      <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-4 text-[13px] text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span>
          ¿Buscas la configuración de tu cuenta y datos personales? Vive en{' '}
          <Link
            href="/cliente/ajustes"
            className="font-semibold text-primary hover:underline"
          >
            Configuración
          </Link>
        </span>
      </p>
    </div>
  )
}
