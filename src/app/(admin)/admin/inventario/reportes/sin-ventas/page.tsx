import Link from 'next/link'
import { AlertTriangle, PackageX } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDate } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosKardex, consultaDeFiltrosSinVentas, leerFiltrosSinVentas } from '@/modules/inventory/filtros'
import { formatearCosto, formatearMonto } from '@/modules/inventory/costos'
import { formatearCantidad } from '@/modules/inventory/formato'
import { FILAS_POR_PAGINA_REPORTES, PERIODOS_DIAS, textoHace } from '@/modules/inventory/reportes'
import { sinVentasEnTx, type SinVentasVista } from '@/modules/inventory/reportes-queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'
const RUTA = '/admin/inventario/reportes/sin-ventas'

/**
 * STOCK SIN VENTAS (INV-4a): los saldos con existencias que llevan N días sin una venta, de lo que más dinero tienen parado a lo
 * que menos. Un saldo nuevo (creado dentro del periodo) no aparece: todavía no tuvo tiempo de venderse.
 *
 * El dinero solo se lee con la función `costos`; sin ella, el orden es por unidades y no hay valores.
 */
export default async function SinVentasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pedido = leerFiltrosSinVentas(await searchParams)
  const conCostos = await puedeFuncion('inventario', 'costos')

  let datos: { zona: string; sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>; vista: SinVentasVista } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...pedido }
      if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
      return { zona, sucursales, vista: await sinVentasEnTx(tx, companyId, f, { conCostos }) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-reportes-sin-ventas', e)
  }

  const f = { ...pedido }
  if (datos && !datos.sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
  const hayFiltros = Boolean(f.q || f.sucursalId)
  const v = datos?.vista
  const totalPaginas = v ? Math.max(1, Math.ceil(v.total / v.porPagina)) : 1
  const consultaExportar = consultaDeFiltrosSinVentas({ ...f, pagina: 1 })
  /** «Quitar filtros» conserva el periodo: es lo que se está mirando, no un filtro. */
  const soloDias = consultaDeFiltrosSinVentas({ dias: f.dias, pagina: 1 })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock sin ventas"
        description="Lo que tiene existencias y no se ha vendido en el periodo."
        action={datos && v ? <BotonExportar href={`${RUTA}/exportar${consultaExportar ? `?${consultaExportar}` : ''}`} variant="outline" size="sm" /> : undefined}
      />
      <NavegacionInventario actual="reportes" />
      <Link href="/admin/inventario/reportes" className="inline-block text-sm text-muted-foreground underline">
        ← Todos los reportes
      </Link>

      {!datos || !v ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar el stock sin ventas">
            <div className="space-y-1">
              <label htmlFor="sv-dias" className="text-xs text-muted-foreground">
                Sin vender en
              </label>
              <select id="sv-dias" name="dias" defaultValue={String(f.dias)} className={CAMPO}>
                {PERIODOS_DIAS.map((d) => (
                  <option key={d} value={d}>
                    {d} días
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="sv-q" className="text-xs text-muted-foreground">
                Producto
              </label>
              <Input id="sv-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU o código de barras" className="w-64" maxLength={80} />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="sv-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="sv-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href={`${RUTA}${soloDias ? `?${soloDias}` : ''}`} className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3" aria-label="Resumen del stock sin ventas">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Sin vender en {v.dias} días</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(v.resumen.saldos)}</p>
                <p className="text-xs text-muted-foreground">producto{v.resumen.saldos === 1 ? '' : 's'} por sucursal</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Unidades paradas</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(v.resumen.unidades)}</p>
                <p className="text-xs text-muted-foreground">vendibles y apartadas</p>
              </CardContent>
            </Card>
            {v.resumen.valor !== null && (
              <Card aria-label="Dinero parado">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Dinero parado</p>
                  <p className="text-2xl font-semibold tabular-nums">{formatearMonto(v.resumen.valor)}</p>
                  <p className="text-xs text-muted-foreground">a costo promedio</p>
                </CardContent>
              </Card>
            )}
          </div>

          {conCostos && (v.resumen.unidadesSinCosto ?? 0) > 0 && (
            <Alert className="border-warning/40" aria-label="Lo que no tiene costo">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                {formatearCantidad(v.resumen.unidadesSinCosto ?? 0)} unidades paradas no tienen costo y no suman al dinero parado (no valen cero: no se sabe). Se arregla al registrar una entrada con costo, o desde la ficha del
                producto.
              </AlertDescription>
            </Alert>
          )}

          {v.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <PackageX className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : `Todo lo que tienes se vendió en los últimos ${v.dias} días`}</p>
                {!hayFiltros && <p className="text-sm">Un producto recién llegado no cuenta hasta que cumpla ese tiempo en tu inventario.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Productos sin ventas">
              {v.filas.map((l) => (
                <li key={l.nivelId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <Link href={`/admin/inventario/${l.varianteId}`} className="underline-offset-2 hover:underline">
                        {l.nombre}
                      </Link>{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        SKU {l.sku} · {l.sucursalNombre}
                        {l.sucursalActiva ? '' : ' (desactivada)'}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {l.ultimaVenta ? `Última venta: ${textoHace(l.diasSinVender).toLowerCase()} (${formatDate(l.ultimaVenta, { zonaHoraria: datos.zona })})` : 'Nunca se ha vendido'}
                      {l.ultimaEntrada && ` · última entrada ${formatDate(l.ultimaEntrada, { zonaHoraria: datos.zona })}`}
                    </p>
                    <p className="text-xs">
                      <Link href={`/admin/inventario/reportes/kardex?${consultaDeFiltrosKardex({ varianteId: l.varianteId, sucursalId: l.sucursalId })}`} className="text-muted-foreground underline">
                        Ver su kardex
                      </Link>
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-semibold">{formatearCantidad(l.existencia)} unidad{l.existencia === 1 ? '' : 'es'}</p>
                    {conCostos &&
                      (l.valor === null || l.costo === null ? (
                        <Badge variant="outline">Sin costo</Badge>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {formatearMonto(l.valor)} · a {formatearCosto(l.costo)} c/u
                        </p>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPaginas > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación del stock sin ventas">
              {v.pagina > 1 ? (
                <Link href={`${RUTA}?${consultaDeFiltrosSinVentas(f, v.pagina - 1)}`} className="underline">
                  ← Anteriores
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Página {v.pagina} de {totalPaginas} · {formatearCantidad(v.total)} saldos
              </span>
              {v.pagina < totalPaginas ? (
                <Link href={`${RUTA}?${consultaDeFiltrosSinVentas(f, v.pagina + 1)}`} className="underline">
                  Siguientes →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          <p className="text-xs text-muted-foreground">
            Cuenta como venta cada vez que se vendió el producto en esa sucursal (en la caja, en un pedido o a mano); las devoluciones, las entradas y las transferencias no. Un producto que llegó hace menos de {v.dias} días no
            aparece: aún no tuvo tiempo de venderse. {conCostos ? 'Los más caros de tener parados van primero. ' : 'Van primero los de más unidades. '}
            {FILAS_POR_PAGINA_REPORTES} por página; el archivo trae todos.
          </p>
        </>
      )}
    </div>
  )
}
