import Link from 'next/link'
import { AlertTriangle, Boxes, Coins, PackageCheck, Ticket, TrendingDown } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { resumenPool, reporteProveedores } from '@/modules/supply/pool'
import { alertasDeVencimiento, vencimientosProximos } from '@/modules/supply/vencimientos'
import { actividadReciente, economiaGlobal, redencionesRecientes, resumenFinanciero, supplyPorCategoria } from '@/modules/supply/tablero'
import { sinEmpresa } from '@/lib/tenant'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Membego Supply' }

/**
 * MEMBEGO SUPPLY · tablero de la plataforma (Fases 7, 47).
 *
 * Contesta cuatro preguntas en el orden en que se hacen:
 *
 *   1. ¿Cuánto supply tengo y cuánto vale?
 *   2. ¿Cuánto está comprometido y cuánto ya se consumió?
 *   3. ¿Cuánto dinero está a punto de evaporarse?
 *   4. ¿Qué proveedores lo tienen y cómo están cumpliendo?
 *
 * EMITIDO y REDIMIDO salen como cifras SEPARADAS, siempre. Es la distinción
 * que el resto del panel hereda: un voucher entregado no es una pizza
 * entregada, y juntarlas haría que el costo de toda campaña estuviera inflado.
 */
export default async function SupplyResumenPage() {
  await requireRole('SUPERADMIN')

  const [pool, proveedores, alertas, fin, categorias, recientes, otrosVencimientos, eco, actividad] = await Promise.all([
    resumenPool(),
    reporteProveedores(),
    alertasDeVencimiento(30),
    resumenFinanciero(),
    supplyPorCategoria(),
    sinEmpresa('Membego Supply: últimas redenciones del tablero', (tx) => redencionesRecientes(tx, 8)),
    vencimientosProximos(30),
    economiaGlobal(),
    actividadReciente(12),
  ])

  const criticas = alertas.filter((a) => a.nivel === 'CRITICO' || a.nivel === 'ALTO')
  const otrosCriticos = otrosVencimientos.filter((v) => v.tipo !== 'DERECHO' && (v.nivel === 'CRITICO' || v.nivel === 'ALTO'))
  const hayAlgo = pool.unidadesCompradas > 0 || fin.acuerdosActivos > 0 || fin.ventasMes.ventas > 0 || fin.depositos.depositos > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membego Supply"
        description="Productos, servicios y capacidad que Membego compró por adelantado para regalar, vender, premiar o repartir."
        eyebrow="Plataforma"
        nav={<NavSupply activa="" />}
      />

      {/* Acciones principales (§38): el centro de gravedad es operar, no mirar. */}
      <div className="flex flex-wrap gap-2">
        <AccionRapida href="/superadmin/supply/proveedores#nuevo">Nuevo proveedor</AccionRapida>
        <AccionRapida href="/superadmin/supply/acuerdos#nuevo">Nuevo acuerdo</AccionRapida>
        <AccionRapida href="/superadmin/supply/ordenes#nueva">Nueva compra</AccionRapida>
        <AccionRapida href="/superadmin/supply/finanzas/depositos">Nuevo depósito</AccionRapida>
        <AccionRapida href="/superadmin/supply/lotes">Crear oferta / campaña</AccionRapida>
        <AccionRapida href="/superadmin/supply/derechos#emitir">Emitir beneficio</AccionRapida>
        <AccionRapida href="/superadmin/supply/finanzas/liquidaciones">Nueva liquidación</AccionRapida>
      </div>

      {!hayAlgo ? (
        <EmptyState
          variant="card"
          title="Todavía no hay supply comprado"
          description="Cuando Membego firme un acuerdo con una empresa y active su orden de compra, los derechos adquiridos aparecen aquí."
          action={
            <Link
              href="/superadmin/supply/proveedores#nuevo"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              1 · Agregar un proveedor
            </Link>
          }
          secondaryAction={
            <Link href="/superadmin/supply/acuerdos#nuevo" className="text-sm font-medium underline-offset-4 hover:underline">
              2 · Crear el primer acuerdo
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Valor adquirido"
              value={formatMoneyRD(pool.valorAdquirido)}
              sub={`${pool.unidadesCompradas.toLocaleString('es-DO')} unidades compradas`}
              icon={Coins}
              accent="brand"
            />
            <StatCard
              label="Valor consumido"
              value={formatMoneyRD(pool.valorConsumido)}
              sub={`${pool.redimidas.toLocaleString('es-DO')} unidades entregadas de verdad`}
              icon={PackageCheck}
              accent="success"
              href="/superadmin/supply/redenciones"
              hrefLabel="Ver las redenciones"
            />
            <StatCard
              label="Disponible sin asignar"
              value={formatMoneyRD(pool.valorDisponible)}
              sub={`${pool.disponibles.toLocaleString('es-DO')} unidades sin destino`}
              icon={Boxes}
              href="/superadmin/supply/lotes"
              hrefLabel="Ver los lotes"
            />
            <StatCard
              label="Valor en riesgo"
              value={formatMoneyRD(pool.valorEnRiesgo)}
              sub={`${pool.proximasAVencer.toLocaleString('es-DO')} unidades vencen en 30 días`}
              icon={TrendingDown}
              accent={pool.valorEnRiesgo > 0 ? 'warning' : undefined}
              href="/superadmin/supply/vencimientos"
              hrefLabel="Ver los vencimientos"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="size-4" aria-hidden />
                Dónde están las unidades
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/*
                Las seis cubetas del ledger, en el orden en que una unidad las
                recorre. Sumadas dan exactamente lo comprado: es el invariante
                del §3.2 enseñado como dato, no como promesa.
              */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Cubeta label="Disponibles" valor={pool.disponibles} />
                <Cubeta label="Asignadas a campañas" valor={pool.asignadas} />
                <Cubeta label="Retenidas" valor={pool.retenidas} />
                <Cubeta label="Emitidas sin canjear" valor={pool.emitidas} destacada />
                <Cubeta label="Redimidas" valor={pool.redimidas} destacada />
                <Cubeta label="Vencidas o canceladas" valor={pool.cerradas} />
              </div>
              <p className="mt-4 text-caption text-muted-foreground">
                Emitida no es entregada: las {pool.emitidas.toLocaleString('es-DO')} emitidas son
                vouchers en manos de clientes que todavía no costaron nada. Solo las{' '}
                {pool.redimidas.toLocaleString('es-DO')} redimidas son gasto real.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Capital comprometido"
              value={formatMoneyRD(fin.capitalInvertido)}
              sub={`lotes + ${formatMoneyRD(fin.depositos.disponible)} en depósitos`}
              href="/superadmin/supply/finanzas/depositos"
              hrefLabel="Ver depósitos"
            />
            <StatCard
              label="Por pagar a proveedores"
              value={formatMoneyRD(fin.cuentasPorPagar.montoPendiente)}
              sub={`${fin.cuentasPorPagar.vencidas} vencidas · ${formatMoneyRD(fin.cuentasPorPagar.montoVencido)}`}
              accent={fin.cuentasPorPagar.montoVencido > 0 ? 'warning' : undefined}
              href="/superadmin/supply/finanzas/cuentas-por-pagar"
              hrefLabel="Ver cuentas por pagar"
            />
            <StatCard
              label="Por cobrar a proveedores"
              value={formatMoneyRD(fin.cuentasPorCobrar.montoPendiente)}
              sub={`${fin.cuentasPorCobrar.abiertas} cuentas abiertas`}
              href="/superadmin/supply/finanzas/cuentas-por-cobrar"
              hrefLabel="Ver cuentas por cobrar"
            />
            <StatCard
              label="Liquidaciones pendientes"
              value={fin.liquidaciones.pendientes}
              sub={`${formatMoneyRD(fin.liquidaciones.montoPendiente)} · ${fin.liquidaciones.disputadas} disputadas`}
              accent={fin.liquidaciones.disputadas > 0 ? 'danger' : undefined}
              href="/superadmin/supply/finanzas/liquidaciones"
              hrefLabel="Ver liquidaciones"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="GMV" value={formatMoneyRD(eco.gmv)} sub="unidades vendidas + ventas a comisión" href="/superadmin/supply/economia" hrefLabel="Ver economía" />
            <StatCard label="Ingresos de Membego" value={formatMoneyRD(eco.ingresos)} sub="cobros a clientes + comisiones" accent="brand" />
            <StatCard label="Margen bruto" value={formatMoneyRD(eco.margenBruto)} sub={`neto estimado ${formatMoneyRD(eco.margenNetoEstimado)}`} accent={eco.margenBruto >= 0 ? 'success' : 'danger'} />
            <StatCard label="Supply reservado" value={pool.retenidas.toLocaleString('es-DO')} sub={`${pool.asignadas.toLocaleString('es-DO')} asignadas a campañas`} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Redenciones hoy / mes" value={`${fin.redencionesHoy} / ${fin.redencionesMes}`} href="/superadmin/supply/redenciones" hrefLabel="Ver redenciones" />
            <StatCard label="Ventas del mes" value={formatMoneyRD(fin.ventasMes.bruto)} sub={`${fin.ventasMes.ventas} ventas · comisión ${formatMoneyRD(fin.ventasMes.comision)}`} href="/superadmin/supply/ventas" hrefLabel="Ver ventas" />
            <StatCard label="Incidencias abiertas" value={fin.incidenciasAbiertas} accent={fin.incidenciasAbiertas > 0 ? 'warning' : 'success'} href="/superadmin/supply/incidencias" hrefLabel="Ver incidencias" />
            <StatCard label="Discrepancias abiertas" value={fin.discrepanciasAbiertas} sub={`${fin.acuerdosActivos} acuerdos activos · ${fin.acuerdosSuspendidos} suspendidos · ${fin.proveedoresActivos} proveedores`} accent={fin.discrepanciasAbiertas > 0 ? 'danger' : 'success'} href="/superadmin/supply/conciliacion" hrefLabel="Ver conciliación" />
          </div>

          {otrosCriticos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="size-4" aria-hidden />
                  Depósitos y acuerdos que vencen pronto
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TablaReporte
                  columnas={[
                    { clave: 'tipo', titulo: 'Tipo' },
                    { clave: 'codigo', titulo: 'Código' },
                    { clave: 'proveedor', titulo: 'Proveedor' },
                    { clave: 'descripcion', titulo: 'Qué pasa' },
                    { clave: 'dias', titulo: 'Días', alinearDerecha: true },
                    { clave: 'monto', titulo: 'En juego', alinearDerecha: true },
                  ]}
                  filas={otrosCriticos.slice(0, 8).map((v) => ({
                    __clave: v.id,
                    tipo: v.tipo === 'DEPOSITO' ? 'Depósito' : 'Acuerdo',
                    codigo: (
                      <Link href={v.tipo === 'DEPOSITO' ? `/superadmin/supply/finanzas/depositos/${v.id}` : `/superadmin/supply/acuerdos/${v.id}`} className="underline-offset-4 hover:underline">
                        {v.codigo}
                      </Link>
                    ),
                    proveedor: v.proveedorNombre,
                    descripcion: v.descripcion,
                    dias: <Badge variant={v.nivel === 'CRITICO' ? 'destructive' : 'warning'}>{v.diasRestantes}</Badge>,
                    monto: formatMoneyRD(v.monto),
                  }))}
                />
              </CardContent>
            </Card>
          )}

          {criticas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="size-4" aria-hidden />
                  Supply en riesgo inmediato
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TablaReporte
                  titulo="Lotes que vencen pronto"
                  columnas={[
                    { clave: 'lote', titulo: 'Lote' },
                    { clave: 'proveedor', titulo: 'Proveedor' },
                    { clave: 'item', titulo: 'Producto' },
                    { clave: 'dias', titulo: 'Días', alinearDerecha: true },
                    { clave: 'unidades', titulo: 'Unidades', alinearDerecha: true },
                    { clave: 'exposicion', titulo: 'En riesgo', alinearDerecha: true },
                  ]}
                  filas={criticas.slice(0, 8).map((a) => ({
                    __clave: a.loteId,
                    lote: (
                      <Link href={`/superadmin/supply/lotes/${a.loteId}`} className="underline-offset-4 hover:underline">
                        {a.codigo}
                      </Link>
                    ),
                    proveedor: a.proveedorNombre,
                    item: a.item,
                    dias: (
                      <Badge variant={a.nivel === 'CRITICO' ? 'destructive' : 'warning'}>
                        {a.diasRestantes}
                      </Badge>
                    ),
                    unidades: (a.enRiesgo + a.expuestas).toLocaleString('es-DO'),
                    exposicion: formatMoneyRD(a.exposicionFinanciera),
                  }))}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Proveedores</CardTitle>
            </CardHeader>
            <CardContent>
              <TablaReporte
                titulo="Supply por proveedor"
                columnas={[
                  { clave: 'proveedor', titulo: 'Proveedor' },
                  { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
                  { clave: 'emitidas', titulo: 'Emitidas', alinearDerecha: true },
                  { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
                  { clave: 'pendientes', titulo: 'En manos de clientes', alinearDerecha: true },
                  { clave: 'costoConsumido', titulo: 'Costo consumido', alinearDerecha: true },
                  { clave: 'puntaje', titulo: 'Puntaje', alinearDerecha: true },
                ]}
                filas={proveedores.map((p) => ({
                  __clave: p.proveedorId,
                  proveedor: (
                    <Link
                      href={`/superadmin/supply/proveedores/${p.proveedorId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {p.proveedor}
                    </Link>
                  ),
                  compradas: p.compradas.toLocaleString('es-DO'),
                  emitidas: p.emitidas.toLocaleString('es-DO'),
                  redimidas: p.redimidas.toLocaleString('es-DO'),
                  pendientes: p.pendientesCliente.toLocaleString('es-DO'),
                  costoConsumido: formatMoneyRD(p.costoConsumido),
                  puntaje: (
                    <Badge
                      variant={
                        p.scorecard.puntaje >= 85
                          ? 'success'
                          : p.scorecard.puntaje >= 60
                            ? 'warning'
                            : 'destructive'
                      }
                    >
                      {p.scorecard.puntaje}
                    </Badge>
                  ),
                }))}
                vacio="Todavía no hay proveedores con supply activo."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actividad reciente</CardTitle>
            </CardHeader>
            <CardContent>
              {actividad.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay actividad en Supply.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {actividad.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <span>
                        <strong>{a.quien}</strong> · {a.accion}
                        {a.detalle ? <span className="text-muted-foreground"> · {a.detalle}</span> : null}
                      </span>
                      <span className="text-caption text-muted-foreground">{formatDateTime(a.fecha)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Supply por categoría</CardTitle>
              </CardHeader>
              <CardContent>
                <TablaReporte
                  columnas={[
                    { clave: 'categoria', titulo: 'Categoría' },
                    { clave: 'lotes', titulo: 'Lotes', alinearDerecha: true },
                    { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
                    { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
                    { clave: 'valor', titulo: 'Adquirido', alinearDerecha: true },
                  ]}
                  filas={categorias.map((c) => ({
                    __clave: c.categoria,
                    categoria: c.categoria,
                    lotes: c.lotes,
                    compradas: c.compradas.toLocaleString('es-DO'),
                    redimidas: c.redimidas.toLocaleString('es-DO'),
                    valor: formatMoneyRD(c.valorAdquirido),
                  }))}
                  vacio="Sin lotes."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Últimas redenciones</CardTitle>
              </CardHeader>
              <CardContent>
                <TablaReporte
                  columnas={[
                    { clave: 'fecha', titulo: 'Cuándo' },
                    { clave: 'cliente', titulo: 'Cliente' },
                    { clave: 'producto', titulo: 'Producto' },
                    { clave: 'proveedor', titulo: 'Dónde' },
                    { clave: 'costo', titulo: 'Costo', alinearDerecha: true },
                  ]}
                  filas={recientes.map((r) => ({
                    __clave: r.id,
                    fecha: formatDateTime(r.createdAt),
                    cliente: r.cliente.nombre,
                    producto: r.voucher.derecho.lote.snapshotItemNombre,
                    proveedor: r.sucursal ? `${r.proveedor.name} · ${r.sucursal.nombre}` : r.proveedor.name,
                    costo: formatMoneyRD(Number(r.costoUnitario)),
                  }))}
                  vacio="Todavía nadie ha canjeado un beneficio."
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function AccionRapida({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-9 items-center rounded-lg border border-primary/40 bg-primary/5 px-3 text-sm font-medium text-primary hover:bg-primary/10">
      {children}
    </Link>
  )
}

function Cubeta({ label, valor, destacada }: { label: string; valor: number; destacada?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${destacada ? 'text-primary' : ''}`}>
        {valor.toLocaleString('es-DO')}
      </p>
    </div>
  )
}
