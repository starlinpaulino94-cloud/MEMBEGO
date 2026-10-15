import Link from 'next/link'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { ReposicionGrupoCard, type GrupoReposicionVista } from '@/components/inventario/ReposicionGrupoCard'
import { costoParaCampo } from '@/modules/inventory/compras'
import { proveedoresDeLaEmpresaEnTx } from '@/modules/inventory/compras-queries'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosReposicion, leerFiltrosReposicion } from '@/modules/inventory/filtros'
import { MAX_NIVELES_REPOSICION, type GrupoDeReposicion } from '@/modules/inventory/reposicion'
import { reposicionEnTx, type DatosReposicion } from '@/modules/inventory/reposicion-queries'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'

/** Lo que cruza al navegador: texto y números, sin los tipos del servidor (el costo viaja como el texto de su campo). */
function aVista(g: GrupoDeReposicion): GrupoReposicionVista {
  return {
    clave: g.clave,
    proveedor: g.proveedor,
    sucursalId: g.sucursalId,
    sucursalNombre: g.sucursalNombre,
    borradores: g.borradores,
    lineas: g.lineas.map((l) => ({
      varianteId: l.varianteId,
      sku: l.sku,
      producto: l.producto,
      nombreVariante: l.nombreVariante,
      esDefault: l.esDefault,
      disponible: l.disponible,
      pedido: l.pedido,
      enCamino: l.enCamino,
      enBorrador: l.enBorrador,
      umbral: l.umbral,
      llenarHasta: l.llenarHasta,
      sugerida: l.sugerida,
      costo: l.ultimoCosto === null ? '' : costoParaCampo(l.ultimoCosto),
    })),
  }
}

export default async function ReposicionInventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const puedeComprar = await puedeFuncion('inventario', 'comprar')
  if (!puedeComprar) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reposición" description="Qué comprar: lo que falta para llegar a lo que quieres tener, agrupado por proveedor." />
        <NavegacionInventario actual="reposicion" />
        <Alert>
          <AlertDescription>No tienes permiso para ver ni gestionar las compras a proveedores.</AlertDescription>
        </Alert>
      </div>
    )
  }
  const pedido = leerFiltrosReposicion(await searchParams)

  let datos: {
    sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>
    proveedores: Awaited<ReturnType<typeof proveedoresDeLaEmpresaEnTx>>['filas']
    filtros: typeof pedido
    reposicion: DatosReposicion
  } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      const { filas: proveedores } = await proveedoresDeLaEmpresaEnTx(tx, companyId, { incluirInactivos: false })
      // Lo que llega por la URL es texto libre: una sucursal o un proveedor solo filtran si son de esta empresa.
      const f = { ...pedido }
      if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
      if (f.proveedorId !== 'sin' && !proveedores.some((p) => p.id === f.proveedorId)) delete f.proveedorId
      return { sucursales, proveedores, filtros: f, reposicion: await reposicionEnTx(tx, companyId, f) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-reposicion', e)
  }

  const f = datos?.filtros ?? {}
  const hayFiltros = Object.keys(f).length > 0
  const consulta = consultaDeFiltrosReposicion(f)
  const r = datos?.reposicion

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reposición"
        description="Qué comprar: lo que falta para llegar a «llenar hasta», descontando lo que ya pediste y lo que viene en camino, agrupado por proveedor y sucursal. Crear el borrador no pide nada: lo revisas y lo pides cuando estés listo."
        action={
          r && r.grupos.length > 0 ? <BotonExportar href={`/admin/inventario/reposicion/exportar${consulta ? `?${consulta}` : ''}`} variant="outline" size="sm" /> : undefined
        }
      />
      <NavegacionInventario actual="reposicion" />

      {!datos || !r ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar la reposición">
            <div className="space-y-1">
              <label htmlFor="rp-q" className="text-xs text-muted-foreground">
                Producto, SKU o código de barras
              </label>
              <Input id="rp-q" name="q" defaultValue={f.q ?? ''} className="w-64" maxLength={80} />
            </div>
            <div className="space-y-1">
              <label htmlFor="rp-sucursal" className="text-xs text-muted-foreground">
                Sucursal
              </label>
              <select id="rp-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
                <option value="">Todas</option>
                {datos.sucursales
                  .filter((s) => s.activa)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="rp-proveedor" className="text-xs text-muted-foreground">
                Proveedor
              </label>
              <select id="rp-proveedor" name="proveedor" defaultValue={f.proveedorId ?? ''} className={CAMPO}>
                <option value="">Todos</option>
                <option value="sin">Sin proveedor</option>
                {datos.proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href="/admin/inventario/reposicion" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {r.truncado && (
            <Alert>
              <AlertDescription>
                Hay más de {formatearCantidad(MAX_NIVELES_REPOSICION)} productos con «llenar hasta» y la lista está cortada: filtra por sucursal o por producto para ver el resto.
              </AlertDescription>
            </Alert>
          )}

          {r.alertasSinObjetivo > 0 && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {formatearCantidad(r.alertasSinObjetivo)} producto{r.alertasSinObjetivo === 1 ? '' : 's'} en alerta de stock bajo no tiene{r.alertasSinObjetivo === 1 ? '' : 'n'} «llenar hasta», así que no sale{r.alertasSinObjetivo === 1 ? '' : 'n'} aquí: no hay hasta
                  cuánto proponer. Fíjalo en la ficha de cada uno.
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link href="/admin/inventario?estado=BAJO">Ver alertas</Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {r.conObjetivo === 0 ? (
            <Card>
              <CardContent className="space-y-2 py-12 text-center text-muted-foreground">
                <p className="font-medium text-foreground">{hayFiltros ? 'Ningún producto con «llenar hasta» coincide con esos filtros.' : 'Todavía no has dicho hasta cuánto quieres tener de ningún producto.'}</p>
                <p className="text-sm">
                  Abre un producto en <Link href="/admin/inventario" className="underline">Existencias</Link>, y en su sucursal escribe «Llenar hasta». Cuando baje al umbral de aviso (o, sin umbral, quede por debajo), aparecerá aquí con lo que falta pedir.
                </p>
              </CardContent>
            </Card>
          ) : r.grupos.length === 0 ? (
            <Card>
              <CardContent className="space-y-1 py-12 text-center">
                <p className="font-medium">Todo está al día.</p>
                <p className="text-sm text-muted-foreground">
                  {formatearCantidad(r.conObjetivo)} producto{r.conObjetivo === 1 ? '' : 's'} con «llenar hasta» y ninguno necesita reponerse ahora, contando lo que ya pediste y lo que viene en camino.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4" aria-label="Resumen de la reposición">
                <div>
                  <dt className="text-xs text-muted-foreground">Por reponer</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{formatearCantidad(r.resumen.productos)}</dd>
                  <dd className="text-xs text-muted-foreground">
                    producto{r.resumen.productos === 1 ? '' : 's'} en {formatearCantidad(r.resumen.grupos)} grupo{r.resumen.grupos === 1 ? '' : 's'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Unidades sugeridas</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{formatearCantidad(r.resumen.unidades)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Valor sugerido</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{r.resumen.valor}</dd>
                  <dd className="text-xs text-muted-foreground">{r.resumen.sinCosto > 0 ? `sin contar ${formatearCantidad(r.resumen.sinCosto)} sin costo conocido` : 'con el último costo de cada proveedor'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Sin proveedor</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{formatearCantidad(r.resumen.sinProveedor)}</dd>
                  <dd className="text-xs text-muted-foreground">no se pueden pedir todavía</dd>
                </div>
              </dl>
              <div className="space-y-4">
                {r.grupos.map((g) => (
                  <ReposicionGrupoCard key={g.clave} grupo={aVista(g)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
