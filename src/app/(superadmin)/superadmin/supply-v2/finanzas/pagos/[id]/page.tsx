import Link from 'next/link'
import { randomUUID } from 'crypto'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { getUser } from '@/lib/auth'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { formatDate, formatDateTime } from '@/lib/format'
import { urlComprobante } from '@/modules/storage/comprobantes'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipPagoProveedor } from '@/components/supply-v2/finanzas/chips'
import { CancelarPago, ConfirmarPago, ConvertirEnDeposito, ReversarAplicacion } from '@/components/supply-v2/finanzas/acciones-pago'
import { AdjuntoSupplyV2 } from '@/components/supply-v2/finanzas/adjunto'
import { fichaPago } from '@/modules/supply-v2/finance/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { APPLICATION_TYPE_LABELS, dineroSupplyV2, RUTA_FINANZAS, SUPPLIER_PAYMENT_METHOD_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY 2.0 · ficha de un pago (§37, §41, §56). */
export default async function PagoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [p, user, puedoConfirmar, puedoDepositos, puedoCrear] = await Promise.all([fichaPago(id), getUser(), puedeSupplyV2('SUPPLY_V2_PAYMENT_APPROVE'), puedeSupplyV2('SUPPLY_V2_DEPOSIT_MANAGE'), puedeSupplyV2('SUPPLY_V2_PAYMENT_CREATE')])
  if (!p) notFound()
  const comprobanteUrl = await urlComprobante('supply-v2', p.id, p.proofPath)
  const soyElCreador = Boolean(user?.metadata.dbUserId && p.createdById === user.metadata.dbUserId)
  const sinAplicar = p.amount.minus(p.appliedAmount)
  const m = p.currency
  const vivas = p.applications.filter((a) => a.type !== 'REVERSAL')
  return (
    <div className="space-y-6">
      <PageHeader
        title={p.number}
        description={`${p.supplier.commercialName} · ${SUPPLIER_PAYMENT_METHOD_LABELS[p.method]} · ${formatDate(p.paidAt)}${p.reference ? ` · ${p.reference}` : ''}`}
        eyebrow={<Link href={`${RUTA_FINANZAS}/pagos`} className="hover:underline">Pagos</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<ChipPagoProveedor estado={p.status} />}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Monto" value={<span data-testid="pago-monto">{dineroSupplyV2(p.amount, m)}</span>} />
        <StatCard label="Aplicado" value={dineroSupplyV2(p.appliedAmount, m)} />
        <StatCard label="Sin aplicar" value={<span data-testid="pago-sin-aplicar">{dineroSupplyV2(sinAplicar, m)}</span>} accent={sinAplicar.greaterThan(0) && p.status === 'CONFIRMED' ? 'warning' : undefined} />
      </div>
      <Card data-testid="siguiente-paso">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">
            {p.status === 'PENDING' && ('Este pago espera confirmación: al confirmarlo se aplica a lo declarado.')}
            {p.status === 'CONFIRMED' && (sinAplicar.greaterThan(0) ? `Confirmado con ${dineroSupplyV2(sinAplicar, m)} sin aplicar: aplícalo desde una factura o conviértelo en depósito.` : 'Confirmado y aplicado por completo.')}
            {p.status === 'CANCELLED' && `Cancelado${p.cancelledReason ? `: ${p.cancelledReason}` : ''}.`}
          </p>
          <p className="text-caption text-muted-foreground">
            Destino declarado: {p.intendedInvoice ? <Link href={`${RUTA_FINANZAS}/facturas/${p.intendedInvoice.id}`} className="underline-offset-4 hover:underline">factura {p.intendedInvoice.number}</Link> : p.intendedObligation ? `obligación ${p.intendedObligation.number}` : p.intendedDeposit ? 'depósito (anticipo)' : 'ninguno'}
            {p.fundedDeposit && <> · financia el <Link href={`${RUTA_FINANZAS}/depositos/${p.fundedDeposit.id}`} className="underline-offset-4 hover:underline">depósito {p.fundedDeposit.number}</Link></>}
          </p>
          {p.status === 'PENDING' && puedoConfirmar && <ConfirmarPago paymentId={p.id} soyElCreador={soyElCreador} />}
          {p.status === 'CONFIRMED' && sinAplicar.greaterThan(0) && puedoDepositos && !p.fundedDeposit && <ConvertirEnDeposito paymentId={p.id} sinAplicar={sinAplicar.toFixed(2)} moneda={m} idempotencyKey={`ui-dep-${randomUUID()}`} />}
          {p.status !== 'CANCELLED' && puedoConfirmar && vivas.every((a) => a.reversedAt) && <CancelarPago paymentId={p.id} />}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Datos</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Registrado por">{p.createdBy.name ?? p.createdBy.email}</Dato>
            <Dato label="Confirmado por">{p.confirmedBy ? `${p.confirmedBy.name ?? p.confirmedBy.email} · ${formatDateTime(p.confirmedAt!)}` : '—'}</Dato>
            <Dato label="Registrado">{formatDateTime(p.createdAt)}</Dato>
            {p.notes && <Dato label="Notas">{p.notes}</Dato>}
            <div className="border-t border-border pt-2">
              <p className="mb-1 text-muted-foreground">Comprobante</p>
              {comprobanteUrl ? <a href={comprobanteUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Ver comprobante</a> : <span className="text-caption text-muted-foreground">Sin comprobante.</span>}
              {puedoCrear && p.status !== 'CANCELLED' && <div className="mt-2"><AdjuntoSupplyV2 entidad="pago" id={p.id} etiqueta="Comprobante del pago" /></div>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Aplicaciones</CardTitle></CardHeader>
          <CardContent>
            {vivas.length === 0 ? <p className="text-sm text-muted-foreground">Nada aplicado todavía.</p> : (
              <ul className="divide-y divide-border text-sm" data-testid="pago-aplicaciones">
                {vivas.map((a) => (
                  <li key={a.id} className="space-y-1 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span>{APPLICATION_TYPE_LABELS[a.type]}{a.invoice && <> · <Link href={`${RUTA_FINANZAS}/facturas/${a.invoice.id}`} className="underline-offset-4 hover:underline">{a.invoice.number}</Link></>}{a.obligation && ` · ${a.obligation.number}`}{a.deposit && <> · <Link href={`${RUTA_FINANZAS}/depositos/${a.deposit.id}`} className="underline-offset-4 hover:underline">{a.deposit.number}</Link></>}<span className="block text-caption text-muted-foreground">{formatDateTime(a.createdAt)}{a.reversedAt ? ` · Reversada: ${a.reversalReason}` : ''}</span></span>
                      <span className={`tabular-nums ${a.reversedAt ? 'line-through text-muted-foreground' : ''}`}>{dineroSupplyV2(a.amount, m)}</span>
                    </div>
                    {!a.reversedAt && puedoConfirmar && <ReversarAplicacion applicationId={a.id} monto={a.amount.toFixed(2)} moneda={m} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}
