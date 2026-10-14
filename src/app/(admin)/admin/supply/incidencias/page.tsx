import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { FormIncidencia } from '@/components/supply-v2/portal/form-incidencia'
import { proveedorDeLaSesion, FUNCION_PORTAL } from '@/modules/supply-v2/permisos'
import { branchGateway } from '@/modules/supply-v2/contracts/adapters'
import { incidenciasDelProveedor, type VentanaDias } from '@/modules/supply-v2/redemption/queries'
import { INCIDENT_TYPE_LABELS, RUTA_PORTAL_INCIDENCIAS, RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Incidencias · Proveedor Membego' }

const VENTANAS: { dias: VentanaDias; label: string }[] = [
  { dias: 0, label: 'Hoy' },
  { dias: 7, label: '7 días' },
  { dias: 30, label: '30 días' },
]

/** SUPPLIER & FULFILLMENT COMMERCE · Incidencias del proveedor (§6). */
export default async function IncidenciasProveedorPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const sp = await searchParams
  const dias = (([0, 7, 30] as VentanaDias[]).find((d) => String(d) === sp.dias) ?? 7) as VentanaDias
  const puedeRegistrar = (await proveedorDeLaSesion(FUNCION_PORTAL.escanear)) !== null
  const [incidencias, sucursales] = await Promise.all([incidenciasDelProveedor(proveedor.supplierId, dias), puedeRegistrar ? branchGateway.listForCompany(proveedor.companyId) : Promise.resolve([])])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Incidencias"
        description="Lo que salió mal al entregar. Membego las revisa; no afectan tu liquidación por sí solas."
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Proveedor Membego</Link>}
      />
      {puedeRegistrar && (
        <Card>
          <CardHeader><CardTitle>Nueva incidencia</CardTitle></CardHeader>
          <CardContent><FormIncidencia sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.name }))} /></CardContent>
        </Card>
      )}
      <nav className="flex gap-1 text-sm" aria-label="Periodo">
        {VENTANAS.map((v) => (
          <Link key={v.dias} href={`${RUTA_PORTAL_INCIDENCIAS}?dias=${v.dias}`} className={`rounded-full px-3 py-1 ${v.dias === dias ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`} aria-current={v.dias === dias ? 'page' : undefined}>
            {v.label}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="pt-6">
          {incidencias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin incidencias en este periodo.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="incidencias">
              {incidencias.map((i) => (
                <li key={i.id} className="py-3">
                  <span className="font-mono text-caption text-muted-foreground">{formatDateTime(i.createdAt)}</span>
                  <span className="block font-medium">{INCIDENT_TYPE_LABELS[i.type as keyof typeof INCIDENT_TYPE_LABELS] ?? i.type}</span>
                  <span className="block text-caption text-muted-foreground">
                    {i.empleado}
                    {i.sucursal ? ` · ${i.sucursal}` : ''}
                    {i.notes ? ` · ${i.notes}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
