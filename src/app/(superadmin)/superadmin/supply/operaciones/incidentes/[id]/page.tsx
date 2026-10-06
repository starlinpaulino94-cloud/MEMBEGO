import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dato, Momento, Severidad, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { AccionesDeIncidente, ConciliarAPeticion } from '@/components/supply-v2/operaciones/acciones'
import { incidenteDetalle } from '@/modules/supply-v2/operations/panel-queries'
import { lineaDeTiempoDeOperacion } from '@/modules/supply-v2/operations/busqueda'
import { etiquetaDeMotivoDePago, PAYMENT_INCIDENT_RESOLUTION_LABELS, RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Incidente · Operaciones' }

/**
 * SLICE 9 · BLOQUE 4 · §17 · LA FICHA DE UN INCIDENTE.
 *
 * Todo lo que hace falta para decidir, en una pantalla: severidad, motivo,
 * pasarela, compra, transacción, hilo, qué decía cada lado, la historia
 * completa y las acciones.
 *
 * Las acciones son las del BLOQUE 3 —investigar, resolver, y `ACCEPT_EXTERNAL`
 * por el servicio financiero oficial—: aquí no se reimplementa ninguna.
 */
export default async function IncidenteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const i = await incidenteDetalle(id)
  if (!i || i.type !== 'EXTERNAL_PAYMENT_MISMATCH') notFound()

  // La historia se arma desde el hilo si lo tiene, y si no desde la compra:
  // las dos son claves indexadas.
  const referencia = i.correlationId ?? i.order?.number ?? i.externalTransactionId ?? ''
  const { linea } = referencia ? await lineaDeTiempoDeOperacion(referencia) : { linea: { momentos: [], avisos: [] } }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Incidente · ${etiquetaDeMotivoDePago(i.reasonCode)}`}
        description={i.notes}
        eyebrow="Operaciones"
        action={<Link href={`${RUTA_OPERACIONES}/incidentes`} className="text-sm underline">← Incidentes</Link>}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Qué decía cada lado</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Severidad valor={i.severity} testid="detalle-severidad" />
              <span className="rounded border px-2 py-0.5 text-xs font-semibold" data-testid="detalle-estado">{i.status}</span>
              {i.resolution ? (
                <span className="text-xs text-muted-foreground">
                  {PAYMENT_INCIDENT_RESOLUTION_LABELS[i.resolution]}
                  {i.resolvedBy ? ` · ${i.resolvedBy.name ?? i.resolvedBy.email}` : ''}
                </span>
              ) : null}
            </div>

            <Tabla cabeceras={['Dato', 'Valor']}>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Motivo</td><td className="px-2 py-1.5" data-testid="detalle-motivo">{i.reasonCode ?? '—'}</td></tr>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Pasarela</td><td className="px-2 py-1.5" data-testid="detalle-proveedor"><Dato valor={i.provider} /></td></tr>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Transacción</td><td className="px-2 py-1.5" data-testid="detalle-transaccion"><Dato valor={i.externalTransactionId} /></td></tr>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Compra</td><td className="px-2 py-1.5" data-testid="detalle-orden">{i.order ? <Link className="underline" href={`${RUTA_OPERACIONES}/buscar?q=${i.order.number}`}>{i.order.number}</Link> : '— (el cobro no apunta a ninguna)'}</td></tr>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Hilo</td><td className="px-2 py-1.5 text-xs" data-testid="detalle-hilo"><Dato valor={i.correlationId} /></td></tr>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Estado interno / externo</td><td className="px-2 py-1.5 text-xs"><Dato valor={i.internalStatus} /> / <Dato valor={i.externalStatus} /></td></tr>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Importe del incidente</td><td className="px-2 py-1.5 tabular-nums">{i.currency} {i.amount.toFixed(2)}</td></tr>
              <tr><td className="px-2 py-1.5 text-muted-foreground">Abierto</td><td className="px-2 py-1.5"><Momento valor={i.createdAt} /></td></tr>
            </Tabla>

            {i.reconciliations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comprobaciones</p>
                <Tabla cabeceras={['Veredicto', 'Esperado', 'Reportado', 'Diferencia', 'Veces', 'Última']}>
                  {i.reconciliations.map((c) => (
                    <tr key={c.id} data-testid={`detalle-conciliacion-${c.id}`}>
                      <td className="px-2 py-1.5 text-xs font-medium">{c.outcome}</td>
                      <td className="px-2 py-1.5 text-xs tabular-nums">{c.expectedCurrency} {c.expectedAmount?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs tabular-nums">{c.reportedCurrency} {c.reportedAmount?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs tabular-nums">{c.differenceAmount?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs tabular-nums">{c.checks}</td>
                      <td className="px-2 py-1.5"><Momento valor={c.checkedAt} /></td>
                    </tr>
                  ))}
                </Tabla>
              </div>
            )}

            {i.resolutionNotes ? (
              <div className="rounded-lg border bg-muted/40 p-2 text-sm" data-testid="detalle-nota-resolucion">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cómo se resolvió</p>
                <p>{i.resolutionNotes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Acciones</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <AccionesDeIncidente
                incidentId={i.id}
                status={i.status}
                totalDeLaCompra={i.order ? i.order.total.toFixed(2) : null}
                tieneOrden={Boolean(i.order)}
              />
              {i.order || i.externalTransactionId ? (
                <div className="border-t pt-3">
                  <p className="mb-1 text-xs text-muted-foreground">Volver a comprobar contra la pasarela:</p>
                  <ConciliarAPeticion orderId={i.order?.id} transaccion={i.externalTransactionId ?? undefined} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Historia</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {linea.momentos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin momentos registrados.</p>
              ) : (
                <ol className="space-y-1.5 text-xs" data-testid="linea-de-tiempo">
                  {linea.momentos.map((m, n) => (
                    <li key={`${m.cuando.toISOString()}-${n}`} className="flex gap-2">
                      <Momento valor={m.cuando} />
                      <span className="min-w-0">
                        <strong className="font-medium">{m.que}</strong>
                        <span className="text-muted-foreground"> · {m.detalle}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {linea.avisos.map((a) => (
                <p key={a} className="rounded border border-dashed p-2 text-xs text-muted-foreground">{a}</p>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
