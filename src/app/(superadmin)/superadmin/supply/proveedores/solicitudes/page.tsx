import Link from 'next/link'
import type { SupplyV2MerchantApplicationStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { RevisarSolicitud } from '@/components/supply-v2/proveedores/revisar-solicitud'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { solicitudesMerchantEnTx } from '@/modules/supply-v2/suppliers/solicitud-merchant'
import { MERCHANT_APPLICATION_LABELS } from '@/modules/supply-v2/suppliers/solicitud-merchant-dominio'
import { BASE_SUPPLY_V2, RUTA_SOLICITUDES_MERCHANT } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Solicitudes de empresa · Supply' }

const ESTADOS: readonly SupplyV2MerchantApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'REJECTED', 'WITHDRAWN']
const TONO: Record<SupplyV2MerchantApplicationStatus, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = { SUBMITTED: 'info', UNDER_REVIEW: 'info', MORE_INFO_REQUIRED: 'warning', APPROVED: 'success', REJECTED: 'danger', WITHDRAWN: 'neutral' }

/**
 * SUPPLIER & FULFILLMENT COMMERCE · solicitudes Supplier → Merchant (§41):
 * la cola de Membego. Cada aprobación enciende comercio en la MISMA empresa.
 */
export default async function SolicitudesMerchantPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const estado = ESTADOS.find((e) => e === sp.estado)
  const [solicitudes, puedeRevisar] = await Promise.all([
    sinEmpresa('Supply: cola de solicitudes de empresa Membego', (tx) => solicitudesMerchantEnTx(tx, estado ? { estado } : { soloVivas: true })),
    puedeSupplyV2('SUPPLY_V2_SUPPLIER_MANAGE'),
  ])
  const chip = (activo: boolean) => `rounded-full px-3 py-1 ${activo ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitudes para ser empresa Membego"
        description="Proveedores que piden operar también como empresa Membego. Aprobar enciende catálogo, pedidos y ofertas en su misma organización."
        eyebrow={<Link href={`${BASE_SUPPLY_V2}/proveedores`} className="hover:underline">Proveedores</Link>}
        nav={<NavSupplyV2 activa="proveedores" />}
      />
      <nav className="flex flex-wrap gap-1 text-sm" aria-label="Estado">
        <Link href={RUTA_SOLICITUDES_MERCHANT} className={chip(!estado)}>Pendientes</Link>
        {ESTADOS.map((e) => (
          <Link key={e} href={`${RUTA_SOLICITUDES_MERCHANT}?estado=${e}`} className={chip(estado === e)}>{MERCHANT_APPLICATION_LABELS[e]}</Link>
        ))}
      </nav>
      <Card>
        <CardContent className="pt-6">
          {solicitudes.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-solicitudes">Sin solicitudes {estado ? 'con ese estado' : 'pendientes'}.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="solicitudes">
              {solicitudes.map((s) => (
                <li key={s.id} className="space-y-3 py-4" data-testid="solicitud" data-solicitud-estado={s.status}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        <Link href={`${BASE_SUPPLY_V2}/proveedores/${s.supplierId}`} className="hover:underline">{s.proveedor}</Link>
                        <span className="text-muted-foreground"> · {s.empresa}</span>
                      </p>
                      <p className="text-caption text-muted-foreground">
                        Enviada {formatDateTime(s.submittedAt)} por {s.enviadaPor}
                        {s.revisadaPor ? ` · revisa ${s.revisadaPor}` : ''}
                        {s.reviewedAt ? ` · ${formatDateTime(s.reviewedAt)}` : ''}
                      </p>
                    </div>
                    <StatusChip tone={TONO[s.status]} data-testid="chip-solicitud">{MERCHANT_APPLICATION_LABELS[s.status]}</StatusChip>
                  </div>
                  <dl className="grid gap-1 sm:grid-cols-2">
                    <Dato label="Nombre comercial">{s.datos.nombreComercial}</Dato>
                    <Dato label="Tipo">{s.datos.tipoNegocio}</Dato>
                    <Dato label="Teléfono">{s.datos.telefono}</Dato>
                    <Dato label="RNC">{s.datos.rnc || '—'}</Dato>
                    <Dato label="Dirección">{s.datos.direccion}{s.datos.ciudad ? `, ${s.datos.ciudad}` : ''}</Dato>
                    <Dato label="Sucursales">{s.datos.sucursales.map((x) => x.nombre).join(', ') || '—'}</Dato>
                  </dl>
                  <p><span className="text-muted-foreground">Qué es:</span> {s.datos.descripcion}</p>
                  <p><span className="text-muted-foreground">Qué quiere vender:</span> {s.datos.queVende}</p>
                  {s.datos.notas && <p><span className="text-muted-foreground">Notas del proveedor:</span> {s.datos.notas}</p>}
                  {s.moreInfoRequest && <p className="text-caption"><span className="text-muted-foreground">Pedimos:</span> {s.moreInfoRequest}{s.moreInfoResponse ? ` · respondió: ${s.moreInfoResponse}` : ''}</p>}
                  {s.decisionReason && <p className="text-caption"><span className="text-muted-foreground">Decisión:</span> {s.decisionReason}</p>}
                  {s.internalNotes && <p className="text-caption"><span className="text-muted-foreground">Notas internas:</span> {s.internalNotes}</p>}
                  {s.capabilitiesGranted && <p className="text-caption text-success" data-testid="capacidades-encendidas">Encendidas: {s.capabilitiesGranted.join(', ')}</p>}
                  {puedeRevisar && (s.status === 'SUBMITTED' || s.status === 'UNDER_REVIEW' || s.status === 'MORE_INFO_REQUIRED') && (
                    <RevisarSolicitud applicationId={s.id} supplierId={s.supplierId} estado={s.status} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}:</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
