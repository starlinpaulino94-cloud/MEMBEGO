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
import { SUPPLY_ASIENTO_TIPO_LABELS, SUPPLY_PROVEEDOR_ORIGEN_LABELS } from '@/modules/supply/catalogo'
import { kpisDeProveedor, perfilDeProveedor } from '@/modules/supply/proveedores'
import { listarConciliaciones } from '@/modules/supply/conciliacion-proveedor'
import { listarVentas } from '@/modules/supply/ventas'
import { SUPPLY_CONCILIACION_ESTADO_LABELS, SUPPLY_INCIDENCIA_ESTADO_LABELS, SUPPLY_INCIDENCIA_TIPO_LABELS, SUPPLY_ORDEN_ESTADO_LABELS, SUPPLY_VENTA_ESTADO_LABELS } from '@/modules/supply/catalogo'
import { formatDateTime } from '@/lib/format'
import { FormAccion } from '@/components/supply/form-accion'
import { convertirProveedorAction, guardarPerfilProveedorAction } from '@/modules/supply/actions-finanzas'
import { listarCuentasPorPagar } from '@/modules/supply/cuentas'
import { listarLiquidaciones } from '@/modules/supply/liquidaciones'
import { listarDepositos } from '@/modules/supply/depositos'
import { SUPPLY_CUENTA_ESTADO_LABELS, SUPPLY_DEPOSITO_ESTADO_LABELS, SUPPLY_LIQUIDACION_ESTADO_LABELS } from '@/modules/supply/catalogo'

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

  const [ficha, lotes, financiero, conciliacion, perfil, cuentas, liquidaciones, depositos, kpis, conciliaciones, ventas, operacion] = await Promise.all([
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
    perfilDeProveedor(id),
    listarCuentasPorPagar({ proveedorId: id, limite: 40 }),
    listarLiquidaciones({ proveedorId: id, limite: 20 }),
    listarDepositos({ proveedorId: id, limite: 20 }),
    kpisDeProveedor(id),
    listarConciliaciones({ proveedorId: id, limite: 10 }),
    listarVentas({ proveedorId: id, limite: 10 }),
    sinEmpresa('Membego Supply: operación reciente de un proveedor', async (tx) => {
      const [ordenes, redenciones, incidencias, ingresos] = await Promise.all([
        tx.supplyOrden.findMany({ where: { proveedorId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, numero: true, estado: true, total: true, montoPagado: true, createdAt: true, acuerdo: { select: { codigo: true } } } }),
        tx.supplyRedencion.findMany({ where: { proveedorId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, createdAt: true, reversadaAt: true, costoUnitario: true, cliente: { select: { nombre: true } }, sucursal: { select: { nombre: true } }, voucher: { select: { derecho: { select: { lote: { select: { snapshotItemNombre: true } } } } } } } }),
        tx.supplyIncidencia.findMany({ where: { proveedorId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, tipo: true, estado: true, detalle: true, createdAt: true } }),
        tx.supplyDerecho.aggregate({ where: { proveedorId: id, estado: 'REDIMIDO' }, _sum: { precioCliente: true } }),
      ])
      return { ordenes, redenciones, incidencias, ingresosClientes: Number(ingresos._sum.precioCliente ?? 0) }
    }),
  ])

  if (!financiero) notFound()
  const esExterna = perfil ? perfil.origen === 'EXTERNA' && !perfil.company.isActive : false
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total comprado" value={formatMoneyRD(kpis.totalComprado)} sub={`pagado ${formatMoneyRD(kpis.totalPagado)}`} />
        <StatCard label="Supply disponible" value={kpis.unidadesDisponibles.toLocaleString('es-DO')} sub={formatMoneyRD(kpis.valorDisponible)} accent="brand" />
        <StatCard label="Consumido" value={kpis.unidadesConsumidas.toLocaleString('es-DO')} sub={formatMoneyRD(kpis.valorConsumido)} accent="success" />
        <StatCard label="Vencido / cancelado" value={kpis.unidadesVencidas.toLocaleString('es-DO')} sub={formatMoneyRD(kpis.valorVencido)} accent={kpis.unidadesVencidas > 0 ? 'warning' : undefined} />
        <StatCard label="Incidencias abiertas" value={kpis.incidenciasAbiertas} sub={`${kpis.redenciones} redenciones`} accent={kpis.incidenciasAbiertas > 0 ? 'danger' : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Membego le debe" value={formatMoneyRD(kpis.deudaMembego)} accent={kpis.deudaMembego > 0 ? 'warning' : undefined} href={`/superadmin/supply/finanzas/cuentas-por-pagar?proveedor=${id}`} hrefLabel="Cuentas por pagar" />
        <StatCard label="Le debe a Membego" value={formatMoneyRD(kpis.deudaProveedor)} href={`/superadmin/supply/finanzas/cuentas-por-cobrar?proveedor=${id}`} hrefLabel="Cuentas por cobrar" />
        <StatCard label="Ventas a comisión" value={formatMoneyRD(kpis.ventasBruto)} sub={`${kpis.ventasEntregadas} entregadas · comisión ${formatMoneyRD(kpis.comisionMembego)}`} />
        <StatCard label="Rentabilidad" value={formatMoneyRD(operacion.ingresosClientes + kpis.comisionMembego - kpis.valorConsumido)} sub={`ingresos ${formatMoneyRD(operacion.ingresosClientes + kpis.comisionMembego)} − costo consumido ${formatMoneyRD(kpis.valorConsumido)}`} accent={operacion.ingresosClientes + kpis.comisionMembego - kpis.valorConsumido >= 0 ? 'success' : 'danger'} />
      </div>

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
          <CardTitle className="flex flex-wrap items-center gap-2">
            Perfil de proveedor
            {perfil && <Badge variant={esExterna ? 'outline' : 'secondary'}>{SUPPLY_PROVEEDOR_ORIGEN_LABELS[perfil.origen]}</Badge>}
            {perfil && !perfil.activo && <Badge variant="destructive">Inactivo</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormAccion
            accion={guardarPerfilProveedorAction}
            ocultos={{ companyId: id }}
            etiqueta="Guardar perfil"
            campos={[
              { name: 'razonSocial', label: 'Razón social', maxLength: 200, defaultValue: perfil?.razonSocial ?? '' },
              { name: 'rnc', label: 'RNC', maxLength: 40, defaultValue: perfil?.rnc ?? '' },
              { name: 'contactoNombre', label: 'Contacto', maxLength: 120, defaultValue: perfil?.contactoNombre ?? '' },
              { name: 'contactoEmail', label: 'Correo', maxLength: 160, defaultValue: perfil?.contactoEmail ?? perfil?.company.email ?? '' },
              { name: 'contactoTelefono', label: 'Teléfono', maxLength: 40, defaultValue: perfil?.contactoTelefono ?? perfil?.company.telefono ?? '' },
              { name: 'plazoPagoDias', label: 'Plazo de pago (días)', tipo: 'number', step: '1', min: 0, defaultValue: perfil?.plazoPagoDias?.toString() ?? '' },
              { name: 'banco', label: 'Banco', maxLength: 120, defaultValue: perfil?.banco ?? '' },
              { name: 'cuentaBancaria', label: 'Cuenta bancaria', maxLength: 60, defaultValue: perfil?.cuentaBancaria ?? '' },
              { name: 'tipoCuenta', label: 'Tipo de cuenta', maxLength: 40, defaultValue: perfil?.tipoCuenta ?? '' },
              { name: 'activo', label: 'Proveedor activo (se le puede contratar)', tipo: 'checkbox', defaultValue: perfil?.activo === false ? '' : 'on' },
              { name: 'notas', label: 'Notas', tipo: 'textarea', defaultValue: perfil?.notas ?? '' },
            ]}
          />
          {esExterna && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm">
                Este proveedor es <strong>externo</strong>: no opera en Membego. Convertirlo activa la misma empresa (mismo id, mismos acuerdos, mismo ledger) para que entre al panel como comercio.
              </p>
              <FormAccion
                accion={convertirProveedorAction}
                ocultos={{ companyId: id }}
                etiqueta="Convertir en empresa registrada"
                variant="secondary"
                confirmar="Activa la empresa en Membego conservando todo su historial. ¿Continuar?"
                recargar
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cuentas por pagar</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'codigo', titulo: 'Cuenta' },
                { clave: 'pendiente', titulo: 'Pendiente', alinearDerecha: true },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={cuentas.slice(0, 10).map((c) => ({
                __clave: c.id,
                codigo: c.codigo,
                pendiente: formatMoneyRD(Number(c.montoNeto) - Number(c.montoSaldado)),
                estado: SUPPLY_CUENTA_ESTADO_LABELS[c.estado],
              }))}
              vacio="Sin cuentas por pagar."
            />
            <Link href={`/superadmin/supply/finanzas/cuentas-por-pagar?proveedor=${id}`} className="mt-2 inline-block text-caption underline underline-offset-4">
              Ver todas
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Liquidaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'codigo', titulo: 'Liquidación' },
                { clave: 'neto', titulo: 'Neto', alinearDerecha: true },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={liquidaciones.slice(0, 10).map((l) => ({
                __clave: l.id,
                codigo: (
                  <Link href={`/superadmin/supply/finanzas/liquidaciones/${l.id}`} className="underline-offset-4 hover:underline">
                    {l.codigo}
                  </Link>
                ),
                neto: formatMoneyRD(Number(l.netoLiquidar)),
                estado: SUPPLY_LIQUIDACION_ESTADO_LABELS[l.estado],
              }))}
              vacio="Sin liquidaciones."
            />
            <Link href={`/superadmin/supply/finanzas/liquidaciones?proveedor=${id}`} className="mt-2 inline-block text-caption underline underline-offset-4">
              Ver todas
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Depósitos</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'codigo', titulo: 'Depósito' },
                { clave: 'disponible', titulo: 'Disponible', alinearDerecha: true },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={depositos.slice(0, 10).map((d) => ({
                __clave: d.id,
                codigo: (
                  <Link href={`/superadmin/supply/finanzas/depositos/${d.id}`} className="underline-offset-4 hover:underline">
                    {d.codigo}
                  </Link>
                ),
                disponible: formatMoneyRD(d.disponible),
                estado: SUPPLY_DEPOSITO_ESTADO_LABELS[d.estado],
              }))}
              vacio="Sin depósitos."
            />
            <Link href={`/superadmin/supply/finanzas/depositos?proveedor=${id}`} className="mt-2 inline-block text-caption underline underline-offset-4">
              Ver todos
            </Link>
          </CardContent>
        </Card>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Órdenes de compra</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'numero', titulo: 'Orden' },
                { clave: 'acuerdo', titulo: 'Acuerdo' },
                { clave: 'total', titulo: 'Total', alinearDerecha: true },
                { clave: 'pagado', titulo: 'Pagado', alinearDerecha: true },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={operacion.ordenes.map((o) => ({
                __clave: o.id,
                numero: (
                  <Link href={`/superadmin/supply/ordenes/${o.id}`} className="underline-offset-4 hover:underline">
                    {o.numero}
                  </Link>
                ),
                acuerdo: o.acuerdo.codigo,
                total: formatMoneyRD(Number(o.total)),
                pagado: formatMoneyRD(Number(o.montoPagado)),
                estado: SUPPLY_ORDEN_ESTADO_LABELS[o.estado],
              }))}
              vacio="Sin órdenes de compra."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Redenciones recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'fecha', titulo: 'Cuándo' },
                { clave: 'cliente', titulo: 'Cliente' },
                { clave: 'producto', titulo: 'Producto' },
                { clave: 'sucursal', titulo: 'Sucursal' },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={operacion.redenciones.map((r) => ({
                __clave: r.id,
                fecha: formatDateTime(r.createdAt),
                cliente: r.cliente.nombre,
                producto: r.voucher.derecho.lote.snapshotItemNombre,
                sucursal: r.sucursal?.nombre ?? '—',
                estado: r.reversadaAt ? <Badge variant="destructive">Reversada</Badge> : <Badge variant="success">Entregada</Badge>,
              }))}
              vacio="Sin redenciones."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Incidencias</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              columnas={[
                { clave: 'fecha', titulo: 'Cuándo' },
                { clave: 'tipo', titulo: 'Tipo' },
                { clave: 'detalle', titulo: 'Detalle' },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={operacion.incidencias.map((i) => ({
                __clave: i.id,
                fecha: formatDate(i.createdAt),
                tipo: SUPPLY_INCIDENCIA_TIPO_LABELS[i.tipo],
                detalle: i.detalle.slice(0, 80),
                estado: SUPPLY_INCIDENCIA_ESTADO_LABELS[i.estado],
              }))}
              vacio="Sin incidencias."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conciliaciones y ventas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TablaReporte
              columnas={[
                { clave: 'codigo', titulo: 'Conciliación' },
                { clave: 'periodo', titulo: 'Período' },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={conciliaciones.map((c) => ({
                __clave: c.id,
                codigo: (
                  <Link href={`/superadmin/supply/conciliacion/${c.id}`} className="underline-offset-4 hover:underline">
                    {c.codigo}
                  </Link>
                ),
                periodo: `${formatDate(c.periodoDesde)} → ${formatDate(c.periodoHasta)}`,
                estado: SUPPLY_CONCILIACION_ESTADO_LABELS[c.estado],
              }))}
              vacio="Sin conciliaciones."
            />
            <TablaReporte
              columnas={[
                { clave: 'numero', titulo: 'Venta' },
                { clave: 'producto', titulo: 'Producto' },
                { clave: 'bruto', titulo: 'Bruto', alinearDerecha: true },
                { clave: 'estado', titulo: 'Estado' },
              ]}
              filas={ventas.map((v) => ({
                __clave: v.id,
                numero: v.numero,
                producto: `${v.itemNombre} × ${v.cantidad}`,
                bruto: formatMoneyRD(Number(v.montoBruto)),
                estado: SUPPLY_VENTA_ESTADO_LABELS[v.estado],
              }))}
              vacio="Sin ventas a comisión."
            />
          </CardContent>
        </Card>
      </div>

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
