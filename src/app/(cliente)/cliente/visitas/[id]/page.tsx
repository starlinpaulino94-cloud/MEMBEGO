import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { DetalleVisita, dineroVisita } from '@/components/visitas-membego/detalle-visita'
import { ConfirmarVisita } from '@/components/cliente/confirmar-visita'
import { miVisita } from '@/modules/visitas-membego/queries'
import { RUTA_VISITAS_CLIENTE } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tu visita · Membego' }

/**
 * SUPPLIER & FULFILLMENT COMMERCE · «Tu visita fue completada. ¿Es correcto?»
 * (§33–§34). Solo las visitas del propio cliente (la consulta filtra por su
 * id, nunca por el de la URL sola). Confirmar sube la evidencia a
 * CUSTOMER_CONFIRMED; nunca a pago verificado. Reportar abre una disputa.
 */
export default async function VisitaClientePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('CLIENTE')
  const { id } = await params
  const visita = await miVisita(user.metadata.dbUserId, id)
  if (!visita) notFound()
  const conExtras = Number(visita.ancillaryTotal) > 0
  const disputaAbierta = visita.disputas.some((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW')
  const puedeConfirmar = visita.status === 'CLOSED' && conExtras

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={visita.status === 'OPEN' ? 'Tu visita está en curso' : 'Tu visita fue completada'}
        description={`${visita.empresa}${visita.sucursal ? ` · ${visita.sucursal}` : ''}`}
        eyebrow={<Link href={RUTA_VISITAS_CLIENTE} className="hover:underline">Mis visitas</Link>}
      />
      {puedeConfirmar && (
        <Card>
          <CardContent className="pt-6">
            <ConfirmarVisita
              visitId={visita.id}
              total={visita.ancillaryTotal}
              totalFormateado={dineroVisita(visita.ancillaryTotal, visita.currency)}
              yaConfirmada={visita.customerConfirmedAt !== null}
              disputaAbierta={disputaAbierta}
            />
          </CardContent>
        </Card>
      )}
      {visita.status === 'CLOSED' && !conExtras && (
        <p className="rounded-lg bg-success/10 p-3 text-sm text-success" data-testid="visita-sin-extras">Tu beneficio fue entregado. No hay compras adicionales que confirmar.</p>
      )}
      <DetalleVisita visita={visita} conComision={false} mostrarEmpresa />
    </div>
  )
}
