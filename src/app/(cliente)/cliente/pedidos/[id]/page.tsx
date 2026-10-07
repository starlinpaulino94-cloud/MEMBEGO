import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { miPedido } from '@/modules/orders/cliente-queries'
import { BADGE_ESTADO, ETIQUETA_ESTADO, PASOS, formatearFechaHora, formatearMonto, pasoActual } from '@/modules/orders/formato'
import { AccionesMiPedido } from '@/components/pedidos/AccionesMiPedido'
import { QrDePedido } from '@/components/pedidos/QrDePedido'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi pedido' }

/**
 * Mi pedido: estado, líneas, monto, confirmación y el QR para recogerlo.
 * `miPedido` filtra por los ids de MIS fichas: el pedido de otra persona
 * responde 404, igual que uno que no existe.
 */
export default async function MiPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('CLIENTE')
  const { id } = await params
  const p = await miPedido(await misClienteIds(user.supabaseId), id)
  if (!p) notFound()

  const paso = pasoActual(p.status)
  const cerrado = p.status === 'CANCELLED' || p.status === 'REFUNDED'
  const hayAjuste = p.adjustment !== '0.00'

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/cliente/pedidos" className="hover:underline">
            Mis pedidos
          </Link>
        }
        title={p.code}
        description={`${p.empresa.name} · ${formatearFechaHora(p.createdAt)}`}
        action={<Badge variant={BADGE_ESTADO[p.status]}>{ETIQUETA_ESTADO[p.status]}</Badge>}
      />

      {p.oferta && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <span className="font-semibold">Oferta «{p.oferta.titulo}»</span>
          {p.oferta.estado === 'CLAIMED' ? ` · canjéala en el negocio antes del ${formatearFechaHora(p.oferta.venceEl)} mostrando tu QR.` : p.oferta.estado === 'REDEEMED' ? ' · ya la canjeaste.' : p.oferta.estado === 'EXPIRED' ? ' · venció sin canjearse.' : ''}
        </p>
      )}

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
            <p className="font-medium text-destructive">Este pedido fue cancelado</p>
            {p.cancelReason && <p className="text-muted-foreground">Motivo: {p.cancelReason}</p>}
          </CardContent>
        </Card>
      )}
      {p.status === 'REFUNDED' && (
        <Card className="border-warning/40">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">Este pedido fue reembolsado</p>
            {p.refundReason && <p className="text-muted-foreground">Motivo: {p.refundReason}</p>}
          </CardContent>
        </Card>
      )}

      {p.status === 'READY' && (
        <Card className="border-success/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Listo para recoger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Pasa por <span className="font-medium">{p.sucursal.nombre}</span>
              {p.sucursal.direccion ? ` (${p.sucursal.direccion})` : ''} y muestra este código al empleado.
            </p>
            {p.qrImagen ? (
              <div className="flex flex-col items-center gap-2">
                <QrDePedido src={p.qrImagen} alt={`QR del pedido ${p.code}`} />
                {p.qrExpiresAt && <p className="text-xs text-muted-foreground">Vale hasta el {formatearFechaHora(p.qrExpiresAt)}.</p>}
              </div>
            ) : (
              <p className="rounded-lg bg-muted/50 p-3">Este QR venció. Genera uno nuevo con el botón de abajo.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tu pedido</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm" aria-label="Líneas del pedido">
            {p.lineas.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{l.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.quantity} × {formatearMonto(l.unitPrice, p.currency)}
                    {l.discount !== '0.00' && ` · descuento ${formatearMonto(l.discount, p.currency)}`}
                  </p>
                </div>
                <p className="tabular-nums">{formatearMonto(l.lineTotal, p.currency)}</p>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t pt-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatearMonto(p.subtotal, p.currency)}</dd>
            </div>
            {p.discount !== '0.00' && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Descuentos</dt>
                <dd className="tabular-nums">−{formatearMonto(p.discount, p.currency)}</dd>
              </div>
            )}
            {hayAjuste && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Ajuste de la empresa{p.adjustmentReason ? ` (${p.adjustmentReason})` : ''}</dt>
                <dd className="tabular-nums">{formatearMonto(p.adjustment, p.currency)}</dd>
              </div>
            )}
            {p.tax !== '0.00' && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Impuestos</dt>
                <dd className="tabular-nums">{formatearMonto(p.tax, p.currency)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t pt-2">
              <dt className="font-semibold">Total</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatearMonto(p.total, p.currency)}</dd>
            </div>
          </dl>
          {p.confirmacion?.vigente && <p className="mt-3 text-sm text-success">Confirmaste este monto.</p>}
          {p.notes && (
            <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm">
              <span className="font-medium">Tu nota: </span>
              {p.notes}
            </p>
          )}
        </CardContent>
      </Card>

      <AccionesMiPedido pedidoId={p.id} moneda={p.currency} total={p.total} puede={p.puede} hayAjuste={hayAjuste} />
    </div>
  )
}
