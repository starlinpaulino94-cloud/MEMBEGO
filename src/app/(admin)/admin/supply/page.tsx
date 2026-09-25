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

  const [compromisos, saldo, incidencias, redenciones, hoy, pedidos] = await Promise.all([
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
  ])

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

      {compromisos.length === 0 ? (
        <EmptyState
          variant="card"
          title="Todavía no hay compromisos"
          description="Cuando Membego te compre unidades por adelantado, aquí verás cuántas son, cuántas llevas entregadas y cuántos vouchers están vivos."
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
