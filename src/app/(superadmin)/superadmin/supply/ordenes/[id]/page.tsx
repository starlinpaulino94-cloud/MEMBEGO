import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { AccionesOrden } from '@/components/supply/acciones-orden'
import { SUPPLY_ORDEN_ESTADO_LABELS } from '@/modules/supply/catalogo'
import { TRANSICIONES_ORDEN } from '@/modules/supply/estados'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY · ficha de una ORDEN DE COMPRA.
 *
 * La pantalla desde la que el supply pasa a existir: al activar la orden se
 * crean los lotes y se asienta la compra en el ledger, en una sola operación.
 *
 * Quien creó la orden NO ve el botón de aprobar: la separación entre crear y
 * aprobar es lo único que impide que una sola persona comprometa el
 * presupuesto de la plataforma, y esconderlo evita el error antes de que el
 * servidor tenga que rechazarlo.
 */
export default async function OrdenDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const user = await getUser()

  const orden = await sinEmpresa('Membego Supply: ficha de una orden de compra', (tx) =>
    tx.supplyOrden.findUnique({
      where: { id },
      include: {
        proveedor: { select: { id: true, name: true } },
        acuerdo: { select: { id: true, codigo: true, modalidadPago: true } },
        creadoPor: { select: { id: true, name: true } },
        aprobadoPor: { select: { name: true } },
        lineas: true,
        lotes: {
          select: { id: true, codigo: true, compradas: true, disponibles: true, redimidas: true },
        },
      },
    })
  )

  if (!orden) notFound()

  const siguientes = TRANSICIONES_ORDEN[orden.estado]
  const soyElCreador = Boolean(
    user?.metadata.dbUserId && orden.creadoPor?.id === user.metadata.dbUserId
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={orden.numero}
        description={`${orden.proveedor.name} — ${formatMoneyRD(Number(orden.total))}`}
        eyebrow={
          <Link href="/superadmin/supply/ordenes" className="hover:underline">
            Órdenes de compra
          </Link>
        }
        nav={<NavSupply activa="ordenes" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Líneas</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              titulo="Qué compra esta orden"
              columnas={[
                { clave: 'item', titulo: 'Producto' },
                { clave: 'cantidad', titulo: 'Cantidad', alinearDerecha: true },
                { clave: 'costo', titulo: 'Costo unitario', alinearDerecha: true },
                { clave: 'subtotal', titulo: 'Subtotal', alinearDerecha: true },
              ]}
              filas={orden.lineas.map((l) => ({
                __clave: l.id,
                item: l.varianteEtiqueta ? `${l.itemNombre} · ${l.varianteEtiqueta}` : l.itemNombre,
                cantidad: l.cantidad.toLocaleString('es-DO'),
                costo: formatMoneyRD(Number(l.costoUnitario)),
                subtotal: formatMoneyRD(Number(l.subtotal)),
              }))}
              total={{
                item: 'Total',
                cantidad: orden.lineas.reduce((t, l) => t + l.cantidad, 0).toLocaleString('es-DO'),
                subtotal: formatMoneyRD(Number(orden.total)),
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dato label="Estado">
              <Badge variant={orden.estado === 'ACTIVA' ? 'success' : 'secondary'}>
                {SUPPLY_ORDEN_ESTADO_LABELS[orden.estado]}
              </Badge>
            </Dato>
            <Dato label="Acuerdo">
              <Link
                href={`/superadmin/supply/acuerdos/${orden.acuerdo.id}`}
                className="underline-offset-4 hover:underline"
              >
                {orden.acuerdo.codigo}
              </Link>
            </Dato>
            <Dato label="Subtotal">{formatMoneyRD(Number(orden.subtotal))}</Dato>
            <Dato label="Impuestos">{formatMoneyRD(Number(orden.impuestos))}</Dato>
            <Dato label="Total">
              <strong>{formatMoneyRD(Number(orden.total))}</strong>
            </Dato>
            <Dato label="Creada">{formatDate(orden.createdAt)}</Dato>
            <Dato label="Creada por">{orden.creadoPor?.name ?? '—'}</Dato>
            <Dato label="Aprobada por">
              {orden.aprobadoPor?.name ?? <span className="text-warning">Sin aprobar</span>}
            </Dato>
            {orden.condicionesPago && (
              <Dato label="Condiciones">{orden.condicionesPago}</Dato>
            )}
          </CardContent>
        </Card>
      </div>

      <AccionesOrden
        ordenId={orden.id}
        estadosPosibles={[...siguientes]}
        soyElCreador={soyElCreador}
        yaTieneLotes={orden.lotes.length > 0}
      />

      {orden.lotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lotes generados</CardTitle>
          </CardHeader>
          <CardContent>
            <TablaReporte
              titulo="Lotes de esta orden"
              columnas={[
                { clave: 'codigo', titulo: 'Lote' },
                { clave: 'compradas', titulo: 'Compradas', alinearDerecha: true },
                { clave: 'disponibles', titulo: 'Disponibles', alinearDerecha: true },
                { clave: 'redimidas', titulo: 'Redimidas', alinearDerecha: true },
              ]}
              filas={orden.lotes.map((l) => ({
                __clave: l.id,
                codigo: (
                  <Link
                    href={`/superadmin/supply/lotes/${l.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {l.codigo}
                  </Link>
                ),
                compradas: l.compradas.toLocaleString('es-DO'),
                disponibles: l.disponibles.toLocaleString('es-DO'),
                redimidas: l.redimidas.toLocaleString('es-DO'),
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}
