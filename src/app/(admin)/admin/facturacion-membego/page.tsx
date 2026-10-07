import Link from 'next/link'
import { Landmark } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { listarAsientosEnTx, listarCortesEnTx, resumenDeCuentaEnTx } from '@/modules/billing/queries'
import {
  AYUDA_ESTADO,
  BADGE_ESTADO_CUENTA,
  ETIQUETA_CICLO,
  ETIQUETA_ESTADO,
  ETIQUETA_MODELO,
  formatearFecha,
  formatoMonto,
} from '@/modules/billing/formato'
import { TablaDeAsientos, TablaDeCortes } from '@/components/billing/LibroDeCuenta'

export const dynamic = 'force-dynamic'

/**
 * Mi cuenta Membego (Fase 4): lo que la empresa le debe a la plataforma por los
 * pedidos que esta le trajo. SOLO LECTURA: los pagos, ajustes y créditos los asienta
 * el superadmin, y cada comisión sale de un pedido completado.
 */
export default async function MiCuentaMembegoPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pagina = Math.max(1, Math.trunc(Number((await searchParams).pagina)) || 1)

  let datos: { resumen: Awaited<ReturnType<typeof resumenDeCuentaEnTx>>; libro: Awaited<ReturnType<typeof listarAsientosEnTx>>; cortes: Awaited<ReturnType<typeof listarCortesEnTx>> } | null = null
  try {
    datos = await conEmpresa(companyId, async (tx) => ({
      resumen: await resumenDeCuentaEnTx(tx, companyId),
      libro: await listarAsientosEnTx(tx, companyId, { pagina }),
      cortes: await listarCortesEnTx(tx, companyId, 12),
    }))
  } catch (e) {
    console.error('[admin-facturacion-membego]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Mi cuenta Membego" description="Lo que debes a Membego por los pedidos que el marketplace te trajo: tu saldo, cada comisión y tus estados de cuenta." />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No se pudo cargar tu cuenta. Intenta de nuevo en un momento.</CardContent>
        </Card>
      ) : (
        <>
          <section aria-label="Resumen de la cuenta" className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Landmark className="h-4 w-4" />
                  {Number(datos.resumen.saldo) < 0 ? 'Saldo a tu favor' : 'Debes a Membego'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-h1 font-semibold tabular-nums" aria-live="polite">
                  {formatoMonto(Math.abs(Number(datos.resumen.saldo)).toFixed(2), datos.resumen.currency)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={BADGE_ESTADO_CUENTA[datos.resumen.status]}>{ETIQUETA_ESTADO[datos.resumen.status]}</Badge>
                  {datos.resumen.graceUntil && <span className="text-sm text-muted-foreground">Plazo hasta el {formatearFecha(datos.resumen.graceUntil)}</span>}
                </div>
                <p className="text-sm text-muted-foreground">{AYUDA_ESTADO[datos.resumen.status]}</p>
                {datos.resumen.statusReason && datos.resumen.holdManual && <p className="text-sm text-muted-foreground">Motivo: {datos.resumen.statusReason}</p>}
                {datos.resumen.usoDelLimite !== null && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Límite de crédito {formatoMonto(datos.resumen.creditLimit, datos.resumen.currency)}</span>
                      <span>Disponible {formatoMonto(datos.resumen.disponible, datos.resumen.currency)}</span>
                    </div>
                    <div role="progressbar" aria-label="Uso del límite de crédito" aria-valuemin={0} aria-valuemax={100} aria-valuenow={datos.resumen.usoDelLimite} className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${datos.resumen.usoDelLimite >= 100 ? 'bg-destructive' : datos.resumen.usoDelLimite >= 80 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${datos.resumen.usoDelLimite}%` }} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cómo se te cobra</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{ETIQUETA_MODELO[datos.resumen.feeModel as keyof typeof ETIQUETA_MODELO]}</p>
                <dl className="space-y-1 text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt>CPA por pedido</dt>
                    <dd className="tabular-nums text-foreground">{formatoMonto(datos.resumen.cpaAmount, datos.resumen.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Porcentaje</dt>
                    <dd className="tabular-nums text-foreground">{Number(datos.resumen.percentageRate)} %</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Estado de cuenta</dt>
                    <dd className="text-foreground">{ETIQUETA_CICLO[datos.resumen.billingCycle as keyof typeof ETIQUETA_CICLO]}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">El CPA se cobra por pedido completado sin pago verificado; el porcentaje, cuando el pago del pedido está verificado. Si tienes dudas sobre un cobro, escríbenos con el código del pedido.</p>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              <TablaDeAsientos filas={datos.libro.filas} pedidoHref={(id) => `/admin/pedidos-membego/${id}`} />
              {datos.libro.paginas > 1 && (
                <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginación de movimientos">
                  {datos.libro.pagina > 1 ? (
                    <Link href={`/admin/facturacion-membego?pagina=${datos.libro.pagina - 1}`} className="underline">
                      ← Más recientes
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Página {datos.libro.pagina} de {datos.libro.paginas}
                  </span>
                  {datos.libro.pagina < datos.libro.paginas ? (
                    <Link href={`/admin/facturacion-membego?pagina=${datos.libro.pagina + 1}`} className="underline">
                      Más antiguos →
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Estados de cuenta</CardTitle>
            </CardHeader>
            <CardContent>
              <TablaDeCortes cortes={datos.cortes} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
