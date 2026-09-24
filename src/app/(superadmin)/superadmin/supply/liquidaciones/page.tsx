import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { saldoDeProveedor } from '@/modules/supply/finanzas'
import { FormPago } from '@/components/supply/form-pago'
import { FormConfirmar } from '@/components/supply/form-confirmar-pago'
import {
  SUPPLY_ASIENTO_TIPO_LABELS,
  SUPPLY_MODALIDAD_PAGO_LABELS,
  SUPPLY_PAGO_TIPO_LABELS,
} from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidaciones a proveedores' }

/**
 * MEMBEGO SUPPLY · dinero con los proveedores (Fases 33, 34).
 *
 * El saldo de cada proveedor es la SUMA DE SUS ASIENTOS, calculada aquí mismo.
 * No hay un campo `saldo` guardado: sería el mismo problema que
 * `remaining = 742` un piso más arriba —un número que alguien puede editar y
 * que nadie puede explicar— pero con dinero real.
 *
 * «Contratado» aparece separado del saldo por pagar a propósito: firmar un
 * contrato de RD$300.000 no es deber RD$300.000 hoy. En pago por redención no
 * se debe nada hasta que alguien consuma.
 */
export default async function LiquidacionesPage() {
  await requireRole('SUPERADMIN')

  const datos = await sinEmpresa('Membego Supply: liquidaciones con proveedores', async (tx) => {
    const acuerdos = await tx.supplyAcuerdo.findMany({
      where: { estado: { in: ['ACTIVO', 'APROBADO', 'COMPLETADO', 'VENCIDO'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        codigo: true,
        modalidadPago: true,
        moneda: true,
        cantidad: true,
        costoUnitario: true,
        proveedor: { select: { id: true, name: true } },
      },
    })

    const filas = await Promise.all(
      acuerdos.map(async (a) => ({
        acuerdo: a,
        saldo: await saldoDeProveedor(tx, a.proveedor.id, a.id),
        redenciones: await tx.supplyRedencion.count({
          where: { acuerdoId: a.id, reversadaAt: null },
        }),
      }))
    )

    const pagos = await tx.supplyPago.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        tipo: true,
        monto: true,
        estado: true,
        referencia: true,
        createdAt: true,
        confirmadoAt: true,
        proveedor: { select: { name: true } },
        acuerdo: { select: { codigo: true } },
        registradoPor: { select: { name: true } },
      },
    })

    const asientos = await tx.supplyAsientoFinanciero.findMany({
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: {
        id: true,
        tipo: true,
        monto: true,
        motivo: true,
        createdAt: true,
        proveedor: { select: { name: true } },
        acuerdo: { select: { codigo: true } },
      },
    })

    return { filas, pagos, asientos }
  })

  const porPagar = datos.filas.reduce((t, f) => t + f.saldo.saldoPorPagar, 0)
  const depositado = datos.filas.reduce((t, f) => t + f.saldo.depositado, 0)
  const contratado = datos.filas.reduce((t, f) => t + f.saldo.contratado, 0)
  const pendientes = datos.pagos.filter((p) => p.estado === 'PENDIENTE')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liquidaciones"
        description="Cuánto se contrató, cuánto se depositó, cuánto se devengó por consumo y cuánto se le debe hoy a cada proveedor."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="liquidaciones" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Contratado" value={formatMoneyRD(contratado)} sub="memorando, no deuda" />
        <StatCard label="Depositado" value={formatMoneyRD(depositado)} accent="brand" />
        <StatCard
          label="Saldo por pagar"
          value={formatMoneyRD(porPagar)}
          accent={porPagar > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Pagos sin confirmar"
          value={pendientes.length}
          sub={formatMoneyRD(pendientes.reduce((t, p) => t + Number(p.monto), 0))}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Saldo por acuerdo</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Saldos con proveedores"
            columnas={[
              { clave: 'acuerdo', titulo: 'Acuerdo' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'modalidad', titulo: 'Modalidad' },
              { clave: 'contratado', titulo: 'Contratado', alinearDerecha: true },
              { clave: 'redenciones', titulo: 'Redenciones', alinearDerecha: true },
              { clave: 'devengado', titulo: 'Devengado', alinearDerecha: true },
              { clave: 'depositado', titulo: 'Depositado', alinearDerecha: true },
              { clave: 'pagado', titulo: 'Pagado', alinearDerecha: true },
              { clave: 'saldo', titulo: 'Por pagar', alinearDerecha: true },
            ]}
            filas={datos.filas.map((f) => ({
              __clave: f.acuerdo.id,
              acuerdo: (
                <Link
                  href={`/superadmin/supply/acuerdos/${f.acuerdo.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {f.acuerdo.codigo}
                </Link>
              ),
              proveedor: f.acuerdo.proveedor.name,
              modalidad: SUPPLY_MODALIDAD_PAGO_LABELS[f.acuerdo.modalidadPago],
              contratado: formatMoneyRD(f.saldo.contratado),
              redenciones: f.redenciones.toLocaleString('es-DO'),
              devengado: formatMoneyRD(f.saldo.devengado),
              depositado: formatMoneyRD(f.saldo.depositado),
              pagado: formatMoneyRD(f.saldo.pagado),
              saldo: (
                <strong className={f.saldo.saldoPorPagar > 0 ? 'text-warning' : undefined}>
                  {formatMoneyRD(f.saldo.saldoPorPagar)}
                </strong>
              ),
            }))}
            vacio="Sin acuerdos activos."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registrar un pago</CardTitle>
        </CardHeader>
        <CardContent>
          <FormPago
            acuerdos={datos.filas.map((f) => ({
              id: f.acuerdo.id,
              codigo: f.acuerdo.codigo,
              proveedor: f.acuerdo.proveedor.name,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pagos</CardTitle>
        </CardHeader>
        <CardContent>
          <TablaReporte
            titulo="Pagos a proveedores"
            columnas={[
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'acuerdo', titulo: 'Acuerdo' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
              { clave: 'referencia', titulo: 'Referencia' },
              { clave: 'registrado', titulo: 'Registró' },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={datos.pagos.map((p) => ({
              __clave: p.id,
              fecha: formatDate(p.createdAt),
              acuerdo: p.acuerdo.codigo,
              proveedor: p.proveedor.name,
              tipo: SUPPLY_PAGO_TIPO_LABELS[p.tipo],
              monto: formatMoneyRD(Number(p.monto)),
              referencia: p.referencia ?? '—',
              registrado: p.registradoPor?.name ?? '—',
              estado:
                p.estado === 'CONFIRMADO' ? (
                  <Badge variant="success">Confirmado</Badge>
                ) : (
                  <FormConfirmar pagoId={p.id} />
                ),
            }))}
            vacio="Todavía no se ha registrado ningún pago."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger financiero</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-caption text-muted-foreground">
            Monto positivo = a favor del proveedor (se le debe más). Negativo = a favor de Membego
            (un pago, un reembolso, una reversa). El saldo es la suma de estas filas.
          </p>
          <TablaReporte
            titulo="Asientos del ledger financiero"
            columnas={[
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'acuerdo', titulo: 'Acuerdo' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
              { clave: 'motivo', titulo: 'Motivo' },
            ]}
            filas={datos.asientos.map((a) => ({
              __clave: a.id,
              fecha: formatDate(a.createdAt),
              proveedor: a.proveedor.name,
              acuerdo: a.acuerdo?.codigo ?? '—',
              tipo: SUPPLY_ASIENTO_TIPO_LABELS[a.tipo],
              monto: (
                <span className={Number(a.monto) < 0 ? 'text-muted-foreground' : undefined}>
                  {formatMoneyRD(Number(a.monto))}
                </span>
              ),
              motivo: a.motivo ?? '—',
            }))}
            vacio="Sin asientos."
          />
        </CardContent>
      </Card>
    </div>
  )
}
