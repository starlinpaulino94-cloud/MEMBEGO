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
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <Link href="/vendedor" className="block truncate font-semibold text-foreground">
              {vendedor.nombre}
            </Link>
            <p className="truncate text-caption text-muted-foreground">
              <span className="font-mono">{vendedor.codigo}</span> · {vendedor.empresa}
            </p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </form>
        </div>
        <div className="mx-auto max-w-2xl px-4 pb-2">
          <VendedorTabs />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5">{children}</main>
    </div>
  )
}
