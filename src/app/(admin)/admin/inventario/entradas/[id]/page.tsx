import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { PageHeader } from '@/components/ui/page-header'
import { entradaDetalleEnTx } from '@/modules/inventory/queries'
import { ordenDeEntradaEnTx, type OrdenDeEntrada } from '@/modules/inventory/compras-queries'
import { formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

export default async function EntradaInventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const { id } = await params
  // Lo que costó la entrada solo lo ve quien tiene la función «costos»; la consulta ni lo lee para los demás.
  const conCostos = await puedeFuncion('inventario', 'costos')

  let datos: { zona: string; entrada: Awaited<ReturnType<typeof entradaDetalleEnTx>> } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { zona: zonaSegura(empresa?.zonaHoraria), entrada: await entradaDetalleEnTx(tx, companyId, id, { conCostos }) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-entrada', e)
  }
  if (fallo) {
    return (
      <Alert>
        <AlertDescription>{fallo}</AlertDescription>
      </Alert>
    )
  }
  // «No existe» y «es de otra empresa» se ven igual a propósito.
  if (!datos?.entrada) notFound()
  const { entrada, zona } = datos
  // La orden de compra que la produjo (INV-3b): solo con la función `comprar`, y en su PROPIA transacción y con su propio try:
  // si la migración de compras aún no se aplicó, la entrada se ve igual, solo que sin este enlace.
  let orden: OrdenDeEntrada | null = null
  if (await puedeFuncion('inventario', 'comprar')) {
    try {
      orden = await conEmpresa(companyId, (tx) => ordenDeEntradaEnTx(tx, companyId, id))
    } catch (e) {
      console.error('[admin-inventario-entrada] la orden de compra no está disponible', e instanceof Error ? e.message : e)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/inventario/entradas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Entradas
          </Link>
        }
        title={entrada.numero}
        description={`${entrada.sucursalNombre} · ${formatDateTimeExacto(entrada.creadoEn, { zonaHoraria: zona })}`}
        action={<BotonExportar href={`/admin/inventario/entradas/${entrada.id}/exportar`} variant="outline" size="sm" />}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label="Resumen de la entrada">
        {(
          [
            ['Productos', formatearCantidad(entrada.lineas)],
            ['Unidades', `+${formatearCantidad(entrada.unidades)}`],
            ['Registrada por', entrada.usuarioNombre ?? 'Sistema'],
            ['Origen', entrada.origen === 'CSV' ? 'Archivo CSV' : 'Capturada a mano'],
            ...(entrada.valorTotal !== undefined ? ([['Costo de la entrada', entrada.valorTotal]] as const) : []),
          ] as const
        ).map(([etiqueta, valor]) => (
          <Card key={etiqueta}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{etiqueta}</p>
              <p className="text-lg font-semibold tabular-nums">{valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {(entrada.referencia || entrada.nota || orden) && (
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            {orden && (
              <p>
                <span className="text-muted-foreground">Orden de compra: </span>
                <Link href={`/admin/inventario/compras/${orden.id}`} className="underline underline-offset-2">
                  {orden.numero}
                </Link>{' '}
                <span className="text-muted-foreground">({orden.proveedorNombre})</span>
              </p>
            )}
            {entrada.referencia && (
              <p>
                <span className="text-muted-foreground">Factura o referencia: </span>
                {entrada.referencia}
              </p>
            )}
            {entrada.nota && (
              <p>
                <span className="text-muted-foreground">Nota: </span>
                {entrada.nota}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="lineas">
        <h2 id="lineas" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          Productos de la entrada
          {entrada.origen === 'CSV' && <Badge variant="outline">CSV</Badge>}
        </h2>
        <ul className="divide-y rounded-lg border" aria-label="Líneas de la entrada">
          {entrada.detalle.map((l) => (
            <li key={l.varianteId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/admin/inventario/${l.varianteId}`} className="font-medium underline-offset-2 hover:underline">
                  {nombreCompleto(l.itemNombre, l.nombreVariante, l.esDefault)}
                </Link>
                <p className="text-xs text-muted-foreground">
                  SKU {l.sku}
                  {l.barcode && ` · ${l.barcode}`}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className="font-semibold text-success">+{formatearCantidad(l.cantidad)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatearCantidad(l.existenciaAntes)} → {formatearCantidad(l.existenciaDespues)}
                </p>
                {l.costo !== undefined && <p className="text-xs text-muted-foreground">{l.costo === null ? 'Sin costo' : `a ${l.costo} c/u`}</p>}
              </div>
            </li>
          ))}
        </ul>
        {entrada.lineasSinCosto !== undefined && entrada.lineasSinCosto > 0 && (
          <p className="pt-2 text-xs text-muted-foreground">
            {formatearCantidad(entrada.lineasSinCosto)} línea{entrada.lineasSinCosto === 1 ? '' : 's'} sin costo: no movieron el costo promedio del producto, y el «costo de la entrada» solo suma las que lo traen.
          </p>
        )}
        <p className="pt-2 text-xs text-muted-foreground">
          Una entrada registrada no se edita. Si algo se capturó mal, corrígelo con un ajuste en la ficha del producto: queda el rastro de qué se corrigió y por qué.
        </p>
      </section>
    </div>
  )
}
