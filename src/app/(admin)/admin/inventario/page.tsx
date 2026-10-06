import Link from 'next/link'
import { AlertTriangle, Package, Search, Warehouse } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { alertasDeStockEnTx, listarInventarioEnTx, sucursalesActivasEnTx, type FiltroEstado } from '@/modules/inventory/queries'
import { BADGE_ESTADO_STOCK, ETIQUETA_ESTADO_STOCK, formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'

export const dynamic = 'force-dynamic'

const ESTADOS: readonly Exclude<FiltroEstado, 'TODOS'>[] = ['BAJO', 'AGOTADO']

function enlace(base: Record<string, string | undefined>, cambios: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...base, ...cambios })) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `/admin/inventario?${s}` : '/admin/inventario'
}

export default async function InventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const sp = await searchParams

  const q = sp.q?.slice(0, 80)
  const estado = ESTADOS.find((e) => e === sp.estado)
  const pagina = Math.max(1, Math.trunc(Number(sp.pagina)) || 1)

  let datos: { sucursales: Awaited<ReturnType<typeof sucursalesActivasEnTx>>; lista: Awaited<ReturnType<typeof listarInventarioEnTx>>; alertas: Awaited<ReturnType<typeof alertasDeStockEnTx>> } | null = null
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const sucursales = await sucursalesActivasEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: la sucursal solo vale si es de esta empresa.
      const sucursalId = sucursales.find((s) => s.id === sp.sucursal)?.id
      return {
        sucursales,
        lista: await listarInventarioEnTx(tx, companyId, { q, estado, sucursalId, pagina }),
        alertas: await alertasDeStockEnTx(tx, companyId, 6),
      }
    })
  } catch (e) {
    console.error('[admin-inventario]', e)
  }

  const sucursalId = datos?.sucursales.find((s) => s.id === sp.sucursal)?.id
  const filtrado = !!(q || estado || sucursalId)
  const base = { q, sucursal: sucursalId, estado }

  return (
    <div className="space-y-6">
      <PageHeader title="Inventario" description="Cuánto hay de cada producto en cada sucursal, qué se movió y qué se está acabando." />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No se pudo cargar el inventario. Intenta de nuevo en un momento.</CardContent>
        </Card>
      ) : (
        <>
          {datos.sucursales.length === 0 && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm">Para llevar existencias necesitas al menos una sucursal activa.</p>
                <Link href="/admin/sucursales">
                  <Button size="sm" variant="outline">
                    Ir a sucursales
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {datos.alertas.total > 0 && (
            <Card className="border-warning/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Stock bajo ({datos.alertas.total})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm" aria-label="Alertas de stock bajo">
                  {datos.alertas.alertas.map((a) => (
                    <li key={a.nivelId}>
                      <Link href={`/admin/inventario/${a.varianteId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:underline">
                        <span>
                          {nombreCompleto(a.itemNombre, a.nombreVariante, a.esDefault)} <span className="text-muted-foreground">· {a.sucursalNombre}</span>
                        </span>
                        <span className="tabular-nums">
                          {a.estado === 'AGOTADO' ? 'Agotado' : `Quedan ${formatearCantidad(a.disponible)}`}
                          <span className="text-muted-foreground"> (aviso en {formatearCantidad(a.lowStockThreshold)})</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {datos.alertas.total > datos.alertas.alertas.length && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Y {datos.alertas.total - datos.alertas.alertas.length} más.{' '}
                    <Link href={enlace(base, { estado: 'BAJO', pagina: undefined })} className="underline">
                      Ver todo lo que está bajo
                    </Link>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input name="q" defaultValue={q ?? ''} placeholder="Buscar por nombre o SKU" aria-label="Buscar por nombre o SKU" className="w-64 pl-8" />
            </div>
            {datos.sucursales.length > 1 && (
              <select name="sucursal" defaultValue={sucursalId ?? ''} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Sucursal">
                <option value="">Todas las sucursales</option>
                {datos.sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            )}
            <select name="estado" defaultValue={estado ?? ''} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" aria-label="Estado del stock">
              <option value="">Todo el stock</option>
              <option value="BAJO">Stock bajo</option>
              <option value="AGOTADO">Agotado</option>
            </select>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {filtrado && (
              <Link href="/admin/inventario" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {(datos.lista.conteos.AGOTADO > 0 || datos.lista.conteos.BAJO > 0) && (
            <p className="text-sm text-muted-foreground">
              {datos.lista.conteos.AGOTADO > 0 && (
                <Link href={enlace(base, { estado: 'AGOTADO', pagina: undefined })} className="underline">
                  {datos.lista.conteos.AGOTADO} agotado{datos.lista.conteos.AGOTADO === 1 ? '' : 's'}
                </Link>
              )}
              {datos.lista.conteos.AGOTADO > 0 && datos.lista.conteos.BAJO > 0 && ' · '}
              {datos.lista.conteos.BAJO > 0 && (
                <Link href={enlace(base, { estado: 'BAJO', pagina: undefined })} className="underline">
                  {datos.lista.conteos.BAJO} con stock bajo
                </Link>
              )}
            </p>
          )}

          {datos.lista.total === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Warehouse className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="font-medium">{filtrado ? 'Nada coincide con ese filtro' : 'Ningún producto controla inventario todavía'}</p>
                {!filtrado && (
                  <>
                    <p className="text-sm">Activa «Controla inventario» en la ficha de un producto del catálogo para llevar sus existencias aquí.</p>
                    <Link href="/admin/catalogo" className="mt-3 inline-block">
                      <Button size="sm" variant="outline">
                        <Package className="mr-2 h-4 w-4" />
                        Ir al catálogo
                      </Button>
                    </Link>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <ul className="grid gap-3" aria-label="Existencias por producto">
                {datos.lista.filas.map((f) => (
                  <li key={f.varianteId}>
                    <Link href={`/admin/inventario/${f.varianteId}`}>
                      <Card className="transition-colors hover:bg-muted/40">
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{nombreCompleto(f.itemNombre, f.nombreVariante, f.esDefault)}</p>
                            <p className="text-xs text-muted-foreground">
                              SKU {f.sku}
                              {f.sucursales.length > 0 && ` · ${f.sucursales.map((s) => `${s.nombre}: ${formatearCantidad(s.disponible)}`).join(' · ')}`}
                              {f.sucursales.length === 0 && ' · Sin existencias registradas'}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-lg font-semibold tabular-nums">{formatearCantidad(f.disponible)}</p>
                              <p className="text-xs text-muted-foreground">
                                disponible{f.reserved > 0 && ` · ${formatearCantidad(f.reserved)} apartado${f.reserved === 1 ? '' : 's'}`}
                                {f.damaged > 0 && ` · ${formatearCantidad(f.damaged)} dañado${f.damaged === 1 ? '' : 's'}`}
                              </p>
                            </div>
                            <Badge variant={BADGE_ESTADO_STOCK[f.estado]}>{ETIQUETA_ESTADO_STOCK[f.estado]}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
              {datos.lista.recortada && (
                <p className="text-xs text-muted-foreground">Hay más productos de los que caben en esta lista: filtra por nombre, SKU o sucursal para verlos.</p>
              )}
              {datos.lista.paginas > 1 && (
                <nav className="flex items-center justify-between text-sm" aria-label="Paginación">
                  {datos.lista.pagina > 1 ? (
                    <Link href={enlace(base, { pagina: String(datos.lista.pagina - 1) })} className="underline">
                      ← Anterior
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Página {datos.lista.pagina} de {datos.lista.paginas}
                  </span>
                  {datos.lista.pagina < datos.lista.paginas ? (
                    <Link href={enlace(base, { pagina: String(datos.lista.pagina + 1) })} className="underline">
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
