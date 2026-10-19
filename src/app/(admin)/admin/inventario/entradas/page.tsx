import Link from 'next/link'
import { FileInput, PackagePlus, Upload } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { POR_PAGINA_ENTRADAS, entradasDeLaEmpresaEnTx, sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosEntradas, leerFiltrosEntradas } from '@/modules/inventory/filtros'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'

export default async function EntradasInventarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { filtros, cursor } = leerFiltrosEntradas(await searchParams)
  const puedeAjustar = await puedeFuncion('inventario', 'ajustar')

  let datos: {
    zona: string
    sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>
    pagina: Awaited<ReturnType<typeof entradasDeLaEmpresaEnTx>>
  } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...filtros, sucursalId: sucursales.find((s) => s.id === filtros.sucursalId)?.id }
      if (!f.sucursalId) delete f.sucursalId
      return { zona, sucursales, pagina: await entradasDeLaEmpresaEnTx(tx, companyId, f, { zonaHoraria: zona, cursor }) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-entradas', e)
  }

  const f = { ...filtros, sucursalId: datos?.sucursales.find((s) => s.id === filtros.sucursalId)?.id }
  if (!f.sucursalId) delete f.sucursalId
  const hayFiltros = Object.keys(f).length > 0
  const consulta = consultaDeFiltrosEntradas(f)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entradas de mercancía"
        description="La mercancía que llegó, factura por factura: qué entró, dónde, cuándo y quién lo registró."
        action={
          puedeAjustar ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/admin/inventario/entradas/nueva">
                  <PackagePlus className="mr-2 h-4 w-4" aria-hidden />
                  Nueva entrada
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/inventario/importar">
                  <Upload className="mr-2 h-4 w-4" aria-hidden />
                  Importar CSV
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />
      <NavegacionInventario actual="entradas" />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          <form key={consulta} method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar entradas">
            <div className="space-y-1">
              <label htmlFor="en-q" className="text-xs text-muted-foreground">
                Número o factura
              </label>
              <Input id="en-q" name="q" defaultValue={f.q ?? ''} placeholder="ENT-2026-000012 o F-1045" className="w-64" maxLength={80} />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="en-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="en-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
              <label htmlFor="en-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="en-desde" type="date" name="desde" defaultValue={f.desde ?? ''} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="en-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="en-hasta" type="date" name="hasta" defaultValue={f.hasta ?? ''} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href="/admin/inventario/entradas" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {datos.pagina.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <FileInput className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : 'Todavía no hay entradas registradas'}</p>
                {!hayFiltros && <p className="text-sm">Cuando llegue mercancía, regístrala aquí con su factura: queda como un documento con número y todas sus líneas.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Entradas de mercancía">
              {datos.pagina.filas.map((e) => (
                <li key={e.id}>
                  <Link href={`/admin/inventario/entradas/${e.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {e.numero} <span className="font-normal text-muted-foreground">· {e.sucursalNombre}</span>
                        {e.origen === 'CSV' && (
                          <Badge variant="outline" className="ml-2 align-middle">
                            CSV
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTimeExacto(e.creadoEn, { zonaHoraria: datos.zona })} · {e.usuarioNombre ?? 'Sistema'}
                        {e.referencia && ` · ${e.referencia}`}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-semibold text-success">+{formatearCantidad(e.unidades)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatearCantidad(e.lineas)} producto{e.lineas === 1 ? '' : 's'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {(cursor || datos.pagina.siguiente) && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación de entradas">
              {cursor ? (
                <Link href={`/admin/inventario/entradas${consulta ? `?${consulta}` : ''}`} className="underline">
                  ← Volver a lo más reciente
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">{POR_PAGINA_ENTRADAS} por página</span>
              {datos.pagina.siguiente ? (
                <Link href={`/admin/inventario/entradas?${consultaDeFiltrosEntradas(f, datos.pagina.siguiente)}`} className="underline">
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
