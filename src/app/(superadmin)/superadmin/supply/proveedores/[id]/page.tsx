import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { reporteLotes, reporteProveedores } from '@/modules/supply/pool'
import { asientosDeProveedor, saldoDeProveedor } from '@/modules/supply/finanzas'
import { conciliar } from '@/modules/supply/conciliacion'
import { SUPPLY_ASIENTO_TIPO_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY · REPORTE DE PROVEEDOR (Fase 49).
 *
 * Es el documento con el que se sienta uno a hablar con la empresa: cuántas
 * unidades se contrataron, cuántas se asignaron, cuántas se emitieron, cuántas
 * se entregaron y cuánto se le debe. Todo desde el mismo ledger que el comercio
 * consulta en su portal, así que la conversación es sobre una operación
 * concreta y no sobre dos bases de datos distintas.
 */
export default async function ProveedorDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const [ficha, lotes, financiero, conciliacion] = await Promise.all([
    reporteProveedores({ proveedorId: id }).then((f) => f[0] ?? null),
    reporteLotes({ proveedorId: id }),
    sinEmpresa('Membego Supply: dinero con un proveedor', async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id }, select: { id: true, name: true } })
      if (!empresa) return null
      return {
        empresa,
        saldo: await saldoDeProveedor(tx, id),
        asientos: await asientosDeProveedor(tx, id, 60),
      }
    }),
    conciliar(id),
  ])

  if (!financiero) notFound()
  const { empresa, saldo, asientos } = financiero

  return (
    <div className="space-y-6">
      <PageHeader
        title={empresa.name}
        description="Reporte completo del proveedor: supply contratado, cumplimiento y dinero."
        eyebrow={
          <Link href="/superadmin/supply/proveedores" className="hover:underline">
            Proveedores
          </Link>
        }
        nav={<NavSupply activa="proveedores" />}
      />

      {ficha && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Contratadas"
            value={ficha.compradas.toLocaleString('es-DO')}
            sub={formatMoneyRD(ficha.costoTotal)}
            accent="brand"
          />
          <StatCard
            label="Entregadas"
            value={ficha.redimidas.toLocaleString('es-DO')}
            sub={formatMoneyRD(ficha.costoConsumido)}
            accent="success"
          />
          <StatCard
            label="En manos de clientes"
            value={ficha.pendientesCliente.toLocaleString('es-DO')}
            sub="vouchers activos sin canjear"
          />
          <StatCard
            label="Puntaje"
            value={ficha.scorecard.puntaje}
            sub={`${ficha.scorecard.tasaCumplimiento}% de cumplimiento`}
            accent={ficha.scorecard.puntaje >= 85 ? 'success' : 'warning'}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cumplimiento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ficha ? (
              <>
                <Linea label="Acuerdos" valor={String(ficha.acuerdos)} />
                <Linea label="Unidades contratadas" valor={ficha.compradas.toLocaleString('es-DO')} />
                <Linea label="Asignadas a campañas" valor={ficha.asignadas.toLocaleString('es-DO')} />
                <Linea label="Sin asignar" valor={ficha.sinAsignar.toLocaleString('es-DO')} />
                <Linea label="Emitidas" valor={ficha.emitidas.toLocaleString('es-DO')} />
                <Linea label="Redimidas" valor={ficha.redimidas.toLocaleString('es-DO')} />
                <Linea label="Reversadas" valor={String(ficha.scorecard.reversadas)} />
                <Linea label="Incidencias" valor={String(ficha.scorecard.incidencias)} />
                <Linea
                  label="Incumplimientos"
                  valor={`${ficha.scorecard.incumplimientos} (${ficha.scorecard.tasaIncumplimiento}%)`}
                />
              </>
            ) : (
              <p className="text-muted-foreground">Este proveedor todavía no tiene supply.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dinero</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Linea label="Contratado (memorando)" valor={formatMoneyRD(saldo.contratado)} />
            <Linea label="Depositado" valor={formatMoneyRD(saldo.depositado)} />
            <Linea label="Devengado por redención" valor={formatMoneyRD(saldo.devengado)} />
            <Linea label="Pagado" valor={formatMoneyRD(saldo.pagado)} />
            <Linea label="Reembolsos" valor={formatMoneyRD(saldo.reembolsos)} />
            <Linea label="Créditos" valor={formatMoneyRD(saldo.creditos)} />
            <div className="border-t border-border pt-2">
              <Linea label="Saldo por pagar" valor={formatMoneyRD(saldo.saldoPorPagar)} destacado />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={conciliacion.cuadra ? undefined : 'border-destructive/30'}>
        <CardHeader>
          <CardTitle>Conciliación</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {conciliacion.cuadra ? (
            <p className="text-success">
              Los {conciliacion.lotesRevisados} lotes de este proveedor cuadran contra su ledger.
            </p>
          ) : (
            <>
              <p className="text-destructive">
                {conciliacion.hallazgos.length} hallazgo(s): {conciliacion.criticos} críticos,{' '}
                {conciliacion.altos} altos.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-muted-foreground">
                {conciliacion.hallazgos.slice(0, 5).map((h, i) => (
                  <li key={i}>
                    <strong>{h.titulo}</strong> — {h.detalle}
                  </li>
                ))}
              </ul>
              <Link
                href="/superadmin/supply/conciliacion"
                className="mt-2 inline-block text-caption underline underline-offset-4"
              >
                Abrir conciliación
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lotes</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Lotes de este proveedor"
            columnas={[
              { clave: 'codigo', titulo: 'Lote' },
              { clave: 'item', titulo: 'Producto' },
              { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
              { clave: 'disponibles', titulo: 'Disponibles', alinearDerecha: true },
              { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
              { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
              { clave: 'vence', titulo: 'Vence' },
              { clave: 'cuadra', titulo: 'Cuadra' },
            ]}
            filas={lotes.map((l) => ({
              __clave: l.id,
              codigo: (
                <Link
                  href={`/superadmin/supply/lotes/${l.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {l.codigo}
                </Link>
              ),
              item: l.item,
              compradas: l.compradas.toLocaleString('es-DO'),
              disponibles: l.disponibles.toLocaleString('es-DO'),
              emitidas: l.emitidas.toLocaleString('es-DO'),
              redimidas: l.redimidas.toLocaleString('es-DO'),
              vence: formatDate(l.venceAt),
              cuadra: l.cuadra ? (
                <Badge variant="success">Sí</Badge>
              ) : (
                <Badge variant="destructive">No</Badge>
              ),
            }))}
            vacio="Sin lotes."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger financiero</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Asientos financieros del proveedor"
            columnas={[
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'acuerdo', titulo: 'Acuerdo' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
              { clave: 'motivo', titulo: 'Motivo' },
            ]}
            filas={asientos.map((a) => ({
              __clave: a.id,
              fecha: formatDate(a.createdAt),
              acuerdo: a.acuerdo?.codigo ?? '—',
              tipo: SUPPLY_ASIENTO_TIPO_LABELS[a.tipo],
              monto: formatMoneyRD(Number(a.monto)),
              motivo: a.motivo ?? a.referencia ?? '—',
            }))}
            vacio="Sin movimientos financieros."
          />
        </CardContent>
      </Card>
    </div>
  )
}

function Linea({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={destacado ? 'font-semibold tabular-nums' : 'tabular-nums'}>{valor}</span>
    </div>
  )
}
