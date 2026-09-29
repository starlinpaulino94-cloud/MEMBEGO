import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavFinanzas } from '@/components/supply/nav'
import { FormAccion } from '@/components/supply/form-accion'
import { fichaLiquidacion } from '@/modules/supply/liquidaciones'
import {
  moverLiquidacionAction,
  pagarLiquidacionAction,
  recalcularLiquidacionAction,
} from '@/modules/supply/actions-finanzas'
import { TRANSICIONES_LIQUIDACION } from '@/modules/supply/estados'
import { SUPPLY_LIQUIDACION_ESTADO_LABELS, SUPPLY_LIQUIDACION_LINEA_LABELS } from '@/modules/supply/catalogo'
import { varianteLiquidacion } from '@/components/supply/variantes'

export const dynamic = 'force-dynamic'

/**
 * Ficha de una liquidación: el snapshot, sus líneas y las acciones que la
 * máquina de estados permite desde donde está. Quien la aprueba no puede ser
 * quien la calculó; el servidor lo comprueba, aquí solo se avisa.
 */
export default async function LiquidacionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const l = await fichaLiquidacion(id)
  if (!l) notFound()

  const siguientes = TRANSICIONES_LIQUIDACION[l.estado].filter((e) => e !== 'PAGADA' && e !== 'CALCULADA' && e !== 'BORRADOR')
  const puedeRecalcular = l.estado === 'CALCULADA' || l.estado === 'EN_REVISION' || l.estado === 'DISPUTADA'
  const puedePagar = l.estado === 'APROBADA'
  const neto = Number(l.netoLiquidar)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Liquidación ${l.codigo}`}
        description={`${l.proveedor.name}${l.acuerdo ? ` · acuerdo ${l.acuerdo.codigo} v${l.acuerdo.version}` : ' · todos los acuerdos'} · ${formatDate(l.periodoDesde)} → ${formatDate(l.periodoHasta)}`}
        eyebrow={
          <Link href="/superadmin/supply/finanzas/liquidaciones" className="hover:underline">
            ← Liquidaciones
          </Link>
        }
        nav={<NavFinanzas activa="liquidaciones" />}
        action={<Badge variant={varianteLiquidacion(l.estado)}>{SUPPLY_LIQUIDACION_ESTADO_LABELS[l.estado]}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ventas brutas" value={formatMoneyRD(Number(l.ventasBrutas))} sub={`${l.ventas} ventas · comisión ${formatMoneyRD(Number(l.comisionMembego))}`} />
        <StatCard label="A favor del proveedor" value={formatMoneyRD(Number(l.montoProveedor) + Number(l.redencionesMonto))} sub={`${l.redenciones} redenciones · ${formatMoneyRD(Number(l.redencionesMonto))}`} />
        <StatCard label="A favor de Membego" value={formatMoneyRD(Number(l.reembolsos))} sub={`ajustes ${formatMoneyRD(Number(l.ajustes))}`} />
        <StatCard label="Neto a liquidar" value={formatMoneyRD(neto)} sub={Number(l.depositoAplicado) > 0 ? `tras aplicar ${formatMoneyRD(Number(l.depositoAplicado))} de depósito` : neto < 0 ? 'el proveedor paga a Membego' : undefined} accent={neto < 0 ? 'danger' : 'brand'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ciclo de vida</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {siguientes.length === 0 && !puedePagar ? (
              <p className="text-sm text-muted-foreground">Esta liquidación llegó al final de su vida.</p>
            ) : (
              <>
                {siguientes.length > 0 && (
                  <FormAccion
                    accion={moverLiquidacionAction}
                    ocultos={{ liquidacionId: l.id }}
                    etiqueta="Aplicar"
                    recargar
                    campos={[
                      { name: 'hasta', label: 'Pasar a', tipo: 'select', opciones: siguientes.map((e) => ({ value: e, label: SUPPLY_LIQUIDACION_ESTADO_LABELS[e] })) },
                      { name: 'motivo', label: 'Motivo (obligatorio para disputar o cancelar)', maxLength: 500 },
                    ]}
                  />
                )}
                {l.calculadaPor && (
                  <p className="text-caption text-muted-foreground">Calculó {l.calculadaPor.name}; otra persona tiene que aprobarla.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recalcular</CardTitle>
          </CardHeader>
          <CardContent>
            {puedeRecalcular ? (
              <FormAccion
                accion={recalcularLiquidacionAction}
                ocultos={{ liquidacionId: l.id }}
                etiqueta="Recalcular"
                variant="secondary"
                recargar
                nota="Libera las líneas y vuelve a reclamar lo pendiente del período."
                campos={[{ name: 'aplicarDeposito', label: 'Consumir depósitos vivos', tipo: 'checkbox', defaultValue: Number(l.depositoAplicado) > 0 ? 'on' : '' }]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Solo se recalcula antes de aprobarla.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pagar</CardTitle>
          </CardHeader>
          <CardContent>
            {puedePagar ? (
              <FormAccion
                accion={pagarLiquidacionAction}
                ocultos={{ liquidacionId: l.id }}
                etiqueta={neto < 0 ? 'Registrar cobro al proveedor' : 'Registrar pago'}
                recargar
                confirmar={`Asienta ${formatMoneyRD(Math.abs(neto))} ${neto < 0 ? 'recibidos del proveedor' : 'transferidos al proveedor'} y salda cada cuenta del corte. ¿Continuar?`}
                campos={[
                  { name: 'metodo', label: 'Método', placeholder: 'Transferencia', maxLength: 100 },
                  { name: 'referencia', label: 'Referencia', maxLength: 200 },
                ]}
              />
            ) : l.pago ? (
              <p className="text-sm">
                Pagada el {l.pagadaAt ? formatDateTime(l.pagadaAt) : '—'}
                {l.pago.referencia ? ` · ref. ${l.pago.referencia}` : ''} · {formatMoneyRD(Number(l.pago.monto))}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Se paga cuando esté aprobada.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Líneas del corte</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo={`Líneas de ${l.codigo}`}
            columnas={[
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'referencia', titulo: 'Referencia' },
              { clave: 'descripcion', titulo: 'Descripción' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
            ]}
            filas={l.lineas.map((x) => ({
              __clave: x.id,
              tipo: <Badge variant="outline">{SUPPLY_LIQUIDACION_LINEA_LABELS[x.tipo]}</Badge>,
              referencia: x.referencia,
              descripcion: x.descripcion,
              monto: <span className={Number(x.monto) < 0 ? 'text-destructive' : undefined}>{formatMoneyRD(Number(x.monto))}</span>,
            }))}
            total={{ tipo: 'Neto', referencia: '', descripcion: '', monto: <strong>{formatMoneyRD(neto)}</strong> }}
            vacio="Sin líneas: no había nada pendiente en el período."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Dato t="Calculada" v={`${l.calculadaAt ? formatDateTime(l.calculadaAt) : '—'}${l.calculadaPor ? ` · ${l.calculadaPor.name}` : ''}`} />
            <Dato t="Aprobada" v={`${l.aprobadaAt ? formatDateTime(l.aprobadaAt) : '—'}${l.aprobadaPor ? ` · ${l.aprobadaPor.name}` : ''}`} />
            <Dato t="Pagada" v={l.pagadaAt ? formatDateTime(l.pagadaAt) : '—'} />
            <Dato t="Conciliada" v={l.conciliadaAt ? formatDateTime(l.conciliadaAt) : '—'} />
            <Dato t="Disputa" v={l.disputaMotivo ?? '—'} />
            <Dato t="Conciliaciones" v={l.conciliaciones.length ? l.conciliaciones.map((c) => `${c.codigo} (${c.estado})`).join(', ') : '—'} />
            <Dato t="Notas" v={l.notas ?? '—'} />
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
