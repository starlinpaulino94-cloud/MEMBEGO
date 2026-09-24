import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { SUPPLY_ORDEN_ESTADO_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Órdenes de compra de supply' }

/**
 * MEMBEGO SUPPLY · órdenes de compra (Fase 3).
 *
 * La columna «Aprobada por» está a propósito junto a «Creada por»: una orden
 * es un compromiso financiero de cientos de miles de pesos y las dos casillas
 * tienen que poder leerse de un vistazo. Cuando una lleva semanas con la
 * segunda vacía, eso es el dato.
 */
export default async function OrdenesPage() {
  await requireRole('SUPERADMIN')

  const ordenes = await sinEmpresa('Membego Supply: órdenes de compra de la plataforma', (tx) =>
    tx.supplyOrden.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        numero: true,
        estado: true,
        total: true,
        createdAt: true,
        aprobadoAt: true,
        proveedor: { select: { name: true } },
        acuerdo: { select: { id: true, codigo: true } },
        creadoPor: { select: { name: true } },
        aprobadoPor: { select: { name: true } },
        _count: { select: { lineas: true, lotes: true } },
      },
    })
  )

  const pendientes = ordenes.filter((o) => o.estado === 'PENDIENTE_APROBACION')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Órdenes de compra"
        description="Lo que Membego compró de verdad: proveedor, producto, cantidad, costo y quién lo aprobó."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="ordenes" />}
      />

      {pendientes.length > 0 && (
        <Card className="border-warning/40">
          <CardContent className="pt-6 text-sm">
            <strong>{pendientes.length} orden(es) esperan aprobación</strong> por{' '}
            {formatMoneyRD(pendientes.reduce((t, o) => t + Number(o.total), 0))}. Ninguna genera
            supply hasta que alguien distinto de quien la creó la apruebe.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Órdenes de compra de supply"
            columnas={[
              { clave: 'numero', titulo: 'Número' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'acuerdo', titulo: 'Acuerdo' },
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'lineas', titulo: 'Líneas', alinearDerecha: true },
              { clave: 'total', titulo: 'Total', alinearDerecha: true },
              { clave: 'creador', titulo: 'Creada por' },
              { clave: 'aprobador', titulo: 'Aprobada por' },
              { clave: 'lotes', titulo: 'Lotes', alinearDerecha: true },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={ordenes.map((o) => ({
              __clave: o.id,
              numero: (
                <Link
                  href={`/superadmin/supply/ordenes/${o.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {o.numero}
                </Link>
              ),
              proveedor: o.proveedor.name,
              acuerdo: (
                <Link
                  href={`/superadmin/supply/acuerdos/${o.acuerdo.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {o.acuerdo.codigo}
                </Link>
              ),
              fecha: formatDate(o.createdAt),
              lineas: o._count.lineas,
              total: formatMoneyRD(Number(o.total)),
              creador: o.creadoPor?.name ?? '—',
              aprobador: o.aprobadoPor?.name ?? (
                <span className="text-warning">Sin aprobar</span>
              ),
              lotes: o._count.lotes,
              estado: (
                <Badge
                  variant={
                    o.estado === 'ACTIVA' || o.estado === 'COMPLETADA'
                      ? 'success'
                      : o.estado === 'CANCELADA'
                        ? 'outline'
                        : 'secondary'
                  }
                >
                  {SUPPLY_ORDEN_ESTADO_LABELS[o.estado]}
                </Badge>
              ),
            }))}
            vacio="Sin órdenes todavía."
          />
        </CardContent>
      </Card>
    </div>
  )
}
