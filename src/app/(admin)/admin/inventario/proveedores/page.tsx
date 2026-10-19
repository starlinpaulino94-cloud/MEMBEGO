import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { ProveedorForm } from '@/components/inventario/ProveedorForm'
import { MAX_PROVEEDORES_LISTA, proveedoresDeLaEmpresaEnTx } from '@/modules/inventory/compras-queries'
import { formatearCantidad } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

type Parametros = Record<string, string | string[] | undefined>
const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function ProveedoresInventarioPage({ searchParams }: { searchParams: Promise<Parametros> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const puedeComprar = await puedeFuncion('inventario', 'comprar')
  if (!puedeComprar) {
    return (
      <div className="space-y-6">
        <PageHeader title="Proveedores" description="A quién le compras: sus datos, los productos que surten y su historial de órdenes." />
        <NavegacionInventario actual="proveedores" />
        <Alert>
          <AlertDescription>No tienes permiso para ver ni gestionar los proveedores.</AlertDescription>
        </Alert>
      </div>
    )
  }
  const sp = await searchParams
  const q = primero(sp.q)?.trim().slice(0, 80) ?? ''
  const incluirInactivos = primero(sp.inactivos) === '1'

  let datos: Awaited<ReturnType<typeof proveedoresDeLaEmpresaEnTx>> | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, (tx) => proveedoresDeLaEmpresaEnTx(tx, companyId, { q, incluirInactivos }))
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-proveedores', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Proveedores" description="A quién le compras: sus datos, los productos que surten y su historial de órdenes. Un proveedor no se borra: se desactiva y conserva su historial." />
      <NavegacionInventario actual="proveedores" />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Buscar proveedores">
            <div className="space-y-1">
              <label htmlFor="pv-q" className="text-xs text-muted-foreground">
                Nombre, RNC o contacto
              </label>
              <Input id="pv-q" name="q" defaultValue={q} className="w-64" maxLength={80} />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="inactivos" value="1" defaultChecked={incluirInactivos} className="h-4 w-4" />
              Incluir desactivados
            </label>
            <Button type="submit" variant="outline">
              Buscar
            </Button>
            {(q || incluirInactivos) && (
              <Link href="/admin/inventario/proveedores" className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          {datos.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{q || incluirInactivos ? 'Nada coincide con esa búsqueda' : 'Todavía no hay proveedores'}</p>
                {!q && !incluirInactivos && <p className="text-sm">Registra a quien te vende mercancía para poder hacerle órdenes de compra.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Proveedores">
              {datos.filas.map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/inventario/proveedores/${p.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {p.nombre}
                        {!p.activo && (
                          <Badge variant="outline" className="ml-2 align-middle">
                            Desactivado
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[p.contacto, p.telefono, p.correo].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                        {` · ${p.diasCredito === 0 ? 'de contado' : `${p.diasCredito} días de crédito`}`}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground tabular-nums">
                      <p>
                        {formatearCantidad(p.productos)} producto{p.productos === 1 ? '' : 's'}
                      </p>
                      {p.ordenesAbiertas > 0 && (
                        <p>
                          {formatearCantidad(p.ordenesAbiertas)} orden{p.ordenesAbiertas === 1 ? '' : 'es'} esperando mercancía
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {datos.truncado && <p className="text-xs text-muted-foreground">Se muestran los primeros {MAX_PROVEEDORES_LISTA} proveedores: busca por nombre para ver el resto.</p>}

          <ProveedorForm />
        </>
      )}
    </div>
  )
}
