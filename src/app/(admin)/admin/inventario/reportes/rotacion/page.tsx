import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
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
import { consultaDeFiltrosKardex, consultaDeFiltrosRotacion, leerFiltrosRotacion } from '@/modules/inventory/filtros'
import { formatearMonto } from '@/modules/inventory/costos'
import { formatearCantidad } from '@/modules/inventory/formato'
import { DIAS_EXCESO_COBERTURA, DIAS_POCA_COBERTURA, ESTADOS_COBERTURA, ETIQUETA_ESTADO_COBERTURA, PERIODOS_DIAS, type EstadoCobertura } from '@/modules/inventory/reportes'
import { TOPE_PRODUCTOS_ROTACION, rotacionEnTx, type RotacionVista } from '@/modules/inventory/reportes-queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'
const RUTA = '/admin/inventario/reportes/rotacion'

const BADGE_ESTADO: Record<EstadoCobertura, 'destructive' | 'warning' | 'success' | 'info' | 'outline'> = {
  AGOTADO: 'destructive',
  POCA: 'warning',
  NORMAL: 'success',
  EXCESO: 'info',
  SIN_VENTAS: 'outline',
}

/** Un número con hasta `d` decimales y sin ceros de relleno: 2.5, 40, 0.83. */
const dec = (n: number, d = 1): string => n.toLocaleString('es-DO', { maximumFractionDigits: d })

/**
 * ROTACIÓN Y COBERTURA (INV-4a): por producto, cuánto se vendió en el periodo (menos lo devuelto), cuántas veces rotó la
 * existencia promedio y para cuántos días alcanza lo que se puede vender hoy. Primero lo más urgente: lo agotado y lo que se
 * acaba pronto; el exceso y lo que no se vende, al final.
 *
 * Con la función `costos` suma el costo de ventas, lo que vale el inventario y los días de inventario de toda la empresa.
 */
export default async function RotacionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pedido = leerFiltrosRotacion(await searchParams)
  const conCostos = await puedeFuncion('inventario', 'costos')

  let datos: { zona: string; sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>; vista: RotacionVista } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...pedido }
      if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
      return { zona, sucursales, vista: await rotacionEnTx(tx, companyId, f, { conCostos }) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-reportes-rotacion', e)
  }

  const f = { ...pedido }
  if (datos && !datos.sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
  const hayFiltros = Boolean(f.q || f.sucursalId || f.estado)
  const v = datos?.vista
  const totalPaginas = v ? Math.max(1, Math.ceil(v.total / v.porPagina)) : 1
  const consultaExportar = consultaDeFiltrosRotacion({ ...f, pagina: 1 })
  /** «Quitar filtros» conserva el periodo: es lo que se está mirando, no un filtro. */
  const soloDias = consultaDeFiltrosRotacion({ dias: f.dias, pagina: 1 })
  const totalEstados = v ? ESTADOS_COBERTURA.reduce((t, e) => t + v.porEstado[e], 0) : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotación y cobertura"
        description="Cuánto se vende cada producto y para cuántos días alcanza lo que hay."
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
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar la rotación">
            <div className="space-y-1">
              <label htmlFor="ro-dias" className="text-xs text-muted-foreground">
                Periodo
              </label>
              <select id="ro-dias" name="dias" defaultValue={String(f.dias)} className={CAMPO}>
                {PERIODOS_DIAS.map((d) => (
                  <option key={d} value={d}>
                    Últimos {d} días
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="ro-q" className="text-xs text-muted-foreground">
                Producto
              </label>
              <Input id="ro-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU o código de barras" className="w-64" maxLength={80} />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="ro-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="ro-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
            {f.estado && <input type="hidden" name="estado" value={f.estado} />}
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href={`${RUTA}${soloDias ? `?${soloDias}` : ''}`} className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumen de la rotación">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Unidades vendidas</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(v.unidadesVendidas)}</p>
                <p className="text-xs text-muted-foreground">en {v.dias} días, menos las devueltas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Productos</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(totalEstados)}</p>
                <p className="text-xs text-muted-foreground">con existencias o con ventas</p>
              </CardContent>
            </Card>
            {v.valorado && (
              <>
                <Card aria-label="Costo de ventas del periodo">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Costo de ventas</p>
                    <p className="text-2xl font-semibold tabular-nums">{formatearMonto(v.valorado.costoDeVentas)}</p>
                    <p className="text-xs text-muted-foreground">lo que costó lo vendido en {v.dias} días</p>
                  </CardContent>
                </Card>
                <Card aria-label="Días de inventario">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Días de inventario</p>
                    <p className="text-2xl font-semibold tabular-nums">{v.valorado.diasDeInventario === null ? '—' : formatearCantidad(v.valorado.diasDeInventario)}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.valorado.diasDeInventario === null ? 'sin costo de ventas en el periodo' : `el inventario (${formatearMonto(v.valorado.valorInventario)}) cubre ese tiempo de ventas`}
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {v.valorado && v.valorado.unidadesSinCosto > 0 && (
            <Alert className="border-warning/40" aria-label="Lo que no tiene costo">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                {formatearCantidad(v.valorado.unidadesSinCosto)} unidades vendidas en el periodo no tenían costo conocido: el costo de ventas las deja fuera (no valen cero), así que los días de inventario salen más largos de lo real.
              </AlertDescription>
            </Alert>
          )}

          <nav className="flex flex-wrap gap-2" aria-label="Filtrar por estado de cobertura">
            <Link
              href={`${RUTA}?${consultaDeFiltrosRotacion({ ...f, estado: undefined, pagina: 1 })}`}
              aria-current={f.estado ? undefined : 'page'}
              className={`inline-flex h-8 items-center rounded-lg border px-3 text-sm ${f.estado ? 'border-input text-muted-foreground hover:bg-muted/60' : 'border-primary/40 bg-muted font-medium'}`}
            >
              Todos · {formatearCantidad(totalEstados)}
            </Link>
            {ESTADOS_COBERTURA.map((e) => (
              <Link
                key={e}
                href={`${RUTA}?${consultaDeFiltrosRotacion({ ...f, estado: e, pagina: 1 })}`}
                aria-current={f.estado === e ? 'page' : undefined}
                className={`inline-flex h-8 items-center rounded-lg border px-3 text-sm ${f.estado === e ? 'border-primary/40 bg-muted font-medium' : 'border-input text-muted-foreground hover:bg-muted/60'}`}
              >
                {ETIQUETA_ESTADO_COBERTURA[e]} · {formatearCantidad(v.porEstado[e])}
              </Link>
            ))}
          </nav>

          {v.truncado && (
            <Alert className="border-warning/40">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                Hay más de {formatearCantidad(TOPE_PRODUCTOS_ROTACION)} productos con existencias o ventas: se leyeron primero los que más vendieron, así que los conteos de arriba son de esos. Filtra por sucursal o producto para ver el resto.
              </AlertDescription>
            </Alert>
          )}

          {v.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <RefreshCw className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : 'Todavía no hay productos con existencias ni ventas'}</p>
                {!hayFiltros && <p className="text-sm">Cuando registres entradas y ventas, aquí aparece cuánto rota cada producto.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Rotación por producto">
              {v.filas.map((l) => (
                <li key={l.varianteId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <Link href={`/admin/inventario/${l.varianteId}`} className="underline-offset-2 hover:underline">
                        {l.nombre}
                      </Link>{' '}
                      <span className="text-xs font-normal text-muted-foreground">SKU {l.sku}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Vendió {formatearCantidad(l.vendidas)} ({dec(l.ventaDiaria, 2)} por día)
                      {l.veces !== null && l.vendidas > 0 && ` · rotó ${dec(l.veces, 2)} ${l.veces === 1 ? 'vez' : 'veces'}`}
                      {l.ultimaVenta && ` · última venta ${formatDate(l.ultimaVenta, { zonaHoraria: datos.zona })}`}
                    </p>
                    <p className="text-xs">
                      <Link href={`/admin/inventario/reportes/kardex?${consultaDeFiltrosKardex({ varianteId: l.varianteId, sucursalId: f.sucursalId })}`} className="text-muted-foreground underline">
                        Ver su kardex
                      </Link>
                    </p>
                  </div>
                  <div className="space-y-1 text-right tabular-nums">
                    <Badge variant={BADGE_ESTADO[l.estado]}>{ETIQUETA_ESTADO_COBERTURA[l.estado]}</Badge>
                    <p className="font-semibold">
                      {formatearCantidad(l.disponible)} disponible{l.disponible === 1 ? '' : 's'}
                      {l.existencia !== l.disponible && <span className="text-xs font-normal text-muted-foreground"> de {formatearCantidad(l.existencia)}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{l.coberturaDias === null ? 'sin ventas: no hay ritmo' : l.disponible === 0 ? 'agotado' : `alcanza para ${dec(l.coberturaDias, 0)} días`}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPaginas > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación de la rotación">
              {v.pagina > 1 ? (
                <Link href={`${RUTA}?${consultaDeFiltrosRotacion(f, v.pagina - 1)}`} className="underline">
                  ← Anteriores
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Página {v.pagina} de {totalPaginas} · {formatearCantidad(v.total)} productos
              </span>
              {v.pagina < totalPaginas ? (
                <Link href={`${RUTA}?${consultaDeFiltrosRotacion(f, v.pagina + 1)}`} className="underline">
                  Siguientes →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          <p className="text-xs text-muted-foreground">
            Vendidas son las ventas menos las devoluciones del periodo. La rotación divide lo vendido entre la existencia promedio (la de hace {v.dias} días y la de hoy, una aproximación). La cobertura es lo disponible hoy
            (vendible sin lo apartado) entre lo que se vende por día: con {DIAS_POCA_COBERTURA} días o menos «se agota pronto»; con más de {DIAS_EXCESO_COBERTURA}, «exceso». Un producto sin ventas no tiene ritmo, así que no se
            inventa una cobertura.
          </p>
        </>
      )}
    </div>
  )
}
