import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { StatusChip } from '@/components/ui/status-chip'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { relevarProveedoresEnTx } from '@/modules/supply-v2/suppliers/acceso'
import { ACCESS_STATUS_LABELS, type ClaseDeProveedor } from '@/modules/supply-v2/suppliers/acceso-dominio'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Relevamiento de proveedores · Supply' }

const CLASES: { clase: ClaseDeProveedor; label: string; tono: 'success' | 'warning' | 'neutral' | 'danger'; ayuda: string }[] = [
  { clase: 'ACTIVE_WITH_ACCESS', label: 'Activos con acceso', tono: 'success', ayuda: 'Operan desde su portal.' },
  { clase: 'ACTIVE_WITHOUT_ACCESS', label: 'Activos sin acceso', tono: 'warning', ayuda: 'Membego les compra, pero nadie entra al portal: invítalos.' },
  { clase: 'LEGACY', label: 'Heredados', tono: 'neutral', ayuda: 'Operan con dispensa de preparación (anteriores a esta fase).' },
  { clase: 'INACTIVE', label: 'Inactivos', tono: 'danger', ayuda: 'Sin actividad ni acceso.' },
]

/**
 * SUPPLIER & FULFILLMENT COMMERCE · relevamiento (§60–§62): cómo quedan los
 * proveedores que existían antes de esta fase, y a quién falta invitar.
 * Nada se migra solo: cada invitación es una decisión de Membego.
 */
export default async function RelevamientoPage({ searchParams }: { searchParams: Promise<{ clase?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const clase = CLASES.find((c) => c.clase === sp.clase)?.clase
  const todos = await sinEmpresa('Supply: relevamiento de proveedores', (tx) => relevarProveedoresEnTx(tx))
  const filas = clase ? todos.filter((p) => p.clase === clase) : todos
  const cuenta = (c: ClaseDeProveedor) => todos.filter((p) => p.clase === c).length
  const ruta = `${BASE_SUPPLY_V2}/proveedores/relevamiento`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relevamiento de acceso"
        description="Cómo quedó cada proveedor con el acceso operativo: quién ya opera desde su portal, a quién falta invitar y quién sigue heredado con dispensa."
        eyebrow={<Link href={`${BASE_SUPPLY_V2}/proveedores`} className="hover:underline">Proveedores</Link>}
        nav={<NavSupplyV2 activa="proveedores" />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="relevamiento-resumen">
        {CLASES.map((c) => (
          <StatCard key={c.clase} label={c.label} value={cuenta(c.clase)} sub={c.ayuda} href={`${ruta}?clase=${c.clase}`} hrefLabel={`Ver ${c.label.toLowerCase()}`} />
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          {filas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="relevamiento-vacio">Sin proveedores en esta clase.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="relevamiento">
              {filas.map((p) => {
                const c = CLASES.find((x) => x.clase === p.clase)!
                return (
                  <li key={p.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="relevamiento-fila" data-clase={p.clase}>
                    <span>
                      <Link href={`${BASE_SUPPLY_V2}/proveedores/${p.id}`} className="font-medium hover:underline">{p.commercialName}</Link>
                      <span className="block text-caption text-muted-foreground">
                        {p.companyId ? 'Con empresa en Membego' : 'Proveedor externo (sin empresa)'} · acceso {ACCESS_STATUS_LABELS[p.accessStatus]} · {p.acuerdosActivos} acuerdo(s) · {p.lotesActivos} lote(s)
                        {p.invitedEmail ? ` · invitado: ${p.invitedEmail}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusChip tone={c.tono}>{c.label}</StatusChip>
                      {p.clase === 'ACTIVE_WITHOUT_ACCESS' && (
                        <Link href={`${BASE_SUPPLY_V2}/proveedores/${p.id}#acceso`} className="text-sm underline-offset-4 hover:underline" data-testid="link-invitar">Invitar</Link>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
