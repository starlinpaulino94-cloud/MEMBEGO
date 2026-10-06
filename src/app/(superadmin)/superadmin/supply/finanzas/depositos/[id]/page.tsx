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
import { FormConfirmar } from '@/components/supply/form-confirmar-pago'
import { fichaDeposito } from '@/modules/supply/depositos'
import { cuentasPorPagarAbiertas } from '@/modules/supply/opciones'
import { aplicarDepositoAction, cerrarDepositoAction, devolverDepositoAction } from '@/modules/supply/actions-finanzas'
import { saldoDisponibleDeposito } from '@/modules/supply/dinero'
import { DEPOSITO_VIVO, SUPPLY_DEPOSITO_ESTADO_LABELS, SUPPLY_DEPOSITO_MOVIMIENTO_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'

/**
 * Ficha de un depósito: saldo, movimientos y las tres acciones (aplicar a
 * una cuenta por pagar, registrar devolución, cerrar). Los movimientos son el
 * libro: el saldo se explica leyéndolos de arriba abajo.
 */
export default async function DepositoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const d = await fichaDeposito(id)
  if (!d) notFound()

  const m = { montoOriginal: Number(d.montoOriginal), montoAplicado: Number(d.montoAplicado), montoDevuelto: Number(d.montoDevuelto) }
  const vivo = DEPOSITO_VIVO.includes(d.estado)
  const disponible = vivo ? saldoDisponibleDeposito(m) : 0
  const cuentas = vivo ? await cuentasPorPagarAbiertas(d.proveedor.id) : []

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Depósito ${d.codigo}`}
        description={`${d.proveedor.name}${d.acuerdo ? ` · acuerdo ${d.acuerdo.codigo}` : ''} · ${SUPPLY_DEPOSITO_ESTADO_LABELS[d.estado]}`}
        eyebrow={
          <Link href="/superadmin/supply/finanzas/depositos" className="hover:underline">
            ← Depósitos
          </Link>
        }
        nav={<NavFinanzas activa="depositos" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Original" value={formatMoneyRD(m.montoOriginal)} sub={d.abiertoAt ? `abierto ${formatDate(d.abiertoAt)}` : 'sin abrir'} />
        <StatCard label="Aplicado" value={formatMoneyRD(m.montoAplicado)} />
        <StatCard label="Devuelto" value={formatMoneyRD(m.montoDevuelto)} />
        <StatCard label="Disponible" value={formatMoneyRD(disponible)} accent={disponible > 0 ? 'brand' : undefined} sub={d.cierraAt ? `cierra ${formatDate(d.cierraAt)}` : undefined} />
      </div>

      {d.estado === 'PENDIENTE' && d.pago && (
        <Card className="border-warning/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm">
              El pago que fondea este depósito sigue <strong>pendiente</strong>
              {d.pago.referencia ? ` (ref. ${d.pago.referencia})` : ''}. Confirmarlo abre el saldo y asienta la salida en el ledger.
            </p>
            <FormConfirmar pagoId={d.pago.id} />
          </CardContent>
        </Card>
      )}

      {vivo && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aplicar a una cuenta por pagar</CardTitle>
            </CardHeader>
            <CardContent>
              {cuentas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este proveedor no tiene cuentas por pagar abiertas fuera de una liquidación.</p>
              ) : (
                <FormAccion
                  accion={aplicarDepositoAction}
                  ocultos={{ depositoId: d.id }}
                  etiqueta="Aplicar"
                  recargar
                  campos={[
                    { name: 'cuentaPorPagarId', label: 'Cuenta', tipo: 'select', opciones: cuentas, required: true },
                    { name: 'monto', label: 'Monto', tipo: 'number', min: 0.01, max: disponible, required: true, ayuda: `Hasta ${formatMoneyRD(disponible)}.` },
                  ]}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registrar devolución</CardTitle>
            </CardHeader>
            <CardContent>
              <FormAccion
                accion={devolverDepositoAction}
                ocultos={{ depositoId: d.id }}
                etiqueta="Registrar devolución"
                recargar
                confirmar="Registra que el proveedor devolvió este dinero (crea un reembolso confirmado). ¿Continuar?"
                campos={[
                  { name: 'monto', label: 'Monto devuelto', tipo: 'number', min: 0.01, max: disponible, required: true },
                  { name: 'referencia', label: 'Referencia', maxLength: 200 },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cerrar</CardTitle>
            </CardHeader>
            <CardContent>
              <FormAccion
                accion={cerrarDepositoAction}
                ocultos={{ depositoId: d.id }}
                etiqueta="Cerrar depósito"
                variant="outline"
                recargar
                confirmar={disponible > 0 ? `Quedan ${formatMoneyRD(disponible)} sin aplicar ni devolver. ¿Cerrar de todas formas?` : '¿Cerrar este depósito?'}
                campos={[{ name: 'motivo', label: 'Motivo', required: true, maxLength: 500 }]}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo={`Movimientos del depósito ${d.codigo}`}
            columnas={[
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
              { clave: 'antes', titulo: 'Saldo antes', alinearDerecha: true },
              { clave: 'despues', titulo: 'Saldo después', alinearDerecha: true },
              { clave: 'contra', titulo: 'Contra' },
              { clave: 'actor', titulo: 'Quién' },
              { clave: 'motivo', titulo: 'Motivo / referencia' },
            ]}
            filas={d.movimientos.map((mv) => ({
              __clave: mv.id,
              fecha: formatDateTime(mv.createdAt),
              tipo: <Badge variant="outline">{SUPPLY_DEPOSITO_MOVIMIENTO_LABELS[mv.tipo]}</Badge>,
              monto: formatMoneyRD(Number(mv.monto)),
              antes: formatMoneyRD(Number(mv.saldoAntes)),
              despues: <strong>{formatMoneyRD(Number(mv.saldoDespues))}</strong>,
              contra: mv.cuentaPorPagar?.codigo ?? mv.factura?.codigo ?? mv.liquidacion?.codigo ?? '—',
              actor: mv.actor?.name ?? 'sistema',
              motivo: [mv.motivo, mv.referencia].filter(Boolean).join(' · ') || '—',
            }))}
            vacio="Sin movimientos todavía."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Dato t="Registró" v={d.registradoPor?.name ?? '—'} />
            <Dato t="Aprobó" v={d.aprobadoPor?.name ?? '—'} />
            <Dato t="Referencia" v={d.referencia ?? '—'} />
            <Dato t="Moneda" v={d.moneda} />
            <Dato t="Cerrado" v={d.cerradoAt ? `${formatDate(d.cerradoAt)} · ${d.cerradoMotivo ?? ''}` : '—'} />
            <Dato t="Documentos" v={d.documentos.length ? d.documentos.join(', ') : '—'} />
            <Dato t="Notas" v={d.notas ?? '—'} />
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
