import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { RecibirTransferenciaForm } from '@/components/inventario/RecibirTransferenciaForm'
import { ETIQUETA_ESTADO_TRASLADO, estaAbierto } from '@/modules/inventory/traslados'
import { trasladoDetalleEnTx } from '@/modules/inventory/queries'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const ETIQUETA_MOVIMIENTO_TRASLADO: Record<string, string> = { TRANSFER_OUT: 'Salida', TRANSFER_IN: 'Entrada' }

export default async function TransferenciaInventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  const puedeTransferir = await puedeFuncion('inventario', 'transferir')

  let datos: { zona: string; traslado: Awaited<ReturnType<typeof trasladoDetalleEnTx>> } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), traslado: await trasladoDetalleEnTx(tx, companyId, id) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-transferencia', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos?.traslado) notFound()
  const { traslado: t, zona } = datos
  const abierto = estaAbierto(t.estado)

  const tarjetas: ReadonlyArray<readonly [string, number]> = [
    ['Enviadas', t.unidades],
    ['Recibidas', t.recibidas],
    ['En camino', t.enTransito],
    ['Devueltas al origen', t.devueltas],
    ['Perdidas', t.perdidas],
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/transferencias" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Transferencias
          </Link>
        }
        title={t.numero}
        description={`${t.origenNombre} → ${t.destinoNombre} · enviada ${formatDateTimeExacto(t.creadoEn, { zonaHoraria: zona })}${t.enviadoPorNombre ? ` por ${t.enviadoPorNombre}` : ''}`}
        action={<BotonExportar href={`/admin/inventario/transferencias/${t.id}/exportar`} variant="outline" size="sm" />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={abierto ? 'default' : 'outline'}>{ETIQUETA_ESTADO_TRASLADO[t.estado]}</Badge>
        {t.nota && <span className="text-sm text-muted-foreground">{t.nota}</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5" aria-label="Resumen de la transferencia">
        {tarjetas.map(([etiqueta, valor]) => (
          <Card key={etiqueta}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{etiqueta}</p>
              <p className="text-lg font-semibold tabular-nums">{formatearCantidad(valor)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!abierto && (
        <Alert>
          <AlertDescription>
            {t.estado === 'CANCELLED' ? 'Cancelada' : 'Cerrada'} {t.cerradoEn ? formatDateTimeExacto(t.cerradoEn, { zonaHoraria: zona }) : ''}
            {t.cerradoPorNombre ? ` por ${t.cerradoPorNombre}` : ''}
            {t.motivoCierre ? `: ${t.motivoCierre}` : '.'}{' '}
            {t.estado === 'CANCELLED' ? `Lo que seguía en camino volvió a ${t.origenNombre}.` : t.perdidas > 0 ? 'Lo que no llegó quedó como perdido.' : 'Llegó todo.'} Una transferencia cerrada no se edita.
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="lineas-transferencia" className="space-y-2">
        <h2 id="lineas-transferencia" className="text-lg font-semibold">
          Productos ({formatearCantidad(t.lineas)})
        </h2>
        <ul className="divide-y rounded-lg border" aria-label="Líneas de la transferencia">
          {t.detalle.map((l) => (
            <li key={l.varianteId} className="p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/inventario/${l.varianteId}`} className="font-medium underline-offset-2 hover:underline">
                    {nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    SKU {l.sku}
                    {l.barcode && ` · ${l.barcode}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-right tabular-nums">
                  {(
                    [
                      ['Enviado', l.enviado],
                      ['Recibido', l.recibido],
                      ['En camino', l.pendiente],
                      ...(l.devuelto > 0 ? ([['Devuelto', l.devuelto]] as const) : []),
                      ...(l.perdido > 0 ? ([['Perdido', l.perdido]] as const) : []),
                    ] as ReadonlyArray<readonly [string, number]>
                  ).map(([etiqueta, valor]) => (
                    <div key={etiqueta}>
                      <p className="text-xs text-muted-foreground">{etiqueta}</p>
                      <p>{formatearCantidad(valor)}</p>
                    </div>
                  ))}
                </div>
              </div>
              {l.lotes.length > 0 && (
                <ul className="mt-2 divide-y rounded-lg bg-muted/40 px-3" aria-label={`Lotes de ${nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault)}`}>
                  {l.lotes.map((x) => (
                    <li key={x.loteId} data-lote={x.codigo} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                      <p className="min-w-0 flex-1">
                        <span className="font-medium">Lote {x.codigo}</span>
                        <span className="text-xs text-muted-foreground"> · {x.vencimiento ? `vence ${x.vencimiento}` : 'no vence'}</span>
                      </p>
                      <p className="flex flex-wrap items-center gap-4 text-right tabular-nums">
                        <span>Enviado {formatearCantidad(x.enviado)}</span>
                        <span>Recibido {formatearCantidad(x.recibido)}</span>
                        {x.devuelto > 0 && <span>Devuelto {formatearCantidad(x.devuelto)}</span>}
                        {x.pendiente > 0 && (
                          <span>
                            {abierto ? 'En camino' : 'Perdido'} {formatearCantidad(x.pendiente)}
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {abierto &&
        (puedeTransferir ? (
          <RecibirTransferenciaForm
            trasladoId={t.id}
            numero={t.numero}
            origenNombre={t.origenNombre}
            destinoNombre={t.destinoNombre}
            lineas={t.detalle
              .filter((l) => l.pendiente > 0)
              .map((l) => ({
                varianteId: l.varianteId,
                nombre: nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault),
                sku: l.sku,
                pendiente: l.pendiente,
                lotes: l.lotes
                  .filter((x) => x.pendiente > 0)
                  .map((x) => ({
                    loteId: x.loteId,
                    codigo: x.codigo,
                    vencimiento: x.vencimiento,
                    pendiente: x.pendiente,
                  })),
              }))}
          />
        ) : (
          <Alert>
            <AlertDescription>Puedes ver esta transferencia, pero recibirla o cancelarla requiere el permiso de transferir mercancía.</AlertDescription>
          </Alert>
        ))}

      <section aria-labelledby="movimientos-transferencia" className="space-y-2">
        <h2 id="movimientos-transferencia" className="text-lg font-semibold">
          Movimientos
        </h2>
        <ul className="divide-y rounded-lg border" aria-label="Movimientos de la transferencia">
          {t.historial.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {ETIQUETA_MOVIMIENTO_TRASLADO[m.tipo] ?? m.tipo} · {m.producto}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.sucursalNombre} · {formatDateTimeExacto(m.creadoEn, { zonaHoraria: zona })} · {m.usuarioNombre ?? 'Sistema'}
                  {m.lotes && ` · lotes: ${m.lotes}`}
                  {m.motivo && ` · ${m.motivo}`}
                </p>
              </div>
              <p className={m.tipo === 'TRANSFER_OUT' ? 'font-semibold tabular-nums text-destructive' : 'font-semibold tabular-nums text-success'}>
                {m.tipo === 'TRANSFER_OUT' ? '−' : '+'}
                {formatearCantidad(m.cantidad)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
