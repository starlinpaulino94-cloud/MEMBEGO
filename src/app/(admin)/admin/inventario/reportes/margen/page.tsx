import Link from 'next/link'
import { AlertTriangle, Percent } from 'lucide-react'
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
import { consultaDeFiltrosKardex, consultaDeFiltrosMargen, leerFiltrosMargen } from '@/modules/inventory/filtros'
import { formatearMonto } from '@/modules/inventory/costos'
import { formatearCantidad } from '@/modules/inventory/formato'
import { CLASES_EXCLUIDAS, ETIQUETA_EXCLUIDA, EXPLICACION_EXCLUIDA, ETIQUETA_ORDEN_MARGEN, ORDENES_MARGEN, formatearMontoFirmado, formatearPorcentaje } from '@/modules/inventory/margen'
import { margenEnTx, type MargenVista } from '@/modules/inventory/margen-queries'
import { FILAS_POR_PAGINA_REPORTES } from '@/modules/inventory/reportes'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'
const RUTA = '/admin/inventario/reportes/margen'

/**
 * MARGEN REAL (INV-4c): lo que se ganó con lo que se vendió, producto por producto. Ingresos (el precio de la línea del pedido,
 * menos su descuento) contra el costo que el ledger congeló al vender. Solo para quien tiene la función `costos`: un margen es
 * costo contra precio, así que sin la función no hay versión «sin dinero» que enseñar, y el costo ni se lee.
 *
 * Lo que no se puede comparar (unidades sin costo, pedidos reembolsados, en otra moneda o sin pedido) NO entra al margen ni como
 * cero: se enseña aparte.
 */
export default async function MargenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pedido = leerFiltrosMargen(await searchParams)
  const puedeCostos = await puedeFuncion('inventario', 'costos')

  let datos: { zona: string; sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>; vista: MargenVista } | null = null
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
        return { zona, sucursales, vista: await margenEnTx(tx, companyId, f, { zonaHoraria: zona }) }
      })
    } catch (e) {
      fallo = describirFalloDeCarga('admin-inventario-margen', e)
    }
  }

  const f = { ...pedido }
  if (datos && !datos.sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
  const v = datos?.vista
  const hayFiltros = Boolean(f.sucursalId || f.q)
  const totalPaginas = v ? Math.max(1, Math.ceil(v.totales.productos / v.porPagina)) : 1
  // El rango que se está mirando (el de siempre si no se pidió otro) viaja en todos los enlaces y en el archivo.
  const rango = v ? { desde: v.desde, hasta: v.hasta } : {}
  const consultaExportar = consultaDeFiltrosMargen({ ...f, ...rango, pagina: 1 })
  const soloRango = consultaDeFiltrosMargen({ ...rango, orden: f.orden, pagina: 1 })
  const excluidas = v ? v.excluidas.filter((e) => e.unidades > 0) : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Margen real"
        description="Lo que cobraste contra lo que costó lo que vendiste."
        action={puedeCostos && datos && v ? <BotonExportar href={`${RUTA}/exportar?${consultaExportar}`} variant="outline" size="sm" /> : undefined}
      />
      <NavegacionInventario actual="reportes" />
      <Link href="/admin/inventario/reportes" className="inline-block text-sm text-muted-foreground underline">
        ← Todos los reportes
      </Link>

      {!puedeCostos ? (
        <Alert>
          <AlertDescription>No tienes permiso para ver costos ni el margen. Pídele a quien administra tu empresa la función «Ver y fijar costos».</AlertDescription>
        </Alert>
      ) : !datos || !v ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar el margen">
            <div className="space-y-1">
              <label htmlFor="mg-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="mg-desde" type="date" name="desde" defaultValue={v.desde} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="mg-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="mg-hasta" type="date" name="hasta" defaultValue={v.hasta} className="w-40" />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="mg-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="mg-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
              <label htmlFor="mg-q" className="text-xs text-muted-foreground">
                Producto
              </label>
              <Input id="mg-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU o código de barras" className="w-64" maxLength={80} />
            </div>
            <div className="space-y-1">
              <label htmlFor="mg-orden" className="text-xs text-muted-foreground">
                Ordenar
              </label>
              <select id="mg-orden" name="orden" defaultValue={f.orden} className={CAMPO}>
                {ORDENES_MARGEN.map((o) => (
                  <option key={o} value={o}>
                    {ETIQUETA_ORDEN_MARGEN[o]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href={`${RUTA}?${soloRango}`} className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumen del margen">
            <Card aria-label="Ingresos">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Ingresos</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearMonto(v.totales.ingresos)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatearCantidad(v.totales.unidades)} unidad{v.totales.unidades === 1 ? '' : 'es'} de {formatearCantidad(v.totales.productos)} producto{v.totales.productos === 1 ? '' : 's'}
                </p>
              </CardContent>
            </Card>
            <Card aria-label="Costo de lo vendido">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Costo de lo vendido</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearMonto(v.totales.costo)}</p>
                <p className="text-xs text-muted-foreground">con el costo de cada día</p>
              </CardContent>
            </Card>
            <Card aria-label="Margen">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Margen</p>
                <p className={`text-2xl font-semibold tabular-nums ${v.totales.margen < BigInt(0) ? 'text-destructive' : ''}`}>{formatearMontoFirmado(v.totales.margen)}</p>
                <p className="text-xs text-muted-foreground">ingresos menos costo</p>
              </CardContent>
            </Card>
            <Card aria-label="Margen porcentual">
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Percent className="h-3 w-3" aria-hidden /> Margen
                </p>
                <p className={`text-2xl font-semibold tabular-nums ${v.totales.margenPct !== null && v.totales.margenPct < 0 ? 'text-destructive' : ''}`}>{formatearPorcentaje(v.totales.margenPct)}</p>
                <p className="text-xs text-muted-foreground">sobre lo cobrado con costo conocido</p>
              </CardContent>
            </Card>
          </div>

          {v.totales.unidadesSinCosto > 0 && (
            <Alert className="border-warning/40" aria-label="Lo que no tiene costo">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                {formatearCantidad(v.totales.unidadesSinCosto)} unidades vendidas no tenían costo conocido: se cobraron {formatearMonto(v.totales.ingresosSinCosto)} por ellas y no entran al margen (no valen cero: no se sabe).
                Se arregla al registrar una entrada con costo o desde la ficha del producto.
              </AlertDescription>
            </Alert>
          )}

          {v.totales.productos === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Percent className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : `No hubo ventas entre el ${v.desde} y el ${v.hasta}`}</p>
                {!hayFiltros && <p className="text-sm">Aquí aparece el margen de cada producto en cuanto se complete un pedido.</p>}
              </CardContent>
            </Card>
          ) : (
            <>
              <ul className="divide-y rounded-lg border" aria-label="Margen por producto">
                {v.filas.map((fila) => (
                  <li key={fila.varianteId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        <Link href={`/admin/inventario/${fila.varianteId}`} className="underline-offset-2 hover:underline">
                          {fila.producto}
                        </Link>{' '}
                        <span className="text-xs font-normal text-muted-foreground">SKU {fila.sku}</span>
                      </p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {formatearCantidad(fila.unidades)} unidad{fila.unidades === 1 ? '' : 'es'} · ingresos {formatearMonto(fila.ingresos)} · costo {formatearMonto(fila.costo)}
                        </span>
                        {fila.margen < BigInt(0) && <Badge variant="destructive">Bajo el costo</Badge>}
                        {fila.unidadesSinCosto > 0 && <Badge variant="warning">{formatearCantidad(fila.unidadesSinCosto)} sin costo</Badge>}
                      </p>
                      <p className="text-xs">
                        <Link href={`/admin/inventario/reportes/kardex?${consultaDeFiltrosKardex({ varianteId: fila.varianteId })}`} className="text-muted-foreground underline">
                          Ver su kardex
                        </Link>
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className={fila.margen < BigInt(0) ? 'font-semibold text-destructive' : 'font-semibold'}>{formatearMontoFirmado(fila.margen)}</p>
                      <p className="text-xs text-muted-foreground">{formatearPorcentaje(fila.margenPct)}</p>
                    </div>
                  </li>
                ))}
              </ul>

              {totalPaginas > 1 && (
                <nav className="flex items-center justify-between text-sm" aria-label="Paginación del margen">
                  {v.pagina > 1 ? (
                    <Link href={`${RUTA}?${consultaDeFiltrosMargen({ ...f, ...rango }, v.pagina - 1)}`} className="underline">
                      ← Anteriores
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Página {v.pagina} de {totalPaginas} · {formatearCantidad(v.totales.productos)} productos
                  </span>
                  {v.pagina < totalPaginas ? (
                    <Link href={`${RUTA}?${consultaDeFiltrosMargen({ ...f, ...rango }, v.pagina + 1)}`} className="underline">
                      Siguientes →
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )}

          {excluidas.length > 0 && (
            <Card aria-label="Ventas que no entran al margen">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ventas que no entran al margen</CardTitle>
                <p className="text-xs text-muted-foreground">Salieron del inventario en este periodo, pero no se pueden comparar con un precio.</p>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm" aria-label="Ventas excluidas">
                  {CLASES_EXCLUIDAS.map((clase) => {
                    const e = excluidas.find((x) => x.clase === clase)
                    if (!e) return null
                    return (
                      <li key={clase} className="py-2">
                        <p className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{ETIQUETA_EXCLUIDA[clase]}</span>
                          <span className="tabular-nums">
                            {formatearCantidad(e.unidades)} unidad{e.unidades === 1 ? '' : 'es'}
                            <span className="text-xs text-muted-foreground"> · costo {formatearMonto(e.costo)}</span>
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">{EXPLICACION_EXCLUIDA[clase]}</p>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Ingresos = el precio de cada línea del pedido menos su descuento, sin impuestos ni el ajuste del pedido (que no se reparte entre líneas). Solo
            cuentan los pedidos completados. El costo es el costo promedio que tenía cada producto al venderse, no el de hoy; por eso este margen no tiene por qué
            coincidir con el costo de ventas de «Valor» (que incluye devoluciones sueltas y no mira precios). Margen % = margen entre lo cobrado por lo que tiene
            costo conocido. Las fechas son días de tu empresa ({datos.zona}). {FILAS_POR_PAGINA_REPORTES} productos por página; el archivo trae todos.
          </p>
        </>
      )}
    </div>
  )
}
