import Link from 'next/link'
import { Search } from 'lucide-react'
import type { MerchantBillingStatus } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { listarCuentasEnTx } from '@/modules/billing/queries'
import { TRAMOS_DE_ANTIGUEDAD } from '@/modules/billing/domain'
import { BADGE_ESTADO_CUENTA, ETIQUETA_ESTADO, ETIQUETA_MODELO, formatearFecha, formatoMonto } from '@/modules/billing/formato'
import { BarridoAcciones } from '@/components/billing/BarridoAcciones'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cobros a empresas' }

const ESTADOS: readonly MerchantBillingStatus[] = ['ACTIVE', 'GRACE_PERIOD', 'SUSPENDED']

function enlace(base: Record<string, string | undefined>, cambios: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...base, ...cambios })) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `/superadmin/facturacion?${s}` : '/superadmin/facturacion'
}

/**
 * Plataforma · Merchant Billing (Fase 4): lo que cada empresa le debe a Membego por
 * los pedidos del marketplace. El superadmin ve las cuentas, cuánto se debe y cómo
 * envejece, y entra a cada una para asentar pagos, ajustes y créditos.
 */
export default async function FacturacionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const q = sp.q?.slice(0, 80)
  const estado = ESTADOS.find((e) => e === sp.estado)
  const soloConDeuda = sp.deuda === '1'
  const pagina = Math.max(1, Math.trunc(Number(sp.pagina)) || 1)

  const lista = await sinEmpresa('superadmin: cobros a empresas (Merchant Billing)', (tx) => listarCuentasEnTx(tx, { q, estado, soloConDeuda, pagina }))
  const base = { q, estado, deuda: soloConDeuda ? '1' : undefined }

  return (
    <div className="space-y-6">
      <PageHeader title="Cobros a empresas" description="Merchant Billing: lo que cada empresa le debe a Membego por los pedidos que la plataforma le trajo. Separado de lo que Membego paga a sus proveedores (Supply)." action={<BarridoAcciones />} />

      <section aria-label="Resumen de cobros" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Por cobrar</p>
            <p className="text-h2 font-semibold tabular-nums">{formatoMonto(lista.deudaTotal)}</p>
          </CardContent>
        </Card>
        {ESTADOS.map((e) => (
          <Link key={e} href={enlace(base, { estado: estado === e ? undefined : e, pagina: undefined })} aria-label={`Filtrar: ${ETIQUETA_ESTADO[e]}`}>
            <Card className={estado === e ? 'border-primary' : 'transition-colors hover:bg-muted/40'}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{ETIQUETA_ESTADO[e]}</p>
                <p className="text-h2 font-semibold tabular-nums">{lista.conteos[e]}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Antigüedad de lo que se debe</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {TRAMOS_DE_ANTIGUEDAD.map((t) => (
              <div key={t}>
                <dt className="text-muted-foreground">{t} días</dt>
                <dd className="font-semibold tabular-nums">{formatoMonto(lista.antiguedad[t])}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Un pago salda lo más viejo primero: lo que queda debido son los cargos más recientes.</p>
        </CardContent>
      </Card>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input name="q" defaultValue={q ?? ''} placeholder="Empresa" aria-label="Buscar empresa" className="w-64 pl-8" />
        </div>
        <select name="estado" defaultValue={estado ?? ''} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Estado de la cuenta">
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO[e]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="deuda" value="1" defaultChecked={soloConDeuda} className="h-4 w-4" />
          Solo con deuda
        </label>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
        {(q || estado || soloConDeuda) && (
          <Link href="/superadmin/facturacion" className="text-sm text-muted-foreground underline">
            Quitar filtros
          </Link>
        )}
      </form>

      {lista.total === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <p className="font-medium">{q || estado || soloConDeuda ? 'Nada coincide con ese filtro' : 'Todavía no hay cuentas'}</p>
            {!q && !estado && !soloConDeuda && <p className="text-sm">Una empresa aparece aquí cuando completa su primer pedido del marketplace.</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-3" aria-label="Cuentas de empresas">
            {lista.filas.map((c) => (
              <li key={c.companyId}>
                <Link href={`/superadmin/facturacion/${c.companyId}`}>
                  <Card className="transition-colors hover:bg-muted/40">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{c.empresa}</p>
                        <p className="text-xs text-muted-foreground">
                          {ETIQUETA_MODELO[c.feeModel as keyof typeof ETIQUETA_MODELO]} · límite {formatoMonto(c.creditLimit, c.currency)}
                          {c.ultimoMovimiento ? ` · último movimiento ${formatearFecha(c.ultimoMovimiento)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <p className="text-lg font-semibold tabular-nums">{formatoMonto(c.saldo, c.currency)}</p>
                        <Badge variant={BADGE_ESTADO_CUENTA[c.status]}>{ETIQUETA_ESTADO[c.status]}</Badge>
                        {c.holdManual && <Badge variant="outline">Retenida a mano</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          {lista.paginas > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación">
              {lista.pagina > 1 ? (
                <Link href={enlace(base, { pagina: String(lista.pagina - 1) })} className="underline">
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Página {lista.pagina} de {lista.paginas}
              </span>
              {lista.pagina < lista.paginas ? (
                <Link href={enlace(base, { pagina: String(lista.pagina + 1) })} className="underline">
                  Siguiente →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
