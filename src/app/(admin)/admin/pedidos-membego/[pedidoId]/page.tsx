import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { ESTADOS_AJUSTABLES, ESTADOS_CANCELABLES, ESTADOS_CON_PAGO_REGISTRABLE } from '@/modules/orders/domain'
import { detallePedidoEnTx } from '@/modules/orders/queries'
import {
  AYUDA_NIVEL,
  BADGE_ESTADO,
  ETIQUETA_CANAL,
  ETIQUETA_ESTADO,
  ETIQUETA_EVENTO,
  ETIQUETA_METODO,
  ETIQUETA_NIVEL,
  ETIQUETA_ORIGEN,
  PASOS,
  formatearFechaHora,
  formatearMonto,
  pasoActual,
} from '@/modules/orders/formato'
import { PedidoAcciones } from '@/components/pedidos/PedidoAcciones'

export const dynamic = 'force-dynamic'

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  )
}

export default async function PedidoMembegoPage({ params }: { params: Promise<{ pedidoId: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { pedidoId } = await params

  const p = await conEmpresa(companyId, (tx) => detallePedidoEnTx(tx, companyId, pedidoId))
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!p) notFound()

  const [gestionar, cancelar, reembolsar] = await Promise.all([
    puedeFuncion('pedidos-membego', 'gestionar'),
    puedeFuncion('pedidos-membego', 'cancelar'),
    puedeFuncion('pedidos-membego', 'reembolsar'),
  ])

  const paso = pasoActual(p.status)
  const cerrado = p.status === 'CANCELLED' || p.status === 'REFUNDED'
  const moneda = p.currency
  const hayAjuste = p.adjustment !== '0.00'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/pedidos-membego" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Pedidos Membego
          </Link>
        }
        title={p.code}
        description={`${ETIQUETA_ORIGEN[p.origin as keyof typeof ETIQUETA_ORIGEN] ?? p.origin} · ${formatearFechaHora(p.createdAt)}`}
        action={<Badge variant={BADGE_ESTADO[p.status]}>{ETIQUETA_ESTADO[p.status]}</Badge>}
      />

      {!cerrado && (
        <ol className="flex flex-wrap gap-2 text-sm" aria-label="Progreso del pedido">
          {PASOS.map((s, i) => (
            <li key={s.estado} aria-current={i + 1 === paso ? 'step' : undefined} className={i + 1 <= paso ? 'rounded-full bg-primary/10 px-3 py-1 font-medium text-primary' : 'rounded-full border border-border px-3 py-1 text-muted-foreground'}>
              {i + 1}. {s.etiqueta}
            </li>
          ))}
        </ol>
      )}

      {p.status === 'CANCELLED' && (
        <Card className="border-destructive/30">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-destructive">Pedido cancelado{p.cancelledAt ? ` el ${formatearFechaHora(p.cancelledAt)}` : ''}</p>
            {p.cancelReason && <p className="text-muted-foreground">Motivo: {p.cancelReason}</p>}
          </CardContent>
        </Card>
      )}
      {p.status === 'REFUNDED' && (
        <Card className="border-warning/40">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">Pedido reembolsado{p.refundedAt ? ` el ${formatearFechaHora(p.refundedAt)}` : ''}</p>
            {p.refundReason && <p className="text-muted-foreground">Motivo: {p.refundReason}</p>}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Lo que pidió</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm" aria-label="Líneas del pedido">
                {p.lineas.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{l.description}</p>
                      <p className="text-xs text-muted-foreground">
                        SKU {l.sku} · {l.quantity} × {formatearMonto(l.unitPrice, moneda)}
                        {l.discount !== '0.00' && ` · descuento ${formatearMonto(l.discount, moneda)}`}
                        {l.controlaInventario && ' · aparta inventario'}
                      </p>
                    </div>
                    <p className="tabular-nums">{formatearMonto(l.lineTotal, moneda)}</p>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 border-t pt-2">
                <Fila etiqueta="Subtotal">{formatearMonto(p.subtotal, moneda)}</Fila>
                {p.discount !== '0.00' && <Fila etiqueta="Descuentos">−{formatearMonto(p.discount, moneda)}</Fila>}
                {hayAjuste && (
                  <Fila etiqueta={`Ajuste${p.adjustmentReason ? ` (${p.adjustmentReason})` : ''}`}>{formatearMonto(p.adjustment, moneda)}</Fila>
                )}
                {p.tax !== '0.00' && <Fila etiqueta="Impuestos">{formatearMonto(p.tax, moneda)}</Fila>}
                <div className="flex items-baseline justify-between border-t pt-2">
                  <dt className="font-semibold">Total</dt>
                  <dd className="text-xl font-semibold tabular-nums">{formatearMonto(p.total, moneda)}</dd>
                </div>
              </dl>
              {p.notes && (
                <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm">
                  <span className="font-medium">Nota del cliente: </span>
                  {p.notes}
                </p>
              )}
            </CardContent>
          </Card>

          <PedidoAcciones
            pedidoId={p.id}
            moneda={moneda}
            total={p.total}
            ajuste={p.adjustment}
            tieneInventario={p.lineas.some((l) => l.controlaInventario)}
            permisos={{ gestionar, cancelar, reembolsar }}
            puede={{
              aceptar: p.status === 'AWAITING_MERCHANT',
              marcarListo: p.status === 'AWAITING_MERCHANT' || p.status === 'IN_PROGRESS',
              ajustar: ESTADOS_AJUSTABLES.includes(p.status),
              registrarPago: ESTADOS_CON_PAGO_REGISTRABLE.includes(p.status),
              cancelar: ESTADOS_CANCELABLES.includes(p.status),
              reembolsar: p.status === 'COMPLETED',
            }}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Historia</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm" aria-label="Historia del pedido">
                {p.eventos.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      {ETIQUETA_EVENTO[e.accion] ?? e.accion}
                      {typeof e.detalle.motivo === 'string' && e.detalle.motivo ? <span className="text-muted-foreground"> · {e.detalle.motivo}</span> : null}
                      <span className="text-muted-foreground"> · {e.por ?? (e.detalle.por === 'CLIENTE' ? 'el cliente' : 'el sistema')}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{formatearFechaHora(e.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5 text-sm">
              <p className="font-medium">{p.cliente.nombre}</p>
              {p.cliente.telefono && <p className="text-muted-foreground">{p.cliente.telefono}</p>}
              {p.cliente.email && <p className="break-all text-muted-foreground">{p.cliente.email}</p>}
              <p className="pt-2 text-xs text-muted-foreground">Atiende: {p.sucursal.nombre}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Verificación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{ETIQUETA_NIVEL[p.verificationLevel as keyof typeof ETIQUETA_NIVEL] ?? p.verificationLevel}</p>
                <p className="text-xs text-muted-foreground">{AYUDA_NIVEL[p.verificationLevel as keyof typeof AYUDA_NIVEL] ?? ''}</p>
              </div>
              <dl>
                <Fila etiqueta="Confirmación del cliente">
                  {!p.confirmacion ? 'Pendiente' : p.confirmacion.vigente ? `Confirmó ${formatearMonto(p.confirmacion.confirmedTotal, moneda)}` : `Desactualizada (confirmó ${formatearMonto(p.confirmacion.confirmedTotal, moneda)})`}
                </Fila>
                <Fila etiqueta="Pago registrado">
                  {p.pago ? `${ETIQUETA_METODO[p.pago.method as keyof typeof ETIQUETA_METODO] ?? p.pago.method} · ${formatearMonto(p.pago.amount, moneda)}` : 'Sin registrar'}
                </Fila>
                {p.pago?.reference && <Fila etiqueta="Referencia">{p.pago.reference}</Fila>}
                {p.completedAt && <Fila etiqueta="Canjeado">{formatearFechaHora(p.completedAt)}</Fila>}
              </dl>
              <p className="text-xs text-muted-foreground">Base comisionable: {formatearMonto(p.commissionableBase, moneda)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cómo llegó</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>{p.atribucion ? ETIQUETA_CANAL[p.atribucion.channel as keyof typeof ETIQUETA_CANAL] ?? p.atribucion.channel : 'Sin atribución'}</p>
              {p.atribucion?.channel === 'PROMOTION_CLAIM' && p.atribucion.promotionId && (
                <p className="text-xs">
                  <Link href={`/admin/deals/${p.atribucion.promotionId}`} className="underline">
                    Ver la oferta
                  </Link>{' '}
                  <span className="text-muted-foreground">· al canjearlo con el QR se cobra la cuota de la oferta.</span>
                </p>
              )}
              {p.atribucion?.referralCode && <p className="text-xs text-muted-foreground">Código de referido: {p.atribucion.referralCode}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
