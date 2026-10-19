import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate } from '@/lib/format'
import { FormSolicitudMerchant, RetirarSolicitud } from '@/components/supply-v2/portal/form-solicitud-merchant'
import { FUNCION_PORTAL, proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { solicitudMerchantDelProveedor } from '@/modules/supply-v2/portal/queries'
import { MERCHANT_APPLICATION_LABELS } from '@/modules/supply-v2/suppliers/solicitud-merchant-dominio'
import { RUTA_PORTAL_PROVEEDOR } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ser empresa Membego · Proveedor' }

/**
 * SUPPLIER & FULFILLMENT COMMERCE · «Convertirme en empresa Membego» (§39–§41).
 * Verlo puede cualquiera del portal; enviar o retirar exige `solicitud_merchant`.
 */
export default async function SolicitudMerchantPage() {
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) redirect(RUTA_PORTAL_PROVEEDOR)
  const puedeSolicitar = (await proveedorDeLaSesion(FUNCION_PORTAL.solicitud_merchant)) !== null
  const { solicitud, prellenado, yaMerchant } = await solicitudMerchantDelProveedor(proveedor.supplierId)
  const viva = solicitud && (solicitud.status === 'SUBMITTED' || solicitud.status === 'UNDER_REVIEW' || solicitud.status === 'MORE_INFO_REQUIRED')
  const tono = solicitud?.status === 'APPROVED' ? 'success' : solicitud?.status === 'REJECTED' ? 'danger' : solicitud?.status === 'MORE_INFO_REQUIRED' ? 'warning' : 'info'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Ser empresa Membego"
        description="Opera también como empresa Membego: catálogo, pedidos y ofertas, en tu misma organización y con lo que ya haces como proveedor intacto."
        eyebrow={<Link href={RUTA_PORTAL_PROVEEDOR} className="hover:underline">Proveedor Membego</Link>}
      />

      {yaMerchant ? (
        <Card data-testid="ya-merchant">
          <CardContent className="space-y-3 pt-6 text-sm">
            <p className="text-h4">Tu empresa ya opera como empresa Membego.</p>
            <p className="text-muted-foreground">Tu panel tiene catálogo, pedidos y ofertas. Completa tu perfil para publicar tu vitrina en el marketplace; tus ofertas de Membego siguen igual.</p>
            <Button asChild><Link href="/admin/perfil" data-testid="link-onboarding">Completar mi perfil</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {solicitud && (
            <Card data-testid="estado-solicitud">
              <CardContent className="space-y-2 pt-6 text-sm">
                <p className="flex items-center justify-between gap-2">
                  <span>Tu solicitud del {formatDate(solicitud.submittedAt)}</span>
                  <StatusChip tone={tono} data-testid="chip-solicitud">{MERCHANT_APPLICATION_LABELS[solicitud.status]}</StatusChip>
                </p>
                {solicitud.status === 'MORE_INFO_REQUIRED' && solicitud.moreInfoRequest && <p className="text-muted-foreground">Membego pide: {solicitud.moreInfoRequest}</p>}
                {solicitud.status === 'REJECTED' && solicitud.decisionReason && <p className="text-muted-foreground" data-testid="motivo-rechazo">Motivo: {solicitud.decisionReason}</p>}
                {viva && solicitud.status !== 'MORE_INFO_REQUIRED' && <p className="text-muted-foreground">Membego la está revisando. Te avisaremos aquí y por notificación.</p>}
                {viva && puedeSolicitar && <RetirarSolicitud applicationId={solicitud.id} />}
              </CardContent>
            </Card>
          )}
          {puedeSolicitar && (!viva || solicitud?.status === 'MORE_INFO_REQUIRED') && (
            <FormSolicitudMerchant
              prellenado={solicitud?.status === 'MORE_INFO_REQUIRED' ? solicitud.datos : prellenado}
              solicitudId={solicitud?.status === 'MORE_INFO_REQUIRED' ? solicitud.id : null}
              respondiendoA={solicitud?.status === 'MORE_INFO_REQUIRED' ? solicitud.moreInfoRequest : null}
            />
          )}
          {!puedeSolicitar && <p className="text-caption text-muted-foreground">Solo quien administra el portal puede enviar esta solicitud.</p>}
        </>
      )}
    </div>
  )
}
