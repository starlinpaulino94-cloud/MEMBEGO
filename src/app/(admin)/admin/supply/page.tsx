import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/ui/empty-state'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatDateTime, formatMoneyRD } from '@/lib/format'
import { guardiaProveedor } from '@/modules/supply/permisos'
import { compromisosDelProveedor } from '@/modules/supply/pool'
import { saldoDeProveedor } from '@/modules/supply/finanzas'
import { resumenIncidencias } from '@/modules/supply/incidencias'
import { pedidosDeHoy, usoDeHoy } from '@/modules/supply/reservas'
import { PedidosDeHoy } from './pedidos-de-hoy'
import { SUPPLY_CUENTA_ESTADO_LABELS, SUPPLY_LIQUIDACION_ESTADO_LABELS, SUPPLY_VENTA_ESTADO_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Membego Supply' }

/**
 * MEMBEGO SUPPLY · PORTAL DEL PROVEEDOR (Fase 19).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO ES «INVENTARIO». SON COMPROMISOS.
 *
 * La empresa sigue vendiendo su catálogo normalmente en el resto del panel.
 * Esto es otra cosa: unidades que Membego YA compró y que el comercio está
 * obligado a entregar cuando alguien presente un voucher válido. Mezclarlo con
 * el inventario propio es el error que este módulo entero existe para evitar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VE TODO, NO CAMBIA NADA
 *
 * Aquí no hay un solo campo editable. Las cifras del contrato —1.000 unidades,
 * RD$300 por unidad— solo cambian por una enmienda aprobada por las dos
 * partes. Y el costo unitario NO se enseña: el comercio ve volumen y
 * cumplimiento; lo que Membego paga por unidad aparece en su liquidación, que
 * es otra pregunta y otra pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS DOS LEEN EL MISMO LEDGER
 *
 * «Entregadas: 384» sale exactamente de los mismos asientos que lee el panel de
 * Membego. Si hay discrepancia, es sobre una operación concreta y no sobre dos
 * bases de datos distintas.
 */
export default async function SupplyComercioPage() {
  const user = await requireUser()
  const companyId = await requireCompanyContext(user)

  const permitido = await guardiaProveedor(companyId)
  if (!permitido) redirect('/admin/dashboard')

  const [compromisos, saldo, incidencias, redenciones, hoy, pedidos, finanzas] = await Promise.all([
    compromisosDelProveedor(companyId),
    // `conEmpresa` en TODA lectura de esta pantalla: es el portal de UNA
    // empresa y nada de lo que se enseña aquí cruza inquilinos. El proveedor A
    // no puede ver ni por accidente los compromisos del B.
    conEmpresa(companyId, (tx) => saldoDeProveedor(tx, companyId)),
    resumenIncidencias(companyId),
    conEmpresa(companyId, (tx) =>
      tx.supplyRedencion.findMany({
        // El ámbito del proveedor va explícito además de `conEmpresa`: el
        // aislamiento nunca depende de una sola barrera.
        where: { proveedorId: companyId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          reversadaAt: true,
          extrasMonto: true,
          cliente: { select: { nombre: true } },
          sucursal: { select: { nombre: true } },
          empleado: { select: { name: true } },
          voucher: {
            select: { derecho: { select: { lote: { select: { codigo: true, snapshotItemNombre: true } } } } },
          },
        },
      })
    ),
    conEmpresa(companyId, async (tx) => {
      const lote = await tx.supplyLote.findFirst({
        where: { proveedorId: companyId, estado: 'ACTIVO', snapshotCapacidadDiaria: { not: null } },
        select: { snapshotCapacidadDiaria: true },
      })
      return usoDeHoy(tx, companyId, lote?.snapshotCapacidadDiaria ?? null)
    }),
    // Lo que hay que preparar hoy. Va con el resto de lecturas de la pantalla:
    // es lo primero que mira quien abre esto por la mañana.
    pedidosDeHoy(companyId),
    // Lo que Membego le debe a ESTA empresa y cómo se lo liquida (§27):
    // cuentas por pagar vivas, liquidaciones y ventas que entregó.
    conEmpresa(companyId, async (tx) => {
      const [cuentas, liquidaciones, ventas] = await Promise.all([
        tx.supplyCuentaPorPagar.findMany({
          where: { proveedorId: companyId, estado: { in: ['ABIERTA', 'PARCIALMENTE_SALDADA', 'DISPUTADA'] } },
          orderBy: [{ vencimientoAt: 'asc' }, { createdAt: 'desc' }],
          take: 30,
          select: { id: true, codigo: true, descripcion: true, montoNeto: true, montoSaldado: true, estado: true, vencimientoAt: true, liquidacion: { select: { codigo: true } } },
        }),
        tx.supplyLiquidacion.findMany({
          where: { proveedorId: companyId, estado: { notIn: ['CANCELADA', 'BORRADOR'] } },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { id: true, codigo: true, estado: true, periodoDesde: true, periodoHasta: true, netoLiquidar: true, pagadaAt: true },
        }),
        tx.supplyVentaDirecta.findMany({
          where: { proveedorId: companyId, estado: { in: ['PAGADA', 'ENTREGADA'] } },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { id: true, numero: true, estado: true, itemNombre: true, cantidad: true, montoProveedor: true, entregadaAt: true, cliente: { select: { nombre: true } }, sucursal: { select: { nombre: true } } },
        }),
      ])
      return { cuentas, liquidaciones, ventas }
    }),
  ])
  const porEntregar = finanzas.ventas.filter((v) => v.estado === 'PAGADA')

  const contratadas = compromisos.reduce((t, c) => t + c.contratadas, 0)
  const entregadas = compromisos.reduce((t, c) => t + c.entregadas, 0)
  const vouchersActivos = compromisos.reduce((t, c) => t + c.vouchersActivos, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membego Supply"
        description="Lo que Membego compró por adelantado en tu empresa y tienes que entregar cuando un cliente presente su voucher. No es tu inventario: es un compromiso aparte."
        eyebrow="Compromisos con la plataforma"
        action={
          <Link
            href="/admin/supply/escaner"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Escanear un beneficio
          </Link>
        }
      />

      <PedidosDeHoy companyId={companyId} pedidos={pedidos} />

      {porEntregar.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>Ventas de Membego por entregar ({porEntregar.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-caption text-muted-foreground">
              El cliente ya le pagó a Membego. Cuando venga con su código, escanéalo y confirma la entrega: en ese momento Membego te debe el neto.
            </p>
            <TablaReporte
              columnas={[
                { clave: 'numero', titulo: 'Venta' },
                { clave: 'cliente', titulo: 'Cliente' },
                { clave: 'producto', titulo: 'Producto' },
                { clave: 'neto', titulo: 'Te corresponde', alinearDerecha: true },
              ]}
              filas={porEntregar.map((v) => ({
                __clave: v.id,
                numero: v.numero,
                cliente: v.cliente.nombre,
                producto: `${v.itemNombre} × ${v.cantidad}`,
                neto: formatMoneyRD(Number(v.montoProveedor)),
              }))}
            />
          </CardContent>
        </Card>
      )}

      {compromisos.length === 0 && finanzas.cuentas.length === 0 && finanzas.liquidaciones.length === 0 && finanzas.ventas.length === 0 ? (
        <EmptyState
          variant="card"
          title="Todavía no hay compromisos"
          description="Cuando Membego te compre unidades por adelantado o venda por tu cuenta, aquí verás cuántas son, cuántas llevas entregadas y cuánto te corresponde."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Contratadas"
              value={contratadas.toLocaleString('es-DO')}
              sub="unidades que Membego compró"
              accent="brand"
            />
            <StatCard
              label="Entregadas"
              value={entregadas.toLocaleString('es-DO')}
              sub={`${contratadas > 0 ? Math.round((entregadas / contratadas) * 100) : 0}% del total`}
              accent="success"
            />
            <StatCard
              label="Vouchers activos"
              value={vouchersActivos.toLocaleString('es-DO')}
              sub="clientes que pueden venir hoy"
            />
            <StatCard
              label="Hoy"
              value={hoy.capacidad ? `${hoy.usadas} / ${hoy.capacidad}` : String(hoy.usadas)}
              sub={hoy.capacidad ? 'cupo diario acordado' : 'entregas de hoy'}
              accent={
                hoy.capacidad && hoy.usadas >= hoy.capacidad * 0.9 ? 'warning' : undefined
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tus compromisos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {compromisos.map((c) => {
                const pct = c.contratadas > 0 ? (c.entregadas / c.contratadas) * 100 : 0
                return (
                  <div key={c.loteId} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {c.item}
                          {c.variante ? ` · ${c.variante}` : ''}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          Lote {c.codigo} · vence el {formatDate(c.venceAt)}
                          {c.capacidadDiaria ? ` · máximo ${c.capacidadDiaria} al día` : ''}
                        </p>
                      </div>
                      <Badge variant={c.estado === 'ACTIVO' ? 'success' : 'outline'}>
                        {c.estado}
                      </Badge>
                    </div>

                    <div className="mt-3 space-y-1">
                      <Progress value={pct} />
                      <p className="text-caption text-muted-foreground">
                        {c.entregadas.toLocaleString('es-DO')} de{' '}
                        {c.contratadas.toLocaleString('es-DO')} entregadas ·{' '}
                        {c.pendientes.toLocaleString('es-DO')} pendientes ·{' '}
                        {c.vouchersActivos.toLocaleString('es-DO')} vouchers activos
                      </p>
                    </div>
                  </div>
                )
              })}

              <p className="text-caption text-muted-foreground">
                Estas cifras no se editan desde aquí. Cambiar la cantidad contratada, el precio
                acordado o la vigencia exige una enmienda aprobada por las dos partes: es lo que
                protege el acuerdo en los dos sentidos.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Liquidación con Membego</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Linea label="Depositado por Membego" valor={formatMoneyRD(saldo.depositado)} />
              <Linea label="Devengado por entregas" valor={formatMoneyRD(saldo.devengado)} />
              <Linea label="Pagado" valor={formatMoneyRD(saldo.pagado)} />
              <div className="border-t border-border pt-2">
                <Linea
                  label="Pendiente de cobro"
                  valor={formatMoneyRD(saldo.saldoPorPagar)}
                  destacado
                />
              </div>
              <p className="pt-2 text-caption text-muted-foreground">
                Sale de los mismos movimientos que ve Membego. Si algún número no te cuadra, la
                conversación es sobre una entrega concreta, no sobre quién lleva mejor la cuenta.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Lo que Membego te debe</CardTitle>
              </CardHeader>
              <CardContent>
                <TablaReporte
                  columnas={[
                    { clave: 'codigo', titulo: 'Cuenta' },
                    { clave: 'descripcion', titulo: 'Concepto' },
                    { clave: 'pendiente', titulo: 'Pendiente', alinearDerecha: true },
                    { clave: 'vence', titulo: 'Vence' },
                    { clave: 'estado', titulo: 'Estado' },
                  ]}
                  filas={finanzas.cuentas.map((c) => ({
                    __clave: c.id,
                    codigo: c.codigo,
                    descripcion: c.liquidacion ? `${c.descripcion} · en ${c.liquidacion.codigo}` : c.descripcion,
                    pendiente: formatMoneyRD(Number(c.montoNeto) - Number(c.montoSaldado)),
                    vence: c.vencimientoAt ? formatDate(c.vencimientoAt) : '—',
                    estado: SUPPLY_CUENTA_ESTADO_LABELS[c.estado],
                  }))}
                  vacio="No hay cuentas pendientes."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Liquidaciones</CardTitle>
              </CardHeader>
              <CardContent>
                <TablaReporte
                  columnas={[
                    { clave: 'codigo', titulo: 'Liquidación' },
                    { clave: 'periodo', titulo: 'Período' },
                    { clave: 'neto', titulo: 'Neto', alinearDerecha: true },
                    { clave: 'estado', titulo: 'Estado' },
                  ]}
                  filas={finanzas.liquidaciones.map((l) => ({
                    __clave: l.id,
                    codigo: l.codigo,
                    periodo: `${formatDate(l.periodoDesde)} → ${formatDate(l.periodoHasta)}`,
                    neto: formatMoneyRD(Number(l.netoLiquidar)),
                    estado: `${SUPPLY_LIQUIDACION_ESTADO_LABELS[l.estado]}${l.pagadaAt ? ` · ${formatDate(l.pagadaAt)}` : ''}`,
                  }))}
                  vacio="Membego todavía no ha calculado ninguna liquidación contigo."
                />
              </CardContent>
            </Card>
          </div>

          {finanzas.ventas.some((v) => v.estado === 'ENTREGADA') && (
            <Card>
              <CardHeader>
                <CardTitle>Ventas de Membego entregadas</CardTitle>
              </CardHeader>
              <CardContent>
                <TablaReporte
                  columnas={[
                    { clave: 'numero', titulo: 'Venta' },
                    { clave: 'cliente', titulo: 'Cliente' },
                    { clave: 'producto', titulo: 'Producto' },
                    { clave: 'sucursal', titulo: 'Sucursal' },
                    { clave: 'entregada', titulo: 'Entregada' },
                    { clave: 'neto', titulo: 'Te corresponde', alinearDerecha: true },
                    { clave: 'estado', titulo: 'Estado' },
                  ]}
                  filas={finanzas.ventas
                    .filter((v) => v.estado === 'ENTREGADA')
                    .map((v) => ({
                      __clave: v.id,
                      numero: v.numero,
                      cliente: v.cliente.nombre,
                      producto: `${v.itemNombre} × ${v.cantidad}`,
                      sucursal: v.sucursal?.nombre ?? '—',
                      entregada: v.entregadaAt ? formatDateTime(v.entregadaAt) : '—',
                      neto: formatMoneyRD(Number(v.montoProveedor)),
                      estado: SUPPLY_VENTA_ESTADO_LABELS[v.estado],
                    }))}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Entregas recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <TablaReporte
                titulo="Últimas entregas de Membego Supply"
                columnas={[
                  { clave: 'fecha', titulo: 'Fecha' },
                  { clave: 'cliente', titulo: 'Cliente' },
                  { clave: 'producto', titulo: 'Producto' },
                  { clave: 'sucursal', titulo: 'Sucursal' },
                  { clave: 'empleado', titulo: 'Entregó' },
                  { clave: 'extras', titulo: 'Extras cobrados', alinearDerecha: true },
                  { clave: 'estado', titulo: 'Estado' },
                ]}
                filas={redenciones.map((r) => ({
                  __clave: r.id,
                  fecha: formatDateTime(r.createdAt),
                  cliente: r.cliente.nombre,
                  producto: r.voucher.derecho.lote.snapshotItemNombre,
                  sucursal: r.sucursal?.nombre ?? '—',
                  empleado: r.empleado?.name ?? '—',
                  extras: Number(r.extrasMonto) > 0 ? formatMoneyRD(Number(r.extrasMonto)) : '—',
                  estado: r.reversadaAt ? (
                    <Badge variant="destructive">Reversada</Badge>
                  ) : (
                    <Badge variant="success">Entregada</Badge>
                  ),
                }))}
                vacio="Todavía no has entregado ninguna unidad de Membego."
              />
            </CardContent>
          </Card>

          {incidencias.total > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Incidencias</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>
                  {incidencias.abiertas} abierta(s), {incidencias.enRevision} en revisión,{' '}
                  {incidencias.resueltas} resuelta(s).
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  Son reportes de clientes sobre entregas de Membego. Membego las revisa y te
                  contacta si hace falta.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
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
