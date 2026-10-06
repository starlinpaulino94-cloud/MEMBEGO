import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipCompra } from '@/components/supply-v2/chips'
import { ChipModelo } from '@/components/supply-v2/finanzas/chips'
import { FormConfirmarPago } from '@/components/supply-v2/form-confirmar-pago'
import { listarComprasClientes } from '@/modules/supply-v2/offers/queries'
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ventas y cobros · Supply' }

/** MEMBEGO SUPPLY · cola de pagos por revisar y ventas (§28–§30). */
export default async function VentasPage() {
  await requireRole('SUPERADMIN')
  const compras = await listarComprasClientes('TODAS')
  const dinero = (n: { toString(): string }, moneda: string) => `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
  const porRevisar = compras.filter((c) => c.status === 'AWAITING_PAYMENT')
  const pendientes = compras.filter((c) => c.status === 'PENDING')
  const resto = compras.filter((c) => c.status !== 'AWAITING_PAYMENT' && c.status !== 'PENDING')

  const Fila = ({ c, conAcciones }: { c: (typeof compras)[number]; conAcciones: boolean }) => (
    <li className="space-y-2 py-3" data-testid="venta">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">
            <Link href={`/superadmin/supply/ofertas/ventas/${c.id}`} className="underline-offset-4 hover:underline" data-testid="link-venta">{c.number}</Link> · {c.customer.name ?? c.customer.email}
          </p>
          <p className="text-caption text-muted-foreground">
            {c.lines.map((l) => `${l.quantity} × ${l.titleSnapshot}`).join(', ')} · {formatDateTime(c.createdAt)}
            {c.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[c.paymentMethod]}` : ''}
            {c.paymentReference ? ` · ref. ${c.paymentReference}` : ''}
            {' · '}{PAYMENT_STATUS_LABELS[c.paymentStatus]}
          </p>
          {c.lines.find((l) => l.benefit) && (
            <p className="text-caption text-muted-foreground" data-testid="venta-beneficio">
              Beneficio aplicado: {c.lines.find((l) => l.benefit)!.benefit!.name} ({c.lines.find((l) => l.benefit)!.benefit!.code})
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-right tabular-nums">
            <span className="block font-medium">{dinero(c.total, c.currency)}</span>
            {(Number(c.membegoSubsidyTotal) > 0 || Number(c.supplierDiscountTotal) > 0) && (
              <span className="block text-caption text-muted-foreground" data-testid="venta-financiacion">
                contractual {dinero(c.contractualValue, c.currency)}
                {Number(c.supplierDiscountTotal) > 0 ? ` · descuento proveedor ${dinero(c.supplierDiscountTotal, c.currency)}` : ''}
                {Number(c.membegoSubsidyTotal) > 0 ? ` · bono Membego ${dinero(c.membegoSubsidyTotal, c.currency)}` : ''}
              </span>
            )}
            {c.sourceType === 'COMMISSION' && <span className="block text-caption text-muted-foreground" data-testid="venta-reparto">comisión {dinero(c.commissionAmount, c.currency)} · neto {dinero(c.supplierNet, c.currency)}</span>}
          </span>
          <ChipModelo fuente={c.sourceType} />
          <ChipCompra estado={c.status} />
        </div>
      </div>
      {conAcciones && <FormConfirmarPago orderId={c.id} total={c.total.toFixed(2)} moneda={c.currency} />}
    </li>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas y cobros"
        description="Lo que los clientes compraron a Membego. Un pago se confirma cuando alguien de Membego vio el dinero; entonces nace el derecho."
        eyebrow={<Link href="/superadmin/supply/ofertas" className="hover:underline">Ofertas</Link>}
        nav={<NavSupplyV2 activa="ofertas" />}
      />
      {compras.length === 0 ? (
        <EmptyState variant="card" title="Todavía no hay ventas" description="Cuando un cliente compre una oferta aparecerá aquí para revisar su pago." />
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Pagos por revisar ({porRevisar.length})</CardTitle></CardHeader>
            <CardContent>
              {porRevisar.length === 0 ? <p className="text-sm text-muted-foreground">Nada por revisar.</p> : <ul className="divide-y divide-border text-sm" data-testid="pagos-por-revisar">{porRevisar.map((c) => <Fila key={c.id} c={c} conAcciones />)}</ul>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Checkouts en curso ({pendientes.length})</CardTitle></CardHeader>
            <CardContent>
              {pendientes.length === 0 ? <p className="text-sm text-muted-foreground">Ninguno.</p> : <ul className="divide-y divide-border text-sm">{pendientes.map((c) => <Fila key={c.id} c={c} conAcciones />)}</ul>}
              <p className="mt-2 text-caption text-muted-foreground">Un checkout sin aviso de pago expira solo cuando vence su reserva. Confirmar aquí vale para pagos vistos en efectivo o por otra vía.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Historial</CardTitle></CardHeader>
            <CardContent>
              {resto.length === 0 ? <p className="text-sm text-muted-foreground">Sin historial.</p> : <ul className="divide-y divide-border text-sm">{resto.map((c) => <Fila key={c.id} c={c} conAcciones={false} />)}</ul>}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
