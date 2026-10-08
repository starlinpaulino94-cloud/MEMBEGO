import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { empresaParaCuentaEnTx, listarAsientosEnTx, listarCortesEnTx, resumenDeCuentaEnTx } from '@/modules/billing/queries'
import { BADGE_ESTADO_CUENTA, ETIQUETA_ESTADO, formatearFecha, formatoMonto } from '@/modules/billing/formato'
import { CuentaAcciones } from '@/components/billing/CuentaAcciones'
import { VerificarPagoForm } from '@/components/billing/VerificarPagoForm'
import { TablaDeAsientos, TablaDeCortes } from '@/components/billing/LibroDeCuenta'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cuenta de la empresa' }

/** La cuenta de UNA empresa: saldo, límite, libro, estados de cuenta y las acciones del superadmin. */
export default async function CuentaDeEmpresaPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ pagina?: string }> }) {
  await requireRole('SUPERADMIN')
  const { companyId } = await params
  const pagina = Math.max(1, Math.trunc(Number((await searchParams).pagina)) || 1)

  const empresa = await sinEmpresa('superadmin: cuenta de una empresa (Merchant Billing)', (tx) => empresaParaCuentaEnTx(tx, companyId))
  if (!empresa) notFound()
  const { resumen, libro, cortes } = await conEmpresa(empresa.id, async (tx) => ({
    resumen: await resumenDeCuentaEnTx(tx, empresa.id),
    libro: await listarAsientosEnTx(tx, empresa.id, { pagina }),
    cortes: await listarCortesEnTx(tx, empresa.id, 24),
  }))

  return (
    <div className="space-y-6">
      <Link href="/superadmin/facturacion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />
        Cobros a empresas
      </Link>
      <PageHeader title={empresa.name} description="Cuenta Membego de la empresa: lo que debe por los pedidos del marketplace." />

      <section aria-label="Resumen de la cuenta" className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">{Number(resumen.saldo) < 0 ? 'Saldo a favor de la empresa' : 'Debe a Membego'}</p>
            <p className="text-h2 font-semibold tabular-nums">{formatoMonto(Math.abs(Number(resumen.saldo)).toFixed(2), resumen.currency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Estado</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={BADGE_ESTADO_CUENTA[resumen.status]}>{ETIQUETA_ESTADO[resumen.status]}</Badge>
              {resumen.holdManual && <Badge variant="outline">Retenida a mano</Badge>}
            </div>
            {resumen.graceUntil && <p className="text-xs text-muted-foreground">Gracia hasta el {formatearFecha(resumen.graceUntil)}</p>}
            {resumen.statusReason && <p className="text-xs text-muted-foreground">{resumen.statusReason}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Límite de crédito</p>
            <p className="text-h3 font-semibold tabular-nums">{formatoMonto(resumen.creditLimit, resumen.currency)}</p>
            <p className="text-xs text-muted-foreground">Disponible {formatoMonto(resumen.disponible, resumen.currency)}{resumen.usoDelLimite !== null ? ` · usa el ${resumen.usoDelLimite} %` : ''}</p>
          </CardContent>
        </Card>
      </section>

      {!resumen.existe && <p className="text-sm text-muted-foreground">Esta empresa aún no tiene cuenta: se crea con estos valores al completar su primer pedido del marketplace (o al asentar el primer movimiento).</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              <TablaDeAsientos filas={libro.filas} />
              {libro.paginas > 1 && (
                <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginación de movimientos">
                  {libro.pagina > 1 ? (
                    <Link href={`/superadmin/facturacion/${empresa.id}?pagina=${libro.pagina - 1}`} className="underline">
                      ← Más recientes
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Página {libro.pagina} de {libro.paginas}
                  </span>
                  {libro.pagina < libro.paginas ? (
                    <Link href={`/superadmin/facturacion/${empresa.id}?pagina=${libro.pagina + 1}`} className="underline">
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
              <TablaDeCortes cortes={cortes} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <CuentaAcciones
            companyId={empresa.id}
            moneda={resumen.currency}
            config={{ feeModel: resumen.feeModel, cpaAmount: resumen.cpaAmount, percentageRate: resumen.percentageRate, creditLimit: resumen.creditLimit, billingCycle: resumen.billingCycle }}
            status={resumen.status}
            holdManual={resumen.holdManual}
          />
          <VerificarPagoForm companyId={empresa.id} moneda={resumen.currency} />
        </div>
      </div>
    </div>
  )
}
