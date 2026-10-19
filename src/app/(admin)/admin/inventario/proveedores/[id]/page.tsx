import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, Star } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDate, formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { ProveedorForm } from '@/components/inventario/ProveedorForm'
import { ETIQUETA_ESTADO_ORDEN } from '@/modules/inventory/compras'
import { proveedorDetalleEnTx } from '@/modules/inventory/compras-queries'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function ProveedorInventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  const puedeComprar = await puedeFuncion('inventario', 'comprar')
  if (!puedeComprar) {
    return (
      <Alert>
        <AlertDescription>No tienes permiso para ver ni gestionar los proveedores.</AlertDescription>
      </Alert>
    )
  }

  let datos: { zona: string; proveedor: Awaited<ReturnType<typeof proveedorDetalleEnTx>> } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), proveedor: await proveedorDetalleEnTx(tx, companyId, id) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-proveedor', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos?.proveedor) notFound()
  const { proveedor: p, zona } = datos

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/proveedores" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Proveedores
          </Link>
        }
        title={p.nombre}
        description={`${p.diasCredito === 0 ? 'De contado' : `${p.diasCredito} días de crédito`} · registrado ${formatDate(p.creadoEn, { zonaHoraria: zona })}`}
      />
      {!p.activo && (
        <div>
          <Badge variant="outline">Desactivado</Badge>
        </div>
      )}

      <ProveedorForm
        key={`${p.id}-${p.nombre}-${p.activo}`}
        proveedor={{ id: p.id, nombre: p.nombre, rnc: p.rnc, contacto: p.contacto, telefono: p.telefono, correo: p.correo, diasCredito: p.diasCredito, notas: p.notas, activo: p.activo }}
      />

      <section aria-labelledby="productos-proveedor" className="space-y-2">
        <h2 id="productos-proveedor" className="text-lg font-semibold">
          Productos que surte ({formatearCantidad(p.productos)})
        </h2>
        {p.productosSurtidos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay productos. Se agregan solos al recibir una orden de este proveedor, o a mano desde la ficha de cada producto.</p>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Productos del proveedor">
            {p.productosSurtidos.map((l) => (
              <li key={l.varianteId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/inventario/${l.varianteId}`} className="font-medium underline-offset-2 hover:underline">
                    {nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault)}
                  </Link>
                  {l.preferido && (
                    <Badge className="ml-2 align-middle">
                      <Star className="mr-1 h-3 w-3" aria-hidden />
                      Preferido
                    </Badge>
                  )}
                  <p className="text-xs text-muted-foreground">
                    SKU {l.sku}
                    {l.codigoProveedor && ` · su código ${l.codigoProveedor}`}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground tabular-nums">
                  <p>{l.ultimoCosto ? `Último costo ${l.ultimoCosto}${l.ultimoCostoEn ? ` (${formatDate(l.ultimoCostoEn, { zonaHoraria: zona })})` : ''}` : 'Todavía no se le ha comprado'}</p>
                  {l.diasEntrega !== null && <p>Entrega en {l.diasEntrega} día{l.diasEntrega === 1 ? '' : 's'}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ordenes-proveedor" className="space-y-2">
        <h2 id="ordenes-proveedor" className="text-lg font-semibold">
          Órdenes recientes
        </h2>
        {p.ordenes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay órdenes de compra para este proveedor.</p>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Órdenes del proveedor">
            {p.ordenes.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/inventario/compras/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted/40">
                  <span className="font-medium">
                    {o.numero}
                    <Badge variant="outline" className="ml-2 align-middle">
                      {ETIQUETA_ESTADO_ORDEN[o.estado]}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatearCantidad(o.unidades)} unidad{o.unidades === 1 ? '' : 'es'} · {formatDateTimeExacto(o.creadoEn, { zonaHoraria: zona })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
