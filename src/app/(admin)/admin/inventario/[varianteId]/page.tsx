import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { detalleVarianteEnTx, historialDeVarianteEnTx, reservasVivasEnTx } from '@/modules/inventory/queries'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { formatDateTime } from '@/lib/format'
import { SucursalInventarioCard } from '@/components/inventario/SucursalInventarioCard'
import { TransferirForm } from '@/components/inventario/TransferirForm'
import { HistorialMovimientos } from '@/components/inventario/HistorialMovimientos'

export const dynamic = 'force-dynamic'

export default async function InventarioVariantePage({ params }: { params: Promise<{ varianteId: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { varianteId } = await params

  const datos = await conEmpresa(companyId, async (tx) => {
    const detalle = await detalleVarianteEnTx(tx, companyId, varianteId)
    if (!detalle) return null
    return {
      detalle,
      historial: await historialDeVarianteEnTx(tx, companyId, varianteId),
      reservas: await reservasVivasEnTx(tx, companyId, varianteId),
    }
  })
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos) notFound()
  const { detalle, historial, reservas } = datos
  const [puedeAjustar, puedeTransferir] = await Promise.all([puedeFuncion('inventario', 'ajustar'), puedeFuncion('inventario', 'transferir')])

  const activas = detalle.sucursales.filter((s) => s.activa)
  const total = detalle.sucursales.reduce(
    (t, s) => ({ disponible: t.disponible + s.disponible, reserved: t.reserved + s.reserved, damaged: t.damaged + s.damaged, onHand: t.onHand + s.onHand }),
    { disponible: 0, reserved: 0, damaged: 0, onHand: 0 }
  )
  const historialSerializable = {
    siguiente: historial.siguiente,
    filas: historial.filas.map((f) => ({ ...f, creadoEn: f.creadoEn.toISOString() })),
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Inventario
          </Link>
        }
        title={nombreCompleto(detalle.itemNombre, detalle.nombreVariante, detalle.esDefault)}
        description={`SKU ${detalle.sku}`}
        action={
          <Link href={`/admin/catalogo/${detalle.itemId}`} className="text-sm underline">
            Ver en el catálogo
          </Link>
        }
      />

      {!detalle.controlaInventario && (
        <Alert>
          <AlertDescription>
            Este producto no controla inventario, así que no se pueden registrar movimientos. Actívalo en{' '}
            <Link href={`/admin/catalogo/${detalle.itemId}`} className="underline">
              su ficha del catálogo
            </Link>
            . El historial se conserva.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Totales de todas las sucursales">
        {(
          [
            ['Disponible', total.disponible],
            ['Apartado', total.reserved],
            ['Dañado', total.damaged],
            ['En existencia', total.onHand],
          ] as const
        ).map(([etiqueta, valor]) => (
          <Card key={etiqueta}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{etiqueta} (total)</p>
              <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(valor)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {detalle.controlaInventario && (
        <>
          {activas.length === 0 && detalle.sucursales.length === 0 && (
            <Alert>
              <AlertDescription>
                Para llevar existencias necesitas una sucursal activa.{' '}
                <Link href="/admin/sucursales" className="underline">
                  Ir a sucursales
                </Link>
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {detalle.sucursales.map((s) => (
              <SucursalInventarioCard
                key={s.sucursalId}
                varianteId={detalle.varianteId}
                puedeAjustar={puedeAjustar}
                saldo={{ sucursalId: s.sucursalId, nombre: s.nombre, activa: s.activa, onHand: s.onHand, reserved: s.reserved, damaged: s.damaged, disponible: s.disponible, lowStockThreshold: s.lowStockThreshold, estado: s.estado }}
              />
            ))}
          </div>
          {activas.length > 1 && puedeTransferir && (
            <TransferirForm varianteId={detalle.varianteId} sucursales={activas.map((s) => ({ id: s.sucursalId, nombre: s.nombre, disponible: s.disponible }))} />
          )}
        </>
      )}

      {reservas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reservas vivas ({reservas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" aria-label="Reservas vivas">
              {reservas.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {formatearCantidad(r.cantidad)} en {r.sucursalNombre}
                    {r.referenciaTipo === 'ORDER' && r.referenciaId ? ` · pedido ${r.referenciaId.slice(-8)}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">vence {formatDateTime(r.expiresAt)}</span>
                </li>
              ))}
            </ul>
            <p className="pt-2 text-xs text-muted-foreground">Las reservas las crean los pedidos y se liberan solas al vencer.</p>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="historial">
        <h2 id="historial" className="mb-3 text-lg font-semibold">
          Historial de movimientos
        </h2>
        {/* La clave remonta el historial cuando entra un movimiento nuevo: su estado local no se enteraría del refresh. */}
        <HistorialMovimientos key={historialSerializable.filas[0]?.id ?? 'vacio'} varianteId={detalle.varianteId} inicial={historialSerializable} />
      </section>
    </div>
  )
}
