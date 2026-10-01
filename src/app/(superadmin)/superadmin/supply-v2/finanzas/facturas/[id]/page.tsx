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
import { ChipFactura, ChipObligacion } from '@/components/supply-v2/finanzas/chips'
import { AplicarDeposito, AprobarFactura, CancelarFactura, PagarFactura } from '@/components/supply-v2/finanzas/acciones-factura'
import { ReversarAplicacion } from '@/components/supply-v2/finanzas/acciones-pago'
import { AdjuntoSupplyV2 } from '@/components/supply-v2/finanzas/adjunto'
import { TimelineFinanciero } from '@/components/supply-v2/finanzas/timeline-financiero'
import { depositosActivosDe, fichaFactura, pagosConSaldoDe, proveedoresParaFinanzas } from '@/modules/supply-v2/finance/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { personasAutorizadasEnTx } from '@/modules/supply-v2/core/autorizadas'
import { sinEmpresa } from '@/lib/tenant'
import { FACTURA_PAGABLE, politicaDeVersion } from '@/modules/supply-v2/finance/domain'
import { APPLICATION_TYPE_LABELS, dineroSupplyV2, PAYABLE_RECOGNITION_LABELS, RECOGNITION_BASIS_LABELS, RUTA_FINANZAS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/** MEMBEGO SUPPLY 2.0 · ficha de una FACTURA de proveedor (§35): totales, obligaciones, aplicaciones y acciones. */
export default async function FacturaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [f, user, puedoFacturas, puedoDepositos, puedoCrearPago, puedoAprobarPago] = await Promise.all([
    fichaFactura(id),
    getUser(),
    puedeSupplyV2('SUPPLY_V2_INVOICE_MANAGE'),
    puedeSupplyV2('SUPPLY_V2_DEPOSIT_MANAGE'),
    puedeSupplyV2('SUPPLY_V2_PAYMENT_CREATE'),
    puedeSupplyV2('SUPPLY_V2_PAYMENT_APPROVE'),
  ])
  if (!f) notFound()
  const pagable = FACTURA_PAGABLE.includes(f.status)
  const [depositos, pagosConSaldo, proveedores, adjuntoUrl] = await Promise.all([
    pagable && puedoDepositos ? depositosActivosDe(f.supplierId) : Promise.resolve([]),
    pagable && puedoAprobarPago ? pagosConSaldoDe(f.supplierId) : Promise.resolve([]),
    proveedoresParaFinanzas(),
    urlComprobante('supply-v2', f.id, f.attachmentPath),
  ])
  const soyElCreador = Boolean(user?.metadata.dbUserId && f.createdById === user.metadata.dbUserId)
  /** Sin segunda persona la segregación no protege nada: el servidor deja aprobar y el texto tiene que decirlo. */
  const soyElUnicoAutorizado = (await sinEmpresa('Supply 2.0: personas que pueden aprobar', (tx) => personasAutorizadasEnTx(tx))) <= 1
  const politica = f.purchaseOrder ? politicaDeVersion(f.purchaseOrder.agreementVersion.snapshot) : null
  const aplicaciones = f.applications.filter((a) => a.type !== 'REVERSAL')
  const m = f.currency

  return (
    <div className="space-y-6">
      <PageHeader
        title={f.number}
        description={`${f.supplier.commercialName}${f.supplierInvoiceNumber ? ` · ${f.supplierInvoiceNumber}` : ''} · ${formatDate(f.documentDate)}${f.dueDate ? ` · vence ${formatDate(f.dueDate)}` : ''}`}
        eyebrow={<Link href={`${RUTA_FINANZAS}/facturas`} className="hover:underline">Facturas</Link>}
        nav={<NavSupplyV2 activa="finanzas" />}
        action={<ChipFactura estado={f.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total" value={<span data-testid="factura-total">{dineroSupplyV2(f.total, m)}</span>} sub={`subtotal ${dineroSupplyV2(f.subtotal, m)} · impuestos ${dineroSupplyV2(f.taxes, m)}`} />
        <StatCard label="Aplicado (depósito)" value={<span data-testid="factura-aplicado">{dineroSupplyV2(f.amountApplied, m)}</span>} />
        <StatCard label="Pagado (transferencia)" value={<span data-testid="factura-pagado">{dineroSupplyV2(f.amountPaid, m)}</span>} />
        <StatCard label="Pendiente" value={<span data-testid="factura-pendiente">{dineroSupplyV2(f.amountDue, m)}</span>} accent={Number(f.amountDue) > 0 ? 'warning' : 'success'} />
      </div>

      <Card data-testid="siguiente-paso">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">
            {f.status === 'PENDING_APPROVAL' && (soyElCreador && !soyElUnicoAutorizado ? 'Registrada. Otra persona autorizada debe aprobarla para que nazca la deuda.' : 'Esta factura espera tu aprobación: al aprobarla nace (o se enlaza) la obligación con el proveedor.')}
            {f.status === 'APPROVED' && 'Aprobada y pendiente de pago. Aplica un depósito, registra una transferencia, o ambos.'}
            {f.status === 'PARTIALLY_PAID' && `Parcialmente cubierta: faltan ${dineroSupplyV2(f.amountDue, m)}.`}
            {f.status === 'PAID' && 'Factura pagada por completo. El proveedor no tiene pendiente por este documento.'}
            {f.status === 'CANCELLED' && `Cancelada${f.cancelledReason ? `: ${f.cancelledReason}` : ''}.`}
          </p>
          {f.status === 'PENDING_APPROVAL' && puedoFacturas && <AprobarFactura invoiceId={f.id} soyElCreador={soyElCreador} soyElUnicoAutorizado={soyElUnicoAutorizado} />}
          {pagable && (
            <div className="space-y-3">
              {puedoDepositos && depositos.length > 0 && <AplicarDeposito invoiceId={f.id} depositos={depositos.map((d) => ({ id: d.id, number: d.number, availableAmount: d.availableAmount.toFixed(2), currency: d.currency }))} pendiente={f.amountDue.toFixed(2)} moneda={m} idempotencyKey={`ui-dep-${randomUUID()}`} />}
              {politica && !politica.allowDepositApplication && <p className="text-caption text-muted-foreground">El acuerdo de esta compra no permite cubrirla con depósito.</p>}
              {puedoCrearPago && <PagarFactura invoiceId={f.id} invoiceNumber={f.number} supplierId={f.supplierId} proveedores={proveedores} pagosConSaldo={puedoAprobarPago ? pagosConSaldo : []} pendiente={f.amountDue.toFixed(2)} moneda={m} idempotencyKeys={{ pago: `ui-pago-${randomUUID()}`, aplicacion: `ui-pago-app-${randomUUID()}` }} />}
            </div>
          )}
          {f.payments.length > 0 && (
            <p className="text-caption text-muted-foreground" data-testid="factura-pagos-pendientes">
              Pagos registrados para esta factura pendientes de confirmar: {f.payments.map((p) => `${p.number} (${dineroSupplyV2(p.amount, m)})`).join(', ')}. <Link href={`${RUTA_FINANZAS}/pagos?estado=PENDING`} className="underline-offset-4 hover:underline">Confirmar →</Link>
            </p>
          )}
          {puedoFacturas && f.status !== 'CANCELLED' && f.status !== 'PAID' && f.status !== 'PARTIALLY_PAID' && <CancelarFactura invoiceId={f.id} />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Líneas</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr><th className="py-1 pr-3">Concepto</th><th className="py-1 pr-3 text-right">Cantidad</th><th className="py-1 pr-3 text-right">Costo</th><th className="py-1 pr-3 text-right">Impuestos</th><th className="py-1 text-right">Total</th></tr>
                </thead>
                <tbody>
                  {f.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">{l.descriptionSnapshot}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.quantity.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(l.unitCost, m)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{dineroSupplyV2(l.taxes, m)}</td>
                      <td className="py-2 text-right tabular-nums">{dineroSupplyV2(l.total, m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Datos</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Proveedor"><Link href={`/superadmin/supply-v2/proveedores/${f.supplier.id}`} className="underline-offset-4 hover:underline">{f.supplier.commercialName}</Link></Dato>
            <Dato label="Orden de compra">{f.purchaseOrder ? <Link href={`/superadmin/supply-v2/compras/${f.purchaseOrder.id}`} className="underline-offset-4 hover:underline">{f.purchaseOrder.number}</Link> : 'Sin orden'}</Dato>
            {politica && <Dato label="Deuda nace">{PAYABLE_RECOGNITION_LABELS[politica.payableRecognition]}</Dato>}
            <Dato label="Registrada por">{f.creadoPor ?? '—'}</Dato>
            <Dato label="Aprobada por">{f.aprobadoPor ?? '—'}</Dato>
            <Dato label="Registrada">{formatDateTime(f.createdAt)}</Dato>
            {f.notes && <Dato label="Notas">{f.notes}</Dato>}
            <div className="border-t border-border pt-2">
              <p className="mb-1 text-muted-foreground">Factura del proveedor (PDF o imagen)</p>
              {adjuntoUrl ? <a href={adjuntoUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Ver archivo adjunto</a> : <span className="text-caption text-muted-foreground">Sin archivo.</span>}
              {puedoFacturas && f.status !== 'CANCELLED' && <div className="mt-2"><AdjuntoSupplyV2 entidad="factura" id={f.id} etiqueta="Archivo de la factura" /></div>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Obligaciones que cubre</CardTitle></CardHeader>
        <CardContent>
          {f.obligations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna todavía: la deuda nace al aprobar la factura.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="factura-obligaciones">
              {f.obligations.map((o) => (
                <li key={o.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span><span className="font-medium">{o.number}</span> · {RECOGNITION_BASIS_LABELS[o.recognitionBasis]}{o.dueAt ? ` · vence ${formatDate(o.dueAt)}` : ''}</span>
                  <span className="flex items-center gap-3 tabular-nums">{dineroSupplyV2(o.paidAmount, m)} / {dineroSupplyV2(o.grossAmount, m)} <ChipObligacion estado={o.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Aplicaciones</CardTitle></CardHeader>
        <CardContent>
          {aplicaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada aplicado todavía.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="factura-aplicaciones">
              {aplicaciones.map((a) => (
                <li key={a.id} className="space-y-1 py-2" data-testid="aplicacion">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-medium">{APPLICATION_TYPE_LABELS[a.type]}</span>
                      {a.deposit && <> · <Link href={`${RUTA_FINANZAS}/depositos/${a.deposit.id}`} className="underline-offset-4 hover:underline">{a.deposit.number}</Link></>}
                      {a.payment && <> · <Link href={`${RUTA_FINANZAS}/pagos/${a.payment.id}`} className="underline-offset-4 hover:underline">{a.payment.number}</Link>{a.payment.reference ? ` (${a.payment.reference})` : ''}</>}
                      <span className="block text-caption text-muted-foreground">{formatDateTime(a.createdAt)}{a.createdBy ? ` · ${a.createdBy.name ?? a.createdBy.email}` : ''}{a.reversedAt ? ` · Reversada: ${a.reversalReason}` : ''}</span>
                    </span>
                    <span className={`tabular-nums ${a.reversedAt ? 'line-through text-muted-foreground' : ''}`}>{dineroSupplyV2(a.amount, m)}</span>
                  </div>
                  {!a.reversedAt && puedoAprobarPago && f.status !== 'CANCELLED' && <ReversarAplicacion applicationId={a.id} monto={a.amount.toFixed(2)} moneda={m} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recorrido</CardTitle></CardHeader>
        <CardContent><TimelineFinanciero hitos={f.timeline} moneda={m} testId="factura-timeline" /></CardContent>
      </Card>
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
