import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import type { VisitaDetalle } from '@/modules/visitas-membego/queries'
import { ChipDisputa, ChipEvidencia, ChipVenta, ChipVisita } from './chips'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · la ficha de una visita atribuida, la
 * misma para el proveedor, el cliente y el superadmin: lo incluido por
 * Membego (pagado), las compras adicionales con sus líneas, la evidencia y
 * las disputas. Cada pantalla decide qué acciones cuelga de cada venta
 * (`accionDeVenta`) y qué muestra de la comisión (`conComision`): el cliente
 * nunca ve comisiones; el proveedor y la plataforma sí.
 */
export function dineroVisita(n: string | number, moneda = 'DOP'): string {
  return `${moneda === 'DOP' ? 'RD$' : `${moneda} `}${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function DetalleVisita({
  visita,
  conComision,
  accionDeVenta,
  accionDeDisputa,
  mostrarEmpresa = false,
}: {
  visita: VisitaDetalle
  conComision: boolean
  accionDeVenta?: (venta: VisitaDetalle['ventas'][number]) => ReactNode
  accionDeDisputa?: (disputa: VisitaDetalle['disputas'][number]) => ReactNode
  mostrarEmpresa?: boolean
}) {
  const d = (n: string) => dineroVisita(n, visita.currency)
  return (
    <div className="space-y-4" data-testid="detalle-visita">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Visita</CardTitle>
          <ChipVisita estado={visita.status} />
        </CardHeader>
        <CardContent>
          <dl className="space-y-1 text-sm">
            <Dato label="Referencia"><span className="font-mono">{visita.number}</span></Dato>
            {mostrarEmpresa && <Dato label="Negocio">{visita.empresa}</Dato>}
            {visita.sucursal && <Dato label="Sucursal">{visita.sucursal}</Dato>}
            <Dato label="Cliente">{visita.cliente}</Dato>
            <Dato label="Abierta">{formatDateTime(visita.openedAt)}</Dato>
            <Dato label={visita.closedAt ? 'Cerrada' : 'Ventana hasta'}>{formatDateTime(visita.closedAt ?? visita.ventanaHasta)}</Dato>
            {visita.incluido && (
              <Dato label="Incluido por Membego">
                <span data-testid="visita-incluido">{visita.incluido.producto} ×{visita.incluido.cantidad}</span>
                <span className="block text-caption text-success">Pagado por Membego · {visita.incluido.redemptionNumber}</span>
              </Dato>
            )}
            <Dato label="Compras adicionales"><span data-testid="visita-extras-total">{d(visita.ancillaryTotal)}</span></Dato>
            {conComision && <Dato label="Comisión de Membego (solo extras)"><span data-testid="visita-comision-total">{d(visita.commissionTotal)}</span></Dato>}
            {visita.customerConfirmedAt && <Dato label="Confirmada por el cliente">{formatDateTime(visita.customerConfirmedAt)}</Dato>}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Compras adicionales</CardTitle></CardHeader>
        <CardContent>
          {visita.ventas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-ventas">El negocio no reportó compras adicionales en esta visita.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="ventas">
              {visita.ventas.map((v) => (
                <li key={v.id} className="space-y-2 py-3" data-testid="venta" data-venta-estado={v.status}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-mono text-caption text-muted-foreground">{v.number} · {formatDateTime(v.reportedAt)}</span>
                      <span className="block font-medium">{d(v.subtotal)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      <ChipVenta estado={v.status} />
                      <ChipEvidencia nivel={v.evidenceLevel} />
                      {v.disputa && <ChipDisputa estado={v.disputa.status} />}
                    </span>
                  </div>
                  <ul className="space-y-0.5 text-caption text-muted-foreground">
                    {v.lineas.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2" data-testid="linea" data-linea-kind={l.kind}>
                        <span>
                          {l.description} ×{l.quantity}
                          {l.kind === 'CUSTOM_REPORTED_LINE' && <span className="ml-1 rounded bg-warning/15 px-1 text-warning">personalizada</span>}
                        </span>
                        <span>{d(l.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  {conComision && (
                    <p className="text-caption text-muted-foreground" data-testid="venta-comision">
                      Comisión {Number(v.commissionRate).toLocaleString('es-DO')} %: {d(v.commissionAmount)}
                      {v.commissionAdjustment ? ` · ajuste por disputa ${d(v.commissionAdjustment)}` : ''} · {ETIQUETA_COMISION[v.commissionStatus]} · reportada por {v.reportedBy}
                    </p>
                  )}
                  {accionDeVenta?.(v)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {visita.disputas.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Reportes del cliente</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" data-testid="disputas">
              {visita.disputas.map((x) => (
                <li key={x.id} className="space-y-2 py-3" data-testid="disputa" data-disputa-estado={x.status}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-caption text-muted-foreground">{formatDateTime(x.openedAt)}{x.saleId ? ' · sobre una compra' : ' · sobre toda la visita'}</span>
                    <ChipDisputa estado={x.status} />
                  </div>
                  <p>«{x.customerClaim}»</p>
                  <p className="text-caption text-muted-foreground">
                    Reportado por el negocio: {d(x.reportedTotal)}{x.claimedTotal != null ? ` · el cliente reconoce: ${d(x.claimedTotal)}` : ''}
                  </p>
                  {x.resolution && <p className="text-caption">Resolución{x.resolvedAt ? ` (${formatDateTime(x.resolvedAt)})` : ''}: {x.resolution}</p>}
                  {accionDeDisputa?.(x)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const ETIQUETA_COMISION: Record<VisitaDetalle['ventas'][number]['commissionStatus'], string> = {
  NOT_APPLICABLE: 'sin comisión',
  PENDING: 'pendiente de confirmación',
  POSTED: 'asentada',
  REVERSED: 'reversada',
}

export function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
