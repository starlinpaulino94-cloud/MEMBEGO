import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { logout } from '@/modules/auth/actions'
import { vendedorDeUsuario } from '@/modules/excursiones/panel/queries'
import { VendedorTabs } from '@/components/excursiones/VendedorTabs'

/**
 * Panel del vendedor: su propia carcasa, deliberadamente mínima.
 *
 * No usa el AppShell del panel de la empresa porque este usuario es de FUERA
 * (hoteles, taxistas, promotores): no debe ver ni el menú de módulos ni las
 * secciones de la empresa. Aquí solo hay lo suyo.
 *
 * Doble puerta: el rol VENDEDOR es lo único que abre `/vendedor` en la
 * protección de rutas, y además tiene que existir un vendedor ACTIVO ligado a
 * esta cuenta. Si le quitaron el acceso o lo suspendieron, no entra.
 */
export default async function VendedorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  return (
    <div className="min-h-dvh bg-background flex flex-col w-full">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-card/95 backdrop-blur-md w-full">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-sm">
              {vendedor.nombre.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <Link href="/vendedor" className="block truncate text-sm font-bold text-foreground hover:text-primary transition-colors">
                {vendedor.nombre}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-mono font-semibold text-foreground/80">{vendedor.codigo}</span> · {vendedor.empresa}
              </p>
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-95 shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pb-1">
          <VendedorTabs />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-5 sm:py-7">{children}</main>
    </div>
  )
}
