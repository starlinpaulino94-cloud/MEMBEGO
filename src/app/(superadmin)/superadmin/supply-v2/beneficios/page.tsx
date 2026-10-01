import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipBeneficio, ChipFinanciacion } from '@/components/supply-v2/chips'
import { listarBeneficios } from '@/modules/supply-v2/benefits/queries'
import { BENEFIT_SCOPE_LABELS, BENEFIT_VALUE_TYPE_LABELS, dineroSupplyV2, RUTA_BENEFICIOS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Beneficios · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 6 · listado de BENEFICIOS (§29).
 *
 * Una fila por beneficio con lo que de verdad importa para decidir: quién lo
 * financia, cuánto rebaja, a qué aplica, qué queda del presupuesto y cuánto
 * se ha usado. El presupuesto se enseña siempre en tres cifras distintas
 * (reservado, consumido, disponible): mezclarlas es el error que hace que una
 * campaña se pase de dinero sin que nadie lo vea.
 */
export default async function BeneficiosSupplyV2Page() {
  await requireRole('SUPERADMIN')
  const beneficios = await listarBeneficios()
  const activos = beneficios.filter((b) => b.status === 'ACTIVE').length
  const borradores = beneficios.filter((b) => b.status === 'DRAFT').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficios"
        description="Bonos que financia Membego y descuentos que asume el proveedor. Rebajan lo que paga el cliente sin tocar el precio público ni el importe contractual de la venta."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="beneficios" />}
        action={
          <Button asChild>
            <Link href={`${RUTA_BENEFICIOS}/nuevo`} data-testid="btn-crear-beneficio-nav">+ Crear beneficio</Link>
          </Button>
        }
      />

      {beneficios.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="beneficios-resumen">
          {activos} activo(s) · {borradores} borrador(es) pendientes de aprobación · {beneficios.length} en total.
        </p>
      )}

      {beneficios.length === 0 ? (
        <EmptyState
          variant="card"
          title="No hay beneficios todavía"
          description="Crea un bono de Membego o un descuento del proveedor para rebajar lo que paga el cliente en una oferta."
          action={
            <Button asChild>
              <Link href={`${RUTA_BENEFICIOS}/nuevo`}>Crear beneficio</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-beneficios">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Beneficio</th>
                    <th className="px-4 py-2">Financia</th>
                    <th className="px-4 py-2">Valor</th>
                    <th className="px-4 py-2">Aplica a</th>
                    <th className="px-4 py-2 text-right">Presupuesto</th>
                    <th className="px-4 py-2 text-right">Reservado</th>
                    <th className="px-4 py-2 text-right">Consumido</th>
                    <th className="px-4 py-2 text-right">Disponible</th>
                    <th className="px-4 py-2 text-right">Asignados</th>
                    <th className="px-4 py-2 text-right">Usos</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2">Vigencia</th>
                  </tr>
                </thead>
                <tbody>
                  {beneficios.map((b) => (
                    <tr key={b.id} className="border-t border-border align-top">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`${RUTA_BENEFICIOS}/${b.id}`} className="underline-offset-4 hover:underline">{b.name}</Link>
                        <span className="block font-mono text-caption text-muted-foreground">{b.code}</span>
                      </td>
                      <td className="px-4 py-2"><ChipFinanciacion funding={b.funding} /></td>
                      <td className="px-4 py-2 tabular-nums">
                        {b.valueType === 'PERCENTAGE'
                          ? `${b.funding !== 'SUPPLIER' ? `${b.membegoValue} %` : ''}${b.funding === 'SHARED' ? ' + ' : ''}${b.funding !== 'MEMBEGO' ? `${b.supplierValue} %` : ''}`
                          : `${b.funding !== 'SUPPLIER' ? dineroSupplyV2(b.membegoValue, b.currency) : ''}${b.funding === 'SHARED' ? ' + ' : ''}${b.funding !== 'MEMBEGO' ? dineroSupplyV2(b.supplierValue, b.currency) : ''}`}
                        <span className="block text-caption text-muted-foreground">{BENEFIT_VALUE_TYPE_LABELS[b.valueType]}</span>
                      </td>
                      <td className="px-4 py-2">
                        {b.alcance}
                        <span className="block text-caption text-muted-foreground">{BENEFIT_SCOPE_LABELS[b.scope]}</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{b.budgetTotal ? dineroSupplyV2(b.budgetTotal, b.currency) : 'Sin tope'}</td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="beneficio-reservado">{dineroSupplyV2(b.budgetReserved, b.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="beneficio-consumido">{dineroSupplyV2(b.budgetConsumed, b.currency)}</td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="beneficio-disponible">{b.budgetDisponible ? dineroSupplyV2(b.budgetDisponible, b.currency) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{b.asignaciones.toLocaleString('es-DO')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {b.aplicaciones.toLocaleString('es-DO')}
                        {b.reservasVivas > 0 && <span className="block text-caption text-warning">+{b.reservasVivas} en curso</span>}
                      </td>
                      <td className="px-4 py-2"><ChipBeneficio estado={b.status} /></td>
                      <td className="px-4 py-2 text-caption">{formatDate(b.startsAt)}{b.endsAt ? ` → ${formatDate(b.endsAt)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
