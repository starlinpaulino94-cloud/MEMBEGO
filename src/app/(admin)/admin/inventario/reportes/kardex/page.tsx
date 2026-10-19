import Link from 'next/link'
import { AlertTriangle, BookOpen, Search } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosKardex, leerFiltrosKardex } from '@/modules/inventory/filtros'
import { formatearCosto, formatearMonto } from '@/modules/inventory/costos'
import { ETIQUETA_MOVIMIENTO, describirReferencia, formatearCantidad } from '@/modules/inventory/formato'
import { describirCambioDeCubeta } from '@/modules/inventory/reportes'
import { detalleDeMotivo, etiquetaDeMotivo } from '@/modules/inventory/motivos'
import { TOPE_FILAS_KARDEX, buscarProductosParaKardexEnTx, kardexEnTx, type KardexVista, type ProductoDelKardex } from '@/modules/inventory/reportes-queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'
import type { InventoryMovementType } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'
const RUTA = '/admin/inventario/reportes/kardex'

/**
 * KARDEX DE UN PRODUCTO (INV-4a): cada entrada y salida de su existencia física en un periodo, con el saldo que dejó, desde la
 * existencia con la que empezó hasta la que terminó. Sin producto elegido, busca uno. Las reservas no aparecen: no mueven nada.
 *
 * Los costos (lo que valió lo que entró y lo que salió) solo se leen con la función `costos`; lo que no tiene costo se cuenta aparte.
 */
export default async function KardexPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pedido = leerFiltrosKardex(await searchParams)
  const conCostos = await puedeFuncion('inventario', 'costos')

  let datos: { zona: string; sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>; kardex: KardexVista | null; productos: ProductoDelKardex[] } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...pedido }
      if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
      const kardex = f.varianteId ? await kardexEnTx(tx, companyId, { ...f, varianteId: f.varianteId }, { zonaHoraria: zona, conCostos }) : null
      const productos = !f.varianteId && f.q ? await buscarProductosParaKardexEnTx(tx, companyId, f.q) : []
      return { zona, sucursales, kardex, productos }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-reportes-kardex', e)
  }

  const f = { ...pedido }
  if (datos && !datos.sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
  const k = datos?.kardex ?? null
  const productoNoEncontrado = Boolean(datos && f.varianteId && !k)
  const consultaExportar = k ? consultaDeFiltrosKardex({ varianteId: k.variante.id, sucursalId: k.sucursal?.id, desde: k.desde, hasta: k.hasta }) : ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kardex"
        description="Cada entrada y salida de un producto, con la existencia que dejó."
        action={k ? <BotonExportar href={`${RUTA}/exportar?${consultaExportar}`} variant="outline" size="sm" /> : undefined}
      />
      <NavegacionInventario actual="reportes" />
      <Link href="/admin/inventario/reportes" className="inline-block text-sm text-muted-foreground underline">
        ← Todos los reportes
      </Link>

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : !k ? (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Buscar el producto del kardex">
            <div className="space-y-1">
              <label htmlFor="kx-q" className="text-xs text-muted-foreground">
                Producto
              </label>
              <Input id="kx-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU o código de barras" className="w-72" maxLength={80} autoFocus />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="kx-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="kx-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
              <Search className="mr-2 h-4 w-4" aria-hidden />
              Buscar
            </Button>
          </form>

          {productoNoEncontrado ? (
            <Alert>
              <AlertDescription>Ese producto no existe en tu empresa. Búscalo de nuevo.</AlertDescription>
            </Alert>
          ) : f.q && datos.productos.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p className="font-medium">Ningún producto con existencias coincide con «{f.q}»</p>
                <p className="text-sm">Prueba con el nombre, el SKU o el código de barras.</p>
              </CardContent>
            </Card>
          ) : datos.productos.length > 0 ? (
            <ul className="divide-y rounded-lg border" aria-label="Productos encontrados">
              {datos.productos.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`${RUTA}?${consultaDeFiltrosKardex({ varianteId: p.id, sucursalId: f.sucursalId })}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/40"
                  >
                    <span>
                      <span className="font-medium">{p.nombre}</span> <span className="text-xs text-muted-foreground">SKU {p.sku}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{formatearCantidad(p.existencia)} en existencia</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">Busca un producto para ver su kardex</p>
                <p className="text-sm">También puedes llegar desde la ficha de cualquier producto.</p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{k.variante.nombre}</p>
              <p className="text-sm text-muted-foreground">
                SKU {k.variante.sku}
                {k.variante.barcode && ` · ${k.variante.barcode}`} · {k.sucursal ? k.sucursal.nombre : 'todas las sucursales'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={`/admin/inventario/${k.variante.id}`} className="underline">
                Ficha del producto
              </Link>
              <Link href={RUTA} className="text-muted-foreground underline">
                Cambiar de producto
              </Link>
            </div>
          </div>

          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar el kardex">
            <input type="hidden" name="variante" value={k.variante.id} />
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="kx-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="kx-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
              <label htmlFor="kx-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="kx-desde" type="date" name="desde" defaultValue={k.desde} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="kx-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="kx-hasta" type="date" name="hasta" defaultValue={k.hasta} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Ver
            </Button>
          </form>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumen del periodo">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Al empezar</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(k.apertura)}</p>
                <p className="text-xs text-muted-foreground">existencia física el {k.desde}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Entradas</p>
                <p className="text-2xl font-semibold tabular-nums">+{formatearCantidad(k.totales.entradas)}</p>
                {conCostos && <p className="text-xs text-muted-foreground">valieron {formatearMonto(k.totales.valorEntradas)}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Salidas</p>
                <p className="text-2xl font-semibold tabular-nums">−{formatearCantidad(k.totales.salidas)}</p>
                {conCostos && <p className="text-xs text-muted-foreground">costaron {formatearMonto(k.totales.valorSalidas)}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Al terminar</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(k.cierre)}</p>
                <p className="text-xs text-muted-foreground">existencia física el {k.hasta}</p>
              </CardContent>
            </Card>
          </div>

          {conCostos && (k.totales.entradasSinCosto > 0 || k.totales.salidasSinCosto > 0) && (
            <Alert className="border-warning/40" aria-label="Lo que no tiene costo">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                {k.totales.entradasSinCosto > 0 && `${formatearCantidad(k.totales.entradasSinCosto)} unidades entraron sin costo `}
                {k.totales.entradasSinCosto > 0 && k.totales.salidasSinCosto > 0 && 'y '}
                {k.totales.salidasSinCosto > 0 && `${formatearCantidad(k.totales.salidasSinCosto)} salieron sin costo conocido `}
                en este periodo: no suman a los valores de arriba (no valen cero, simplemente no se sabe).
              </AlertDescription>
            </Alert>
          )}

          {k.truncado && (
            <Alert className="border-warning/40">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                Este periodo tiene más de {formatearCantidad(TOPE_FILAS_KARDEX)} movimientos: abajo van solo los primeros. La existencia al terminar y los saldos de arriba son los del periodo completo;
                acota las fechas para ver el resto.
              </AlertDescription>
            </Alert>
          )}

          {k.filas.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">Este producto no tuvo movimientos entre el {k.desde} y el {k.hasta}</p>
                <p className="text-sm">Su existencia se mantuvo en {formatearCantidad(k.apertura)}.</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Movimientos del kardex">
              {k.filas.map((m) => {
                const cubeta = describirCambioDeCubeta(m)
                const ref = describirReferencia(m.referenciaTipo, m.referenciaId)
                return (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {ETIQUETA_MOVIMIENTO[m.tipo as InventoryMovementType] ?? m.tipo}
                        {cubeta && <span className="font-normal text-muted-foreground"> · {cubeta}</span>}
                        {!k.sucursal && <span className="font-normal text-muted-foreground"> · {m.sucursalNombre}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeExacto(m.creadoEn, { zonaHoraria: datos.zona })} · {m.usuarioNombre ?? 'Sistema'}
                        {ref && ` · ${ref}`}
                      </p>
                      {m.motivoCodigo && <p className="mt-0.5 text-xs font-medium">Motivo: {etiquetaDeMotivo(m.motivoCodigo)}</p>}
                      {detalleDeMotivo(m.motivoCodigo, m.motivo) && <p className="mt-0.5 break-words text-xs">{detalleDeMotivo(m.motivoCodigo, m.motivo)}</p>}
                    </div>
                    <div className="text-right tabular-nums">
                      <p className={m.entra > 0 ? 'font-semibold text-success' : m.sale > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground'}>
                        {m.entra > 0 ? `+${formatearCantidad(m.entra)}` : m.sale > 0 ? `−${formatearCantidad(m.sale)}` : '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">saldo {formatearCantidad(m.saldo)}</p>
                      {conCostos && (m.entra > 0 || m.sale > 0) && (
                        <p className="text-xs text-muted-foreground">{m.valor !== null && m.costo !== null ? `${formatearMonto(m.valor)} · a ${formatearCosto(m.costo)} c/u` : 'Sin costo'}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            El saldo es la existencia física (vendible, apartada y dañada) después de cada movimiento. Apartar, dañar y recuperar solo cambian la mercancía de lugar: no suben ni bajan el saldo. Las reservas no
            aparecen. {conCostos ? 'El valor es la cantidad por el costo con que se valoró el movimiento en su momento.' : ''} Las fechas son días de tu empresa ({datos.zona}).
          </p>
        </>
      )}
    </div>
  )
}
