import Link from 'next/link'
import { Hourglass } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTime } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { MAX_RESERVAS_LISTA, reservasVivasEmpresaEnTx } from '@/modules/inventory/queries'
import { describirReferencia, formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'

export const dynamic = 'force-dynamic'

export default async function ReservasInventarioPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)

  let datos: { zona: string; reservas: Awaited<ReturnType<typeof reservasVivasEmpresaEnTx>> } | null = null
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), reservas: await reservasVivasEmpresaEnTx(tx, companyId) }
    })
  } catch (e) {
    console.error('[admin-inventario-reservas]', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Reservas de inventario" description="Lo que hoy está apartado para un pedido y hasta cuándo. Es la diferencia entre lo que hay en existencia y lo que se puede vender." />
      <NavegacionInventario actual="reservas" />

      {!datos ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No se pudieron cargar las reservas. Intenta de nuevo en un momento.</CardContent>
        </Card>
      ) : datos.reservas.total === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Hourglass className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">No hay nada apartado ahora mismo</p>
            <p className="text-sm">Cuando un cliente haga un pedido de un producto con inventario, sus unidades aparecen aquí hasta que se entregue, se cancele o venza.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {formatearCantidad(datos.reservas.total)} reserva{datos.reservas.total === 1 ? '' : 's'} viva{datos.reservas.total === 1 ? '' : 's'}, con {formatearCantidad(datos.reservas.unidades)} unidad
            {datos.reservas.unidades === 1 ? '' : 'es'} apartada{datos.reservas.unidades === 1 ? '' : 's'}. Ordenadas por la que vence primero.
          </p>
          <ul className="divide-y rounded-lg border" aria-label="Reservas vivas de la empresa">
            {datos.reservas.filas.map((r) => {
              const ref = describirReferencia(r.referenciaTipo, r.referenciaId)
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <Link href={`/admin/inventario/${r.varianteId}`} className="underline-offset-2 hover:underline">
                        {nombreCompleto(r.itemNombre, r.nombreVariante, r.esDefault)}
                      </Link>{' '}
                      <span className="text-xs font-normal text-muted-foreground">SKU {r.sku}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.sucursalNombre}
                      {r.referenciaTipo === 'ORDER' && r.referenciaId ? (
                        <>
                          {' · '}
                          <Link href={`/admin/pedidos-membego/${r.referenciaId}`} className="underline underline-offset-2">
                            {ref ?? 'Ver el pedido'}
                          </Link>
                        </>
                      ) : ref ? (
                        ` · ${ref}`
                      ) : null}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-semibold">{formatearCantidad(r.cantidad)}</p>
                    <p className="text-xs text-muted-foreground">vence {formatDateTime(r.expiresAt, { zonaHoraria: datos.zona })}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          {datos.reservas.total > datos.reservas.filas.length && (
            <p className="text-xs text-muted-foreground">
              Se muestran las {formatearCantidad(MAX_RESERVAS_LISTA)} que vencen primero; hay {formatearCantidad(datos.reservas.total - datos.reservas.filas.length)} más.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Las reservas las crean los pedidos del marketplace y la caja: se convierten en venta al entregar con el QR, se liberan al cancelar y vencen solas si nadie las toca.
          </p>
        </>
      )}
    </div>
  )
}
