import Link from 'next/link'
import { Search, ShoppingBag } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { ESTADOS } from '@/modules/orders/domain'
import { listarPedidosEnTx } from '@/modules/orders/queries'
import { BADGE_ESTADO, ETIQUETA_ESTADO, ETIQUETA_ORIGEN, formatearFechaHora, formatearMonto } from '@/modules/orders/formato'

export const dynamic = 'force-dynamic'

function enlace(base: Record<string, string | undefined>, cambios: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...base, ...cambios })) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `/admin/pedidos-membego?${s}` : '/admin/pedidos-membego'
}

export default async function PedidosMembegoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const sp = await searchParams

  const q = sp.q?.slice(0, 80)
  // Lo que llega por la URL es texto libre: el estado solo vale si existe.
  const estado = ESTADOS.find((e) => e === sp.estado)
  const pagina = Math.max(1, Math.trunc(Number(sp.pagina)) || 1)

  let lista: Awaited<ReturnType<typeof listarPedidosEnTx>> | null = null
  try {
    lista = await conEmpresa(companyId, (tx) => listarPedidosEnTx(tx, companyId, { q, estado, pagina }))
  } catch (e) {
    console.error('[admin-pedidos-membego]', e)
  }

  const base = { q, estado }
  const filtrado = !!(q || estado)
  const totalGeneral = lista ? Object.values(lista.conteos).reduce((a, b) => a + b, 0) : 0

  return (
    <div className="space-y-6">
      <PageHeader title="Pedidos Membego" description="Los pedidos que llegan por el marketplace: acéptalos, ajusta el monto, márcalos listos y ciérralos con el QR del cliente." />

      {!lista ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No se pudieron cargar los pedidos. Intenta de nuevo en un momento.</CardContent>
        </Card>
      ) : (
        <>
          {lista.conteos.AWAITING_MERCHANT > 0 && (
            <Card className="border-warning/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm">
                  <span className="font-semibold">{lista.conteos.AWAITING_MERCHANT}</span> pedido{lista.conteos.AWAITING_MERCHANT === 1 ? ' espera' : 's esperan'} tu respuesta.
                </p>
                <Link href={enlace(base, { estado: 'AWAITING_MERCHANT', pagina: undefined })}>
                  <Button size="sm" variant="outline">
                    Verlos
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input name="q" defaultValue={q ?? ''} placeholder="Código, cliente o producto" aria-label="Buscar por código, cliente o producto" className="w-64 pl-8" />
            </div>
            <select name="estado" defaultValue={estado ?? ''} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Estado del pedido">
              <option value="">Todos los estados</option>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {ETIQUETA_ESTADO[e]} ({lista.conteos[e]})
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {filtrado && (
              <Link href="/admin/pedidos-membego" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {lista.total === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="font-medium">{filtrado ? 'Nada coincide con ese filtro' : 'Todavía no hay pedidos'}</p>
                {!filtrado && totalGeneral === 0 && <p className="text-sm">Cuando un cliente pida algo de tu catálogo desde el marketplace, aparecerá aquí.</p>}
              </CardContent>
            </Card>
          ) : (
            <>
              <ul className="grid gap-3" aria-label="Pedidos">
                {lista.filas.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/pedidos-membego/${p.id}`}>
                      <Card className="transition-colors hover:bg-muted/40">
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">
                              {p.code} <span className="font-normal text-muted-foreground">· {p.clienteNombre}</span>
                            </p>
                            <p className="truncate text-sm text-muted-foreground">{p.resumen}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatearFechaHora(p.createdAt)} · {ETIQUETA_ORIGEN[p.origin as keyof typeof ETIQUETA_ORIGEN] ?? p.origin} · {p.sucursalNombre}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <p className="text-lg font-semibold tabular-nums">{formatearMonto(p.total, p.currency)}</p>
                            <Badge variant={BADGE_ESTADO[p.status]}>{ETIQUETA_ESTADO[p.status]}</Badge>
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
        </>
      )}
    </div>
  )
}
