import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { FormAccion } from '@/components/supply/form-accion'
import { fichaConciliacion } from '@/modules/supply/conciliacion-proveedor'
import {
  agregarNotaDiscrepanciaAction,
  cerrarConciliacionAction,
  moverDiscrepanciaAction,
} from '@/modules/supply/actions-finanzas'
import { DISCREPANCIA_VIVA, TRANSICIONES_DISCREPANCIA } from '@/modules/supply/estados'
import {
  SUPPLY_CONCILIACION_ESTADO_LABELS,
  SUPPLY_DISCREPANCIA_ESTADO_LABELS,
  SUPPLY_DISCREPANCIA_TIPO_LABELS,
} from '@/modules/supply/catalogo'
import { varianteConciliacion, varianteDiscrepancia } from '@/components/supply/variantes'

export const dynamic = 'force-dynamic'

/**
 * Ficha de una conciliación: las cifras de los dos lados y cada discrepancia
 * con su investigación. Se cierra solo cuando ninguna sigue viva; si está
 * atada a una liquidación pagada, cerrarla la marca CONCILIADA.
 */
export default async function ConciliacionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const c = await fichaConciliacion(id)
  if (!c) notFound()

  const vivas = c.discrepancias.filter((d) => DISCREPANCIA_VIVA.includes(d.estado))
  const abierta = c.estado !== 'CERRADA'

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Conciliación ${c.codigo}`}
        description={`${c.proveedor.name}${c.acuerdo ? ` · acuerdo ${c.acuerdo.codigo}` : ''} · ${formatDate(c.periodoDesde)} → ${formatDate(c.periodoHasta)}`}
        eyebrow={
          <Link href="/superadmin/supply/conciliacion" className="hover:underline">
            ← Conciliación
          </Link>
        }
        nav={<NavSupply activa="conciliacion" />}
        action={<Badge variant={varianteConciliacion(c.estado)}>{SUPPLY_CONCILIACION_ESTADO_LABELS[c.estado]}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Redenciones" value={`${c.membegoRedenciones} / ${c.proveedorRedenciones}`} sub="Membego / proveedor" accent={c.membegoRedenciones !== c.proveedorRedenciones ? 'warning' : 'success'} />
        <StatCard label="Monto redenciones" value={`${formatMoneyRD(Number(c.membegoMonto))}`} sub={`proveedor: ${formatMoneyRD(Number(c.proveedorMonto))}`} accent={Number(c.membegoMonto) !== Number(c.proveedorMonto) ? 'warning' : 'success'} />
        <StatCard label="Ventas entregadas" value={`${c.membegoVentas} / ${c.proveedorVentas}`} sub={`${formatMoneyRD(Number(c.membegoVentasMonto))} / ${formatMoneyRD(Number(c.proveedorVentasMonto))}`} />
        <StatCard label="Discrepancias" value={`${vivas.length} vivas`} sub={`${c.discrepancias.length} en total`} accent={vivas.length > 0 ? 'danger' : 'success'} />
      </div>

      {abierta && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm">
              {vivas.length === 0
                ? 'Ninguna discrepancia sigue viva: la conciliación se puede cerrar.'
                : `Quedan ${vivas.length} discrepancia(s) por resolver o aprobar antes de cerrar.`}
              {c.liquidacion && (
                <>
                  {' '}
                  Ligada a{' '}
                  <Link href={`/superadmin/supply/finanzas/liquidaciones/${c.liquidacion.id}`} className="underline">
                    {c.liquidacion.codigo}
                  </Link>{' '}
                  ({c.liquidacion.estado}).
                </>
              )}
            </p>
            <FormAccion
              accion={cerrarConciliacionAction}
              ocultos={{ conciliacionId: c.id }}
              etiqueta="Cerrar conciliación"
              recargar
              confirmar="¿Cerrar esta conciliación? Si está ligada a una liquidación pagada, quedará conciliada."
            />
          </CardContent>
        </Card>
      )}

      {c.discrepancias.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Las cifras cuadran: no nació ninguna discrepancia.</CardContent>
        </Card>
      ) : (
        c.discrepancias.map((d) => {
          const siguientes = TRANSICIONES_DISCREPANCIA[d.estado]
          return (
            <Card key={d.id} className={DISCREPANCIA_VIVA.includes(d.estado) ? 'border-warning/40' : undefined}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Badge variant="outline">{SUPPLY_DISCREPANCIA_TIPO_LABELS[d.tipo]}</Badge>
                  <span>{d.titulo}</span>
                  <Badge variant={varianteDiscrepancia(d.estado)}>{SUPPLY_DISCREPANCIA_ESTADO_LABELS[d.estado]}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">{d.detalle}</p>
                <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  <Dato t="Cant. Membego" v={d.cantidadMembego?.toString() ?? '—'} />
                  <Dato t="Cant. proveedor" v={d.cantidadProveedor?.toString() ?? '—'} />
                  <Dato t="Monto Membego" v={d.montoMembego != null ? formatMoneyRD(Number(d.montoMembego)) : '—'} />
                  <Dato t="Monto proveedor" v={d.montoProveedor != null ? formatMoneyRD(Number(d.montoProveedor)) : '—'} />
                  <Dato t="Diferencia" v={d.montoDiferencia != null ? formatMoneyRD(Number(d.montoDiferencia)) : '—'} />
                  <Dato t="Entidad" v={d.entidad ? `${d.entidad} ${d.entidadId?.slice(0, 10) ?? ''}` : '—'} />
                </dl>

                {(d.resolucion || d.cuentaPorPagar || d.cuentaPorCobrar) && (
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    {d.resolucion && (
                      <p>
                        <strong>Resolución:</strong> {d.resolucion}
                        {d.resueltoPor ? ` — ${d.resueltoPor.name}` : ''}
                        {d.resueltoAt ? ` · ${formatDateTime(d.resueltoAt)}` : ''}
                      </p>
                    )}
                    {d.cuentaPorPagar && <p>Ajuste: cuenta por pagar {d.cuentaPorPagar.codigo} por {formatMoneyRD(Number(d.cuentaPorPagar.montoNeto))}.</p>}
                    {d.cuentaPorCobrar && <p>Ajuste: cuenta por cobrar {d.cuentaPorCobrar.codigo} por {formatMoneyRD(Number(d.cuentaPorCobrar.montoNeto))}.</p>}
                    {d.aprobadoPor && <p>Aprobó {d.aprobadoPor.name}{d.aprobadoAt ? ` · ${formatDateTime(d.aprobadoAt)}` : ''}.</p>}
                  </div>
                )}

                {d.notas.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {d.notas.map((n) => (
                      <li key={n.id} className="flex flex-wrap gap-2">
                        <span className="text-caption text-muted-foreground">{formatDateTime(n.createdAt)} · {n.actor?.name ?? 'sistema'}</span>
                        <span>{n.texto}</span>
                        {n.documentoPath && (
                          <a href={n.documentoPath} target="_blank" rel="noreferrer" className="underline">
                            documento
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {abierta && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {siguientes.length > 0 && (
                      <FormAccion
                        accion={moverDiscrepanciaAction}
                        ocultos={{ discrepanciaId: d.id, conciliacionId: c.id }}
                        etiqueta="Aplicar"
                        recargar
                        campos={[
                          { name: 'hasta', label: 'Pasar a', tipo: 'select', opciones: siguientes.map((e) => ({ value: e, label: SUPPLY_DISCREPANCIA_ESTADO_LABELS[e] })) },
                          { name: 'resolucion', label: 'Resolución (para resolver, ajustar o rechazar)', tipo: 'textarea', maxLength: 2000 },
                          { name: 'ajusteLado', label: 'Ajuste: lado', tipo: 'select', opciones: [{ value: 'CXP', label: 'Membego paga (CxP)' }, { value: 'CXC', label: 'Proveedor paga (CxC)' }] },
                          { name: 'ajusteMonto', label: 'Ajuste: monto (solo al ajustar)', tipo: 'number', min: 0.01 },
                        ]}
                      />
                    )}
                    <FormAccion
                      accion={agregarNotaDiscrepanciaAction}
                      ocultos={{ discrepanciaId: d.id, conciliacionId: c.id }}
                      etiqueta="Agregar nota"
                      variant="secondary"
                      recargar
                      campos={[
                        { name: 'texto', label: 'Nota', tipo: 'textarea', maxLength: 2000 },
                        { name: 'documentoPath', label: 'Documento (ruta)', maxLength: 500 },
                      ]}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Dato t="Abrió" v={`${c.creadoPor?.name ?? '—'} · ${formatDateTime(c.createdAt)}`} />
            <Dato t="Cerró" v={c.cerradaAt ? `${c.cerradoPor?.name ?? '—'} · ${formatDateTime(c.cerradaAt)}` : '—'} />
            <Dato t="Documentos" v={c.documentos.length ? c.documentos.join(', ') : '—'} />
            <Dato t="Notas" v={c.notas ?? '—'} />
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{t}</dt>
      <dd>{v}</dd>
    </div>
  )
}
