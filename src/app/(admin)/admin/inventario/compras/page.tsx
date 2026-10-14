import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDate, formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { ETIQUETA_ESTADO_ORDEN, puedeRecibirse, type EstadoOrden } from '@/modules/inventory/compras'
import { POR_PAGINA_ORDENES, ordenesDeLaEmpresaEnTx, proveedoresDeLaEmpresaEnTx } from '@/modules/inventory/compras-queries'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosOrdenes, leerFiltrosOrdenes } from '@/modules/inventory/filtros'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'
const ESTADOS: EstadoOrden[] = ['DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED']

export default async function ComprasInventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const puedeComprar = await puedeFuncion('inventario', 'comprar')
  if (!puedeComprar) {
    return (
      <div className="space-y-6">
        <PageHeader title="Compras a proveedores" description="Órdenes de compra: lo que se le pide a cada proveedor, a qué costo, y lo que va llegando." />
        <NavegacionInventario actual="compras" />
        <Alert>
          <AlertDescription>No tienes permiso para ver ni gestionar las compras a proveedores.</AlertDescription>
        </Alert>
      </div>
    )
  }
  const { filtros, cursor } = leerFiltrosOrdenes(await searchParams)

  let datos: {
    zona: string
    sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>
    proveedores: Awaited<ReturnType<typeof proveedoresDeLaEmpresaEnTx>>['filas']
    abiertas: Awaited<ReturnType<typeof ordenesDeLaEmpresaEnTx>>
    pagina: Awaited<ReturnType<typeof ordenesDeLaEmpresaEnTx>>
    filtros: typeof filtros
  } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const { filas: proveedores } = await proveedoresDeLaEmpresaEnTx(tx, companyId, { incluirInactivos: true })
      // Lo que llega por la URL es texto libre: una sucursal o un proveedor solo filtran si son de esta empresa.
      const f = { ...filtros, sucursalId: sucursales.find((s) => s.id === filtros.sucursalId)?.id, proveedorId: proveedores.find((p) => p.id === filtros.proveedorId)?.id }
      if (!f.sucursalId) delete f.sucursalId
      if (!f.proveedorId) delete f.proveedorId
      return {
        zona,
        sucursales,
        proveedores,
        filtros: f,
        abiertas: await ordenesDeLaEmpresaEnTx(tx, companyId, {}, { zonaHoraria: zona, limite: 50, abiertas: true }),
        pagina: await ordenesDeLaEmpresaEnTx(tx, companyId, f, { zonaHoraria: zona, cursor }),
      }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-compras', e)
  }

  const f = datos?.filtros ?? {}
  const hayFiltros = Object.keys(f).length > 0
  const consulta = consultaDeFiltrosOrdenes(f)
  const hayProveedores = (datos?.proveedores.filter((p) => p.activo).length ?? 0) > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compras a proveedores"
        description="Órdenes de compra: lo que se le pide a cada proveedor, a qué costo, y lo que va llegando. Cada recepción entra al inventario con el costo de la orden."
        action={
          <Button asChild size="sm">
            <Link href="/admin/inventario/compras/nueva">
              <ShoppingCart className="mr-2 h-4 w-4" aria-hidden />
              Nueva orden
            </Link>
          </Button>
        }
      />
      <NavegacionInventario actual="compras" />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          {!hayProveedores && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                Para hacer una orden primero registra a tu proveedor.
                <Button asChild size="sm" variant="outline">
                  <Link href="/admin/inventario/proveedores">Ir a proveedores</Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {datos.abiertas.filas.length > 0 && (
            <section aria-labelledby="por-llegar" className="space-y-2">
              <h2 id="por-llegar" className="text-lg font-semibold">
                Esperando mercancía
              </h2>
              <ul className="divide-y rounded-lg border" aria-label="Órdenes esperando mercancía">
                {datos.abiertas.filas.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/inventario/compras/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted/40">
                      <span className="font-medium">
                        {o.numero} <span className="font-normal text-muted-foreground">· {o.proveedorNombre} → {o.sucursalNombre}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatearCantidad(o.pendientes)} unidad{o.pendientes === 1 ? '' : 'es'} por llegar
                        {o.previstaEn && ` · prevista ${formatDate(o.previstaEn, { zonaHoraria: 'UTC' })}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar órdenes de compra">
            <div className="space-y-1">
              <label htmlFor="oc-q" className="text-xs text-muted-foreground">
                Número, referencia o proveedor
              </label>
              <Input id="oc-q" name="q" defaultValue={f.q ?? ''} placeholder="OC-2026-000003 o Distribuidora" className="w-64" maxLength={80} />
            </div>
            {datos.proveedores.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="oc-proveedor" className="text-xs text-muted-foreground">
                  Proveedor
                </label>
                <select id="oc-proveedor" name="proveedor" defaultValue={f.proveedorId ?? ''} className={CAMPO}>
                  <option value="">Todos</option>
                  {datos.proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                      {p.activo ? '' : ' (desactivado)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="oc-sucursal" className="text-xs text-muted-foreground">
                  Sucursal que recibe
                </label>
                <select id="oc-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
              <label htmlFor="oc-estado" className="text-xs text-muted-foreground">
                Estado
              </label>
              <select id="oc-estado" name="estado" defaultValue={f.estado ?? ''} className={CAMPO}>
                <option value="">Todos</option>
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>
                    {ETIQUETA_ESTADO_ORDEN[e]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="oc-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="oc-desde" type="date" name="desde" defaultValue={f.desde ?? ''} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="oc-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="oc-hasta" type="date" name="hasta" defaultValue={f.hasta ?? ''} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href="/admin/inventario/compras" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {datos.pagina.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : 'Todavía no hay órdenes de compra'}</p>
                {!hayFiltros && <p className="text-sm">Cuando le pidas mercancía a un proveedor, la orden queda aquí con su número, lo que cuesta y lo que ya llegó.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Órdenes de compra">
              {datos.pagina.filas.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/inventario/compras/${o.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {o.numero} <span className="font-normal text-muted-foreground">· {o.proveedorNombre} → {o.sucursalNombre}</span>
                        <Badge variant={puedeRecibirse(o.estado) || o.estado === 'DRAFT' ? 'default' : 'outline'} className="ml-2 align-middle">
                          {ETIQUETA_ESTADO_ORDEN[o.estado]}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeExacto(o.creadoEn, { zonaHoraria: datos.zona })} · {o.creadoPorNombre ?? 'Sistema'}
                        {o.referencia && ` · ${o.referencia}`}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground tabular-nums">
                      <p>
                        {o.valor} · {formatearCantidad(o.unidades)} unidad{o.unidades === 1 ? '' : 'es'} · {formatearCantidad(o.lineas)} producto{o.lineas === 1 ? '' : 's'}
                      </p>
                      <p>
                        {formatearCantidad(o.recibidas)} recibidas{o.pendientes > 0 && ` · ${formatearCantidad(o.pendientes)} por llegar`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {(cursor || datos.pagina.siguiente) && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación de órdenes">
              {cursor ? (
                <Link href={`/admin/inventario/compras${consulta ? `?${consulta}` : ''}`} className="underline">
                  ← Volver a lo más reciente
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">{POR_PAGINA_ORDENES} por página</span>
              {datos.pagina.siguiente ? (
                <Link href={`/admin/inventario/compras?${consultaDeFiltrosOrdenes(f, datos.pagina.siguiente)}`} className="underline">
                  Más antiguas →
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
