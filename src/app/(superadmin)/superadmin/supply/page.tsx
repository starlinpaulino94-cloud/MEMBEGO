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
import { alertasDeVencimiento } from '@/modules/supply/vencimientos'

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

  const [pool, proveedores, alertas] = await Promise.all([
    resumenPool(),
    reporteProveedores(),
    alertasDeVencimiento(30),
  ])

  const criticas = alertas.filter((a) => a.nivel === 'CRITICO' || a.nivel === 'ALTO')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membego Supply"
        description="Productos, servicios y capacidad que Membego compró por adelantado para regalar, vender, premiar o repartir."
        eyebrow="Plataforma"
        nav={<NavSupply activa="" />}
      />

      {pool.unidadesCompradas === 0 ? (
        <EmptyState
          variant="card"
          title="Todavía no hay supply comprado"
          description="Cuando Membego firme un acuerdo con una empresa y active su orden de compra, los derechos adquiridos aparecen aquí."
          action={
            <Link
              href="/superadmin/supply/acuerdos"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Crear el primer acuerdo
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
        </>
      )}
    </div>
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
