import Link from 'next/link'
import { AlertTriangle, Truck, Wallet } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosValor, leerFiltrosValor } from '@/modules/inventory/filtros'
import { mesActual, valorDelInventarioEnTx, type ValorDelInventario } from '@/modules/inventory/valor'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'

/**
 * VALOR DEL INVENTARIO (INV-3a): lo que vale lo que hay, producto por producto y sucursal por sucursal, y lo que costó lo
 * vendido en el mes. Solo para quien tiene la función `costos`.
 *
 * Lo que no tiene costo NO suma al valor —ni como cero—: se cuenta aparte y se enseña, con el camino para arreglarlo.
 */
export default async function ValorInventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pedido = leerFiltrosValor(await searchParams)
  const puedeCostos = await puedeFuncion('inventario', 'costos')

  let datos: { zona: string; sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>; valor: ValorDelInventario; mes: string } | null = null
  let fallo = ''
  if (puedeCostos) {
    try {
      datos = await conEmpresa(companyId, async (tx) => {
        const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
        const zona = zonaSegura(empresa?.zonaHoraria)
        const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
        // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
        const f = { ...pedido }
        if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
        return { zona, sucursales, mes: f.mes ?? mesActual(zona), valor: await valorDelInventarioEnTx(tx, companyId, f, { zonaHoraria: zona }) }
      })
    } catch (e) {
      fallo = describirFalloDeCarga('admin-inventario-valor', e)
    }
  }

  const f = { ...pedido }
  if (datos && !datos.sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
  const hayFiltros = Boolean(f.q || f.sucursalId || f.sinCosto || f.mes)
  /** Cambia cuando cambian los filtros de la URL: remonta el formulario (sus campos no son controlados) para que «Quitar filtros» lo vacíe. */
  const consultaFiltros = consultaDeFiltrosValor({ ...f, pagina: 1 })
  const v = datos?.valor
  const totalPaginas = v ? Math.max(1, Math.ceil(v.totalFilas / v.porPagina)) : 1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Valor del inventario"
        description="Lo que vale lo que tienes, a su costo promedio, y lo que costó lo que vendiste."
        action={puedeCostos && datos ? <BotonExportar href={`/admin/inventario/valor/exportar${consultaDeFiltrosValor({ ...f, pagina: 1 }) ? `?${consultaDeFiltrosValor({ ...f, pagina: 1 })}` : ''}`} variant="outline" size="sm" /> : undefined}
      />
      <NavegacionInventario actual="valor" />

      {!puedeCostos ? (
        <Alert>
          <AlertDescription>No tienes permiso para ver costos ni el valor del inventario. Pídele a quien administra tu empresa la función «Ver y fijar costos».</AlertDescription>
        </Alert>
      ) : !datos || !v ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumen del valor">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Valor del inventario</p>
                <p className="text-2xl font-semibold tabular-nums">{v.resumen.valor}</p>
                <p className="text-xs text-muted-foreground">
                  {formatearCantidad(v.resumen.unidadesConCosto)} unidades con costo
                  {v.resumen.danadas > 0 && ` · ${formatearCantidad(v.resumen.danadas)} dañadas incluidas`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Existencias</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(v.resumen.unidades)}</p>
                <p className="text-xs text-muted-foreground">
                  en {formatearCantidad(v.resumen.productos)} producto{v.resumen.productos === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>
            <Card aria-label="Costo de ventas del mes">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Costo de ventas · {datos.mes}</p>
                <p className="text-2xl font-semibold tabular-nums">{v.costoDeVentas.costo}</p>
                <p className="text-xs text-muted-foreground">
                  {formatearCantidad(v.costoDeVentas.unidadesVendidas)} unidad{v.costoDeVentas.unidadesVendidas === 1 ? '' : 'es'} vendida{v.costoDeVentas.unidadesVendidas === 1 ? '' : 's'}
                  {v.costoDeVentas.unidadesDevueltas > 0 && `, ${formatearCantidad(v.costoDeVentas.unidadesDevueltas)} devuelta${v.costoDeVentas.unidadesDevueltas === 1 ? '' : 's'}`}
                </p>
              </CardContent>
            </Card>
            {v.enTransito && v.enTransito.unidades > 0 ? (
              <Card aria-label="Lo que va en camino">
                <CardContent className="p-4">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Truck className="h-3 w-3" aria-hidden />
                    En camino entre sucursales
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{v.enTransito.valor}</p>
                  <p className="text-xs text-muted-foreground">{formatearCantidad(v.enTransito.unidades)} unidades; no están en el valor de arriba</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Método</p>
                  <p className="text-sm font-medium">Costo promedio ponderado</p>
                  <p className="text-xs text-muted-foreground">Uno por producto, sin impuestos</p>
                </CardContent>
              </Card>
            )}
          </div>

          {(v.resumen.productosSinCosto > 0 || v.costoDeVentas.unidadesSinCosto > 0) && (
            <Alert className="border-warning/40" aria-label="Lo que no tiene costo">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription className="space-y-1">
                {v.resumen.productosSinCosto > 0 && (
                  <p>
                    <strong>{formatearCantidad(v.resumen.productosSinCosto)}</strong> producto{v.resumen.productosSinCosto === 1 ? '' : 's'} ({formatearCantidad(v.resumen.unidadesSinCosto)} unidad
                    {v.resumen.unidadesSinCosto === 1 ? '' : 'es'}) no tiene{v.resumen.productosSinCosto === 1 ? '' : 'n'} costo y no suma{v.resumen.productosSinCosto === 1 ? '' : 'n'} al valor.{' '}
                    <Link href={`/admin/inventario/valor?${consultaDeFiltrosValor({ ...f, sinCosto: true, pagina: 1 })}`} className="underline">
                      Ver cuáles
                    </Link>
                    . Se arregla al registrar una entrada con costo, o desde la ficha de cada producto.
                  </p>
                )}
                {v.costoDeVentas.unidadesSinCosto > 0 && (
                  <p>
                    {formatearCantidad(v.costoDeVentas.unidadesSinCosto)} unidad{v.costoDeVentas.unidadesSinCosto === 1 ? '' : 'es'} vendida{v.costoDeVentas.unidadesSinCosto === 1 ? '' : 's'} en {datos.mes} no tenía{v.costoDeVentas.unidadesSinCosto === 1 ? '' : 'n'} costo conocido
                    (las ventas anteriores a que se llevaran costos, o de productos sin costo): el costo de ventas las deja fuera.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4" aria-hidden />
                Por sucursal
              </CardTitle>
            </CardHeader>
            <CardContent>
              {v.porSucursal.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hay existencias en ninguna sucursal.</p>
              ) : (
                <ul className="divide-y text-sm" aria-label="Valor por sucursal">
                  {v.porSucursal.map((s) => (
                    <li key={s.sucursalId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/admin/inventario/valor?${consultaDeFiltrosValor({ ...f, sucursalId: s.sucursalId, pagina: 1 })}`} className="font-medium underline-offset-2 hover:underline">
                        {s.nombre}
                        {s.activa ? '' : ' (desactivada)'}
                      </Link>
                      <span className="tabular-nums">
                        {s.valor} <span className="text-xs text-muted-foreground">· {formatearCantidad(s.unidades)} unidades{s.unidadesSinCosto > 0 && `, ${formatearCantidad(s.unidadesSinCosto)} sin costo`}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <form key={consultaFiltros} method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar el valor">
            <div className="space-y-1">
              <label htmlFor="va-q" className="text-xs text-muted-foreground">
                Producto
              </label>
              <Input id="va-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU o código de barras" className="w-64" maxLength={80} />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="va-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="va-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
                  <option value="">Todas</option>
                  {datos.sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.activa ? '' : ' (desactivada)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="va-mes" className="text-xs text-muted-foreground">
                Mes del costo de ventas
              </label>
              <Input id="va-mes" type="month" name="mes" defaultValue={datos.mes} className="w-40" />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="sinCosto" value="1" defaultChecked={Boolean(f.sinCosto)} className="h-4 w-4" />
              Solo sin costo
            </label>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href="/admin/inventario/valor" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {v.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Wallet className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : 'Todavía no hay existencias que valorar'}</p>
                {!hayFiltros && <p className="text-sm">Cuando registres una entrada con costo, aquí aparece lo que vale.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Valor por producto">
              {v.filas.map((l) => (
                <li key={l.varianteId}>
                  <Link href={`/admin/inventario/${l.varianteId}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{l.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        SKU {l.sku} · {formatearCantidad(l.unidades)} unidad{l.unidades === 1 ? '' : 'es'}
                        {l.danadas > 0 && ` (${formatearCantidad(l.danadas)} dañadas)`}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      {l.valor === null ? (
                        <Badge variant="outline">Sin costo</Badge>
                      ) : (
                        <>
                          <p className="font-semibold">{l.valor}</p>
                          <p className="text-xs text-muted-foreground">
                            a {l.costo} c/u · {l.fuente === 'PROMEDIO' ? 'promedio' : 'referencia del catálogo'}
                          </p>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {totalPaginas > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación del valor">
              {v.pagina > 1 ? (
                <Link href={`/admin/inventario/valor?${consultaDeFiltrosValor(f, v.pagina - 1)}`} className="underline">
                  ← Anteriores
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Página {v.pagina} de {totalPaginas} · {formatearCantidad(v.totalFilas)} productos
              </span>
              {v.pagina < totalPaginas ? (
                <Link href={`/admin/inventario/valor?${consultaDeFiltrosValor(f, v.pagina + 1)}`} className="underline">
                  Siguientes →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          <p className="text-xs text-muted-foreground">
            El valor es existencias × costo promedio de cada producto (vendible, apartado y dañado, en todas las sucursales). El costo promedio sale de las entradas que traen costo, sin impuestos;
            mientras un producto no lo tiene, vale el costo de referencia de su ficha del catálogo. Las unidades que van en camino entre sucursales no están en ninguna.
          </p>
        </>
      )}
    </div>
  )
}
