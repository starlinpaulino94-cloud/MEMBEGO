import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { roleLabel } from '@/components/layout/nav-config'
import { InvitarPersonal } from '@/components/supply-v2/portal/invitar-personal'
import { proveedorDeLaSesion, FUNCION_PORTAL } from '@/modules/supply-v2/permisos'
import { equipoDelProveedor } from '@/modules/supply-v2/portal/queries'
import { PRESETS_ROL_PROVEEDOR } from '@/modules/supply-v2/suppliers/acceso-dominio'
import { RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Personal · Proveedor Membego' }

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Personal del proveedor (§7): quién
 * escanea, quién ve las cuentas, quién solo mira; invitar con un preset. Los
 * permisos finos se editan en Empleados (módulo de Permisos existente).
 */
export default async function PersonalProveedorPage() {
  const proveedor = await proveedorDeLaSesion(FUNCION_PORTAL.personal)
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const { miembros, invitaciones } = await equipoDelProveedor(proveedor.companyId)
  const esDueno = ['ADMINISTRADOR', 'ADMIN_EMPRESA', 'SUPERADMIN'].includes(proveedor.user.metadata.role)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Personal"
        description="Quién puede escanear, registrar extras, ver liquidaciones o solo mirar."
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Proveedor Membego</Link>}
      />

      <Card>
        <CardHeader><CardTitle>Invitar</CardTitle></CardHeader>
        <CardContent><InvitarPersonal esDueno={esDueno} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Equipo</CardTitle></CardHeader>
        <CardContent>
          {miembros.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía nadie.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="equipo-proveedor">
              {miembros.map((m) => (
                <li key={m.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="miembro">
                  <div>
                    <span className="block font-medium">{m.name?.trim() || m.email}</span>
                    <span className="block text-caption text-muted-foreground">{m.email} · desde {formatDate(m.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-caption">
                    <span className="rounded-full bg-muted px-2 py-0.5" data-testid="miembro-rol">{m.rol ? PRESETS_ROL_PROVEEDOR[m.rol].label : `${roleLabel(m.appRole)} (a medida)`}</span>
                    {m.puedeEscanear && <span className="text-muted-foreground">escanea</span>}
                    {m.puedeVerLiquidaciones && <span className="text-muted-foreground">ve liquidaciones</span>}
                    <Link href={`/admin/empleados/${m.id}/permisos`} className="underline-offset-4 hover:underline">Permisos</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {invitaciones.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Invitaciones pendientes</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" data-testid="invitaciones-proveedor">
              {invitaciones.map((i) => (
                <li key={i.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{i.email}</span>
                  <span className="text-caption text-muted-foreground">
                    {i.rol ? PRESETS_ROL_PROVEEDOR[i.rol].label : roleLabel(i.appRole)} · vence {formatDate(i.expiraEn)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
