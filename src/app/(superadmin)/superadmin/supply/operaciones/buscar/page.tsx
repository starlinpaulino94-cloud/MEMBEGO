import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dato, Momento, Severidad, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { lineaDeTiempoDeOperacion } from '@/modules/supply-v2/operations/busqueda'
import { etiquetaDeMotivoDePago, RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Buscar · Operaciones' }

/**
 * SLICE 9 · BLOQUE 4 · §5 y §6 · BUSCAR UNA OPERACIÓN Y VER SU HISTORIA.
 *
 * La pregunta real no es «¿dónde aparece este texto?», es «¿qué pasó con
 * esto?»: el resultado viene AGRUPADO —la compra y sus eventos, sus
 * comprobaciones, sus incidentes, sus efectos y sus avisos— y con una línea de
 * tiempo construida SOLO con lo persistido.
 *
 * Lo que solo vive en los logs se dice como tal, no se inventa como momento.
 */
export default async function BuscarPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole('SUPERADMIN')
  const { q } = await searchParams
  const texto = (q ?? '').trim()
  const resultado = texto ? await lineaDeTiempoDeOperacion(texto) : null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Buscar una operación"
        description="Por número de compra, hilo, transacción de la pasarela, id de evento o id interno. Búsqueda exacta sobre campos indexados."
        eyebrow="Operaciones"
        action={<Link href={RUTA_OPERACIONES} className="text-sm underline">← Centro de Operaciones</Link>}
      />

      <Card>
        <CardContent className="py-3">
          <form className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="q" className="text-xs uppercase tracking-wide text-muted-foreground">Referencia</label>
              <Input id="q" name="q" defaultValue={texto} placeholder="MBG-SO-000123 · sv2-… · TX-… · evt_…" data-testid="campo-busqueda" />
            </div>
            <Button type="submit" data-testid="btn-buscar">Buscar</Button>
          </form>
        </CardContent>
      </Card>

      {resultado === null ? null : !resultado.busqueda.encontrado ? (
        <Card>
          <CardContent className="py-4 text-sm" data-testid="busqueda-sin-resultado">
            <p>
              No se encontró ninguna operación con <code>{texto}</code>.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tipo reconocido: <strong>{resultado.busqueda.tipo}</strong>. Si es <code>DESCONOCIDO</code>, la referencia
              no tiene una forma que se pueda buscar por índice —y un <code>%texto%</code> sobre estas tablas sería la
              consulta más lenta del sistema justo cuando hay un incidente—.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Qué se encontró <span className="text-sm font-normal text-muted-foreground">· {resultado.busqueda.tipo}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {resultado.busqueda.orden ? (
                <div data-testid="resultado-orden" className="rounded-lg border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Compra</p>
                  <p className="font-medium" data-testid="resultado-orden-numero">{resultado.busqueda.orden.number}</p>
                  <p className="text-sm text-muted-foreground">
                    Estado <strong data-testid="resultado-orden-estado">{resultado.busqueda.orden.status}</strong> ·{' '}
                    {resultado.busqueda.orden.currency} {resultado.busqueda.orden.total} · abierta{' '}
                    <Momento valor={resultado.busqueda.orden.createdAt} />
                    {resultado.busqueda.orden.paidAt ? <> · pagada <Momento valor={resultado.busqueda.orden.paidAt} /></> : null}
                  </p>
                </div>
              ) : null}

              {resultado.busqueda.eventos.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Eventos externos</p>
                  <Tabla cabeceras={['Estado', 'Pasarela', 'Tipo', 'Id del proveedor', 'Recibido']}>
                    {resultado.busqueda.eventos.map((e) => (
                      <tr key={e.id} data-testid={`resultado-evento-${e.id}`}>
                        <td className="px-2 py-1.5 text-xs font-semibold">{e.status}</td>
                        <td className="px-2 py-1.5 text-xs">{e.provider}</td>
                        <td className="px-2 py-1.5 text-xs">{e.eventType}</td>
                        <td className="px-2 py-1.5 text-xs">{e.externalEventId}</td>
                        <td className="px-2 py-1.5"><Momento valor={e.receivedAt} /></td>
                      </tr>
                    ))}
                  </Tabla>
                </div>
              )}

              {resultado.busqueda.conciliaciones.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Comprobaciones de pago</p>
                  <Tabla cabeceras={['Veredicto', 'Motivo', 'Esperado', 'Reportado', 'Dif.', 'Veces', 'Última']}>
                    {resultado.busqueda.conciliaciones.map((c) => (
                      <tr key={c.id} data-testid={`resultado-conciliacion-${c.id}`}>
                        <td className="px-2 py-1.5 text-xs font-semibold">{c.outcome}</td>
                        <td className="px-2 py-1.5 text-xs"><Dato valor={c.reasonCode} /></td>
                        <td className="px-2 py-1.5 text-xs tabular-nums">{c.expectedCurrency ?? ''} <Dato valor={c.expectedAmount} /></td>
                        <td className="px-2 py-1.5 text-xs tabular-nums">{c.reportedCurrency ?? ''} <Dato valor={c.reportedAmount} /></td>
                        <td className="px-2 py-1.5 text-xs tabular-nums"><Dato valor={c.differenceAmount} /></td>
                        <td className="px-2 py-1.5 text-xs tabular-nums">{c.checks}</td>
                        <td className="px-2 py-1.5"><Momento valor={c.checkedAt} /></td>
                      </tr>
                    ))}
                  </Tabla>
                </div>
              )}

              {resultado.busqueda.incidentes.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Incidentes</p>
                  <Tabla cabeceras={['Sev.', 'Estado', 'Motivo', 'Importe', 'Abierto', '']}>
                    {resultado.busqueda.incidentes.map((i) => (
                      <tr key={i.id} data-testid={`resultado-incidente-${i.id}`}>
                        <td className="px-2 py-1.5"><Severidad valor={i.severity} /></td>
                        <td className="px-2 py-1.5 text-xs font-semibold">{i.status}</td>
                        <td className="px-2 py-1.5 text-xs">{etiquetaDeMotivoDePago(i.reasonCode)}</td>
                        <td className="px-2 py-1.5 text-xs tabular-nums">{i.currency} {i.amount}</td>
                        <td className="px-2 py-1.5"><Momento valor={i.createdAt} /></td>
                        <td className="px-2 py-1.5">
                          <Link href={`${RUTA_OPERACIONES}/incidentes/${i.id}`} className="text-xs underline" data-testid={`resultado-abrir-${i.id}`}>
                            Abrir
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </Tabla>
                </div>
              )}

              {resultado.busqueda.efectos.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Efectos del outbox</p>
                  <Tabla cabeceras={['Estado', 'Efecto', 'Int.', 'Apuntado', 'Entregado']}>
                    {resultado.busqueda.efectos.map((e) => (
                      <tr key={e.id} data-testid={`resultado-efecto-${e.id}`}>
                        <td className="px-2 py-1.5 text-xs font-semibold">{e.status}</td>
                        <td className="px-2 py-1.5 text-xs">{e.eventType}</td>
                        <td className="px-2 py-1.5 text-xs tabular-nums">{e.attempts}</td>
                        <td className="px-2 py-1.5"><Momento valor={e.createdAt} /></td>
                        <td className="px-2 py-1.5"><Momento valor={e.processedAt} /></td>
                      </tr>
                    ))}
                  </Tabla>
                </div>
              )}

              {resultado.busqueda.avisos.length > 0 && (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Avisos al cliente</p>
                  <Tabla cabeceras={['Tipo', 'Título', 'Cuándo', 'Leído']}>
                    {resultado.busqueda.avisos.map((a) => (
                      <tr key={a.id} data-testid={`resultado-aviso-${a.id}`}>
                        <td className="px-2 py-1.5 text-xs">{a.tipo}</td>
                        <td className="px-2 py-1.5 text-xs">{a.titulo}</td>
                        <td className="px-2 py-1.5"><Momento valor={a.createdAt} /></td>
                        <td className="px-2 py-1.5 text-xs">{a.leida ? 'sí' : 'no'}</td>
                      </tr>
                    ))}
                  </Tabla>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Historia de la operación</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <ol className="space-y-1.5 text-xs" data-testid="linea-de-tiempo">
                {resultado.linea.momentos.map((m, n) => (
                  <li key={`${m.cuando.toISOString()}-${n}`} className="flex flex-wrap gap-2 border-b pb-1.5 last:border-0">
                    <Momento valor={m.cuando} />
                    <span className="min-w-0">
                      <strong className="font-medium">{m.que}</strong>
                      <span className="text-muted-foreground"> · {m.detalle}</span>
                    </span>
                    <span className="ml-auto text-xs uppercase text-muted-foreground">{m.fuente}</span>
                  </li>
                ))}
              </ol>
              {resultado.linea.avisos.map((a) => (
                <p key={a} className="rounded border border-dashed p-2 text-xs text-muted-foreground" data-testid="aviso-de-linea">
                  {a}
                </p>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
