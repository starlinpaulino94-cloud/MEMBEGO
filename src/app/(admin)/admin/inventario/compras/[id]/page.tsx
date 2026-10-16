import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDate, formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { AccionesOrdenCompra } from '@/components/inventario/AccionesOrdenCompra'
import { RecibirOrdenCompraForm } from '@/components/inventario/RecibirOrdenCompraForm'
import { ETIQUETA_ESTADO_ORDEN, puedeRecibirse } from '@/modules/inventory/compras'
import { ordenDetalleEnTx } from '@/modules/inventory/compras-queries'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function OrdenCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  const puedeComprar = await puedeFuncion('inventario', 'comprar')
  if (!puedeComprar) {
    return (
      <Alert>
        <AlertDescription>No tienes permiso para ver las órdenes de compra: traen los costos que se pactaron con el proveedor.</AlertDescription>
      </Alert>
    )
  }

  let datos: { zona: string; orden: Awaited<ReturnType<typeof ordenDetalleEnTx>> } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), orden: await ordenDetalleEnTx(tx, companyId, id) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-compra', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos?.orden) notFound()
  const { orden: o, zona } = datos
  const abierta = puedeRecibirse(o.estado)
  const borrador = o.estado === 'DRAFT'

  const tarjetas: ReadonlyArray<readonly [string, string]> = [
    ['Pedido', `${formatearCantidad(o.unidades)} · ${o.valor}`],
    ['Recibido', `${formatearCantidad(o.recibidas)} · ${o.valorRecibido}`],
    ...(abierta ? ([['Por llegar', `${formatearCantidad(o.pendientes)} · ${o.valorPendiente}`]] as const) : []),
    ...(o.faltantes > 0 ? ([['Faltante', formatearCantidad(o.faltantes)]] as const) : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/compras" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Compras
          </Link>
        }
        title={o.numero}
        description={`${o.proveedorNombre} → ${o.sucursalNombre} · creada ${formatDateTimeExacto(o.creadoEn, { zonaHoraria: zona })}${o.creadoPorNombre ? ` por ${o.creadoPorNombre}` : ''}`}
        action={<BotonExportar href={`/admin/inventario/compras/${o.id}/exportar`} variant="outline" size="sm" />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={abierta || borrador ? 'default' : 'outline'}>{ETIQUETA_ESTADO_ORDEN[o.estado]}</Badge>
        <Link href={`/admin/inventario/proveedores/${o.proveedorId}`} className="text-sm underline-offset-2 hover:underline">
          {o.proveedorNombre}
        </Link>
        {o.referencia && <span className="text-sm text-muted-foreground">· {o.referencia}</span>}
        {o.previstaEn && <span className="text-sm text-muted-foreground">· prevista {formatDate(o.previstaEn, { zonaHoraria: 'UTC' })}</span>}
      </div>
      {o.nota && <p className="text-sm text-muted-foreground">{o.nota}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Resumen de la orden">
        {tarjetas.map(([etiqueta, valor]) => (
          <Card key={etiqueta}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{etiqueta}</p>
              <p className="text-lg font-semibold tabular-nums">{valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!abierta && !borrador && (
        <Alert>
          <AlertDescription>
            {o.estado === 'CANCELLED' ? 'Cancelada' : 'Cerrada'} {o.cerradoEn ? formatDateTimeExacto(o.cerradoEn, { zonaHoraria: zona }) : ''}
            {o.cerradoPorNombre ? ` por ${o.cerradoPorNombre}` : ''}
            {o.motivoCierre ? `: ${o.motivoCierre}` : '.'}{' '}
            {o.estado === 'CANCELLED' ? (o.pedidoEn ? 'No entró nada al inventario.' : 'Era un borrador: nunca se pidió.') : o.faltantes > 0 ? 'Lo que no llegó quedó como faltante.' : 'Llegó todo.'} Una orden cerrada no se edita.
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="lineas-orden" className="space-y-2">
        <h2 id="lineas-orden" className="text-lg font-semibold">
          Productos ({formatearCantidad(o.lineas)})
        </h2>
        <ul className="divide-y rounded-lg border" aria-label="Líneas de la orden">
          {o.detalle.map((l) => (
            <li key={l.varianteId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/admin/inventario/${l.varianteId}`} className="font-medium underline-offset-2 hover:underline">
                  {nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault)}
                </Link>
                <p className="text-xs text-muted-foreground">
                  SKU {l.sku}
                  {l.barcode && ` · ${l.barcode}`}
                  {l.llevaLotes && ' · lleva lotes'}
                </p>
                {l.lotesRecibidos && <p className="text-xs text-muted-foreground">Lotes recibidos: {l.lotesRecibidos}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-right tabular-nums">
                {(
                  [
                    ['Costo', l.costo],
                    ['Pedido', formatearCantidad(l.pedido)],
                    ...(borrador ? [] : ([['Recibido', formatearCantidad(l.recibido)]] as const)),
                    ...(abierta ? ([['Por llegar', formatearCantidad(l.pendiente)]] as const) : []),
                    ...(l.cancelado > 0 ? ([['Faltante', formatearCantidad(l.cancelado)]] as const) : []),
                    ['Valor', l.valor],
                  ] as ReadonlyArray<readonly [string, string]>
                ).map(([etiqueta, valor]) => (
                  <div key={etiqueta}>
                    <p className="text-xs text-muted-foreground">{etiqueta}</p>
                    <p>{valor}</p>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Los costos son los pactados con el proveedor, sin impuestos.</p>
      </section>

      {(borrador || (abierta && o.estado === 'ORDERED')) && (
        <AccionesOrdenCompra ordenId={o.id} numero={o.numero} estado={borrador ? 'DRAFT' : 'ORDERED'} proveedorNombre={o.proveedorNombre} unidades={o.unidades} valor={o.valor} />
      )}

      {abierta && (
        <RecibirOrdenCompraForm
          key={o.detalle.map((l) => l.pendiente).join('-')}
          ordenId={o.id}
          sucursalNombre={o.sucursalNombre}
          hayRecibido={o.recibidas > 0}
          lineas={o.detalle.filter((l) => l.pendiente > 0).map((l) => ({ varianteId: l.varianteId, nombre: nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault), sku: l.sku, pendiente: l.pendiente, costo: l.costo, llevaLotes: l.llevaLotes, exigeVencimiento: l.exigeVencimiento }))}
        />
      )}

      <section aria-labelledby="entradas-orden" className="space-y-2">
        <h2 id="entradas-orden" className="text-lg font-semibold">
          Entradas de mercancía
        </h2>
        {o.entradas.length === 0 ? (
          <p className="text-sm text-muted-foreground">{borrador ? 'Todavía no se ha pedido.' : o.estado === 'CANCELLED' ? 'No llegó nada.' : 'Todavía no ha llegado nada. Cada tanda que recibas queda aquí con su número de entrada.'}</p>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Entradas de la orden">
            {o.entradas.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/inventario/entradas/${e.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted/40">
                  <span className="font-medium">
                    {e.numero}
                    {e.referencia && <span className="font-normal text-muted-foreground"> · {e.referencia}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    +{formatearCantidad(e.unidades)} · {formatDateTimeExacto(e.creadoEn, { zonaHoraria: zona })} · {e.usuarioNombre ?? 'Sistema'}
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
