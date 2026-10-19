import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { ChipVisita } from '@/components/visitas-membego/chips'
import { dineroVisita } from '@/components/visitas-membego/detalle-visita'
import { misVisitas } from '@/modules/visitas-membego/queries'
import { RUTA_VISITAS_CLIENTE } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis visitas · Membego' }

/**
 * SUPPLIER & FULFILLMENT COMMERCE · las visitas del cliente (§33): dónde usó
 * un beneficio de Membego, qué le incluyeron y qué compró además. Sin
 * comisiones ni nada interno del negocio.
 */
export default async function VisitasClientePage() {
  const user = await requireRole('CLIENTE')
  const visitas = await misVisitas(user.metadata.dbUserId)
  return (
    <div className="space-y-6">
      <PageHeader title="Mis visitas" description="Cada vez que usaste un beneficio de Membego en un negocio." />
      <Card>
        <CardContent className="pt-6">
          {visitas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-visitas">Cuando uses un beneficio de Membego, tu visita aparecerá aquí.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="mis-visitas">
              {visitas.map((v) => {
                const pendiente = v.status === 'CLOSED' && Number(v.ancillaryTotal) > 0 && !v.customerConfirmedAt && v.disputasAbiertas === 0
                return (
                  <li key={v.id} className="py-3" data-testid="visita-fila">
                    <Link href={`${RUTA_VISITAS_CLIENTE}/${v.id}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        <span className="font-mono text-caption text-muted-foreground">{formatDateTime(v.openedAt)} · {v.number}</span>
                        <span className="block font-medium">{v.empresa}{v.incluido ? ` · ${v.incluido}` : ''}</span>
                        <span className="block text-caption text-muted-foreground">
                          {Number(v.ancillaryTotal) > 0 ? `Compras adicionales: ${dineroVisita(v.ancillaryTotal, v.currency)}` : 'Sin compras adicionales'}
                          {pendiente ? ' · pendiente de tu confirmación' : v.customerConfirmedAt ? ' · confirmada' : ''}
                        </span>
                      </span>
                      <ChipVisita estado={v.status} />
                    </Link>
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
