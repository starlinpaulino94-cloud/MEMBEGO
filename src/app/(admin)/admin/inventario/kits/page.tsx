import Link from 'next/link'
import { Package } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { KitForm } from '@/components/inventario/KitForm'
import { KitEditable } from '@/components/inventario/KitEditable'
import { formatearCantidad } from '@/modules/inventory/formato'
import { kitsDeLaEmpresaEnTx, type KitVista } from '@/modules/inventory/kits-queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

/**
 * KITS (INV-5d): paquetes que descuentan sus componentes. Un kit es un producto SIN existencias propias, armado con una receta (cuántas unidades
 * de cada componente lleva). Aquí se arma y se edita la receta, y se ve cuántos kits alcanzan en cada sucursal con lo que hay de sus componentes.
 * Vender uno aparta, vende, libera y devuelve los componentes por las mismas puertas de siempre (lotes, series y costos incluidos).
 */
export default async function KitsPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const puedeAjustar = await puedeFuncion('inventario', 'ajustar')

  let kits: KitVista[] | null = null
  let fallo = ''
  try {
    kits = await conEmpresa(companyId, (tx) => kitsDeLaEmpresaEnTx(tx, companyId))
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-kits', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Kits" description="Paquetes que descuentan sus componentes: un kit no lleva existencias propias, se arma de lo que hay de cada componente." />
      <NavegacionInventario actual="kits" />

      <Alert>
        <AlertDescription>
          Al vender un kit se aparta, se vende, se libera y se devuelve cada <strong>componente</strong> (con sus lotes y series, si los lleva). Cuántos kits alcanzan es lo que da el componente que primero se acaba. Cambiar la receta vale para las ventas que vengan; lo ya apartado en pedidos no cambia. Los kits no se anidan: un kit no puede ser componente de otro.
        </AlertDescription>
      </Alert>

      {puedeAjustar && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" aria-hidden />
              Armar un kit nuevo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <KitForm />
          </CardContent>
        </Card>
      )}

      {!kits ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : kits.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Todavía no hay kits.{puedeAjustar ? ' Arma el primero arriba.' : ''}</CardContent>
        </Card>
      ) : (
        <ul className="space-y-4" aria-label="Kits">
          {kits.map((k) => (
            <li key={k.varianteId}>
              <Card data-kit={k.nombre}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>
                      {k.nombre} <span className="text-xs font-normal text-muted-foreground">SKU {k.sku}</span>
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">Precio {k.precio}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="text-sm" aria-label={`Componentes de ${k.nombre}`}>
                    {k.componentes.map((c) => (
                      <li key={c.varianteId}>
                        <strong className="tabular-nums">{formatearCantidad(c.cantidad)}</strong> ×{' '}
                        <Link href={`/admin/inventario/${c.varianteId}`} className="underline">
                          {c.nombre}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {k.porSucursal.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label={`Cuántos ${k.nombre} alcanzan`}>
                      {k.porSucursal.map((s) => (
                        <li key={s.sucursalId}>
                          <Badge variant={s.kits > 0 ? 'success' : 'destructive'} data-sucursal={s.sucursal}>
                            {s.sucursal}: {formatearCantidad(s.kits)}
                            {s.kits === 0 && s.limitante ? ` · falta ${s.limitante}` : ''}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                  {puedeAjustar && <KitEditable kit={{ varianteId: k.varianteId, nombre: k.nombre, componentes: k.componentes }} />}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
