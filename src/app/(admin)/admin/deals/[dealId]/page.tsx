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
import { ESTADOS_PAUSABLES, ETIQUETA_ESTADO_OFERTA, ETIQUETA_ESTADO_RECLAMO, etiquetaDeDescuento } from '@/modules/deals/domain'
import { BADGE_ESTADO_OFERTA, BADGE_ESTADO_RECLAMO, EXPLICACION_ESTADO_OFERTA } from '@/modules/deals/formato'
import { dateADia } from '@/modules/deals/formulario'
import { detalleOfertaEnTx, opcionesParaOfertaEnTx } from '@/modules/deals/queries'
import { formatearFechaHora, formatearMonto } from '@/modules/orders/formato'
import { OfertaAcciones } from '@/components/deals/OfertaAcciones'
import { OfertaForm } from '@/components/deals/OfertaForm'

export const dynamic = 'force-dynamic'

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  )
}

export default async function OfertaPage({ params }: { params: Promise<{ dealId: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { dealId } = await params

  const o = await conEmpresa(companyId, (tx) => detalleOfertaEnTx(tx, companyId, dealId))
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!o) notFound()

  const [crear, publicar, presupuesto, archivar] = await Promise.all([
    puedeFuncion('deals', 'crear'),
    puedeFuncion('deals', 'publicar'),
    puedeFuncion('deals', 'presupuesto'),
    puedeFuncion('deals', 'archivar'),
  ])
  const opciones = o.editableTodo && crear ? await conEmpresa(companyId, (tx) => opcionesParaOfertaEnTx(tx, companyId)) : null

  const m = o.currency
  const r = o.rendimiento
  const viva = o.status !== 'ARCHIVED' && o.status !== 'COMPLETED'
  const puede = {
    publicar: o.status === 'DRAFT',
    pausar: ESTADOS_PAUSABLES.includes(o.status),
    reanudar: o.status === 'PAUSED',
    ampliar: viva,
    archivar: o.status !== 'ARCHIVED',
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/deals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        Ofertas
      </Link>
      <PageHeader title={o.title} description={`${o.itemName}${o.variantName !== o.itemName ? ` · ${o.variantName}` : ''} · ${etiquetaDeDescuento(o.discountType as never, o.discountValue, m)}`} action={<Badge variant={BADGE_ESTADO_OFERTA[o.status]}>{ETIQUETA_ESTADO_OFERTA[o.status]}</Badge>} />

      <p className="text-sm text-muted-foreground">
        {EXPLICACION_ESTADO_OFERTA[o.status]}
        {o.statusReason ? ` (${o.statusReason})` : ''}
      </p>

      <OfertaAcciones ofertaId={o.id} moneda={m} permisos={{ publicar, presupuesto, archivar }} puede={puede} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Presupuesto</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Fila etiqueta="Tope declarado">{formatearMonto(o.budgetTotal, m)}</Fila>
              <Fila etiqueta="Ya cobrado por canjes">{formatearMonto(o.budgetSpent, m)}</Fila>
              <Fila etiqueta="Apartado por cupones sin canjear">{formatearMonto(o.budgetReserved, m)}</Fila>
              <Fila etiqueta="Libre">{formatearMonto(o.budgetFree, m)}</Fila>
              <Fila etiqueta="Cuota de Membego por canje">{formatearMonto(o.fee, m)}</Fila>
              <Fila etiqueta="Reclamos que aún admite">{o.posibles}</Fila>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">El presupuesto es un tope: la cuota se cobra en tu cuenta Membego cuando el cliente canjea, no por adelantado.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Fila etiqueta="Obtenidas">{r.reclamos}</Fila>
              <Fila etiqueta="Canjeadas">{r.canjeados}</Fila>
              <Fila etiqueta="Por canjear">{r.porCanjear}</Fila>
              <Fila etiqueta="Vencidas / canceladas / reembolsadas">
                {r.vencidos} / {r.cancelados} / {r.reembolsados}
              </Fila>
              <Fila etiqueta="Conversión">{r.conversion} %</Fila>
              <Fila etiqueta="Ahorro entregado a clientes">{formatearMonto(r.ahorroEntregado.toFixed(2), m)}</Fila>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              Precio de lista {formatearMonto(o.precioLista, m)} → con la oferta {formatearMonto(o.precioOferta, m)} (ahorro {formatearMonto(o.ahorro, m)}). Cupos: {o.claimsActive} de {o.maxClaims}. Cupón válido {o.voucherDays} días
              {o.newCustomersOnly ? ' · solo clientes nuevos' : ''}.
            </p>
          </CardContent>
        </Card>
      </div>

      {crear && viva && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{o.editableTodo ? 'Editar el borrador' : 'Ajustes'}</CardTitle>
          </CardHeader>
          <CardContent>
            {!o.editableTodo && <p className="mb-3 text-xs text-muted-foreground">Una oferta publicada no cambia su descuento, su producto ni su presupuesto (el presupuesto solo se amplía arriba).</p>}
            <OfertaForm
              ofertaId={o.id}
              soloAjustes={!o.editableTodo}
              productos={opciones?.productos ?? []}
              cuota={o.fee}
              moneda={m}
              inicial={{
                title: o.title,
                description: o.description ?? '',
                catalogVariantId: o.catalogVariantId,
                discountType: o.discountType as 'PERCENT' | 'AMOUNT_OFF' | 'FIXED_PRICE',
                discountValue: o.discountValue,
                startsAt: dateADia(o.startsAt),
                endsAt: o.endsAt ? dateADia(o.endsAt) : '',
                voucherDays: String(o.voucherDays),
                newCustomersOnly: o.newCustomersOnly,
                maxClaims: String(o.maxClaims),
                budgetTotal: o.budgetTotal,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quién la obtuvo</CardTitle>
        </CardHeader>
        <CardContent>
          {o.reclamos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía nadie la ha obtenido.</p>
          ) : (
            <>
            {o.reclamosTotal > o.reclamos.length && (
              <p className="mb-2 text-xs text-muted-foreground" data-testid="reclamos-recortados">
                Se muestran los {o.reclamos.length} más recientes de {o.reclamosTotal}. El resultado de arriba cuenta todos.
              </p>
            )}
            <ul className="divide-y" aria-label="Reclamos de la oferta">
              {o.reclamos.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <Link href={`/admin/pedidos-membego/${c.orderId}`} className="font-medium underline-offset-2 hover:underline">
                      {c.orderCode}
                    </Link>{' '}
                    <span className="text-muted-foreground">· {c.clienteNombre}</span>
                    <p className="text-xs text-muted-foreground">
                      Obtenida {formatearFechaHora(c.claimedAt)} · {c.redeemedAt ? `canjeada ${formatearFechaHora(c.redeemedAt)}` : `vence ${formatearFechaHora(c.expiresAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-muted-foreground">ahorro {formatearMonto(c.savings, m)}</span>
                    <Badge variant={BADGE_ESTADO_RECLAMO[c.status]}>{ETIQUETA_ESTADO_RECLAMO[c.status]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
