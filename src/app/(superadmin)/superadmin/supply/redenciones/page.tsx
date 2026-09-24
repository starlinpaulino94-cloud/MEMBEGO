import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDateTime, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { reporteRedenciones } from '@/modules/supply/pool'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Redenciones de supply' }

/**
 * MEMBEGO SUPPLY · reporte de REDENCIONES (Fase 48).
 *
 * Contesta, fila a fila, la pregunta que el prompt exige poder responder sin
 * llamar al comercio: quién recibió la unidad, quién se la entregó, en qué
 * sucursal, a qué hora, por qué campaña y cuánto le costó a Membego.
 *
 * Las reversadas se ENSEÑAN, marcadas. Esconderlas haría que los totales no
 * cuadraran con el ledger y dejaría el caso más delicado —una entrega deshecha—
 * sin rastro visible.
 */
export default async function RedencionesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; proveedor?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { desde, hasta, proveedor } = await searchParams

  const filas = await reporteRedenciones({
    desde: desde ? new Date(desde) : undefined,
    hasta: hasta ? new Date(hasta) : undefined,
    proveedorId: proveedor || undefined,
  })

  const vivas = filas.filter((f) => !f.reversada)
  const costoTotal = vivas.reduce((t, f) => t + f.costoUnitario, 0)
  const extras = vivas.reduce((t, f) => t + f.extras, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Redenciones"
        description="Cada unidad entregada, con su cliente, su empleado, su sucursal, su lote y su campaña. Esto es el gasto real de Membego."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="redenciones" />}
      />

      <Card>
        <CardContent className="pt-6">
          <p className="mb-4 text-sm">
            <strong>{vivas.length.toLocaleString('es-DO')}</strong> entregas vivas ·{' '}
            <strong>{formatMoneyRD(costoTotal)}</strong> de costo consumido ·{' '}
            {formatMoneyRD(extras)} cobrados por los comercios en extras (dinero del comercio, no
            de Membego).
          </p>

          <TablaReporte
            titulo="Redenciones de Membego Supply"
            columnas={[
              { clave: 'fecha', titulo: 'Fecha' },
              { clave: 'cliente', titulo: 'Cliente' },
              { clave: 'item', titulo: 'Producto' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'sucursal', titulo: 'Sucursal' },
              { clave: 'empleado', titulo: 'Entregó' },
              { clave: 'lote', titulo: 'Lote' },
              { clave: 'campana', titulo: 'Campaña' },
              { clave: 'costo', titulo: 'Costo', alinearDerecha: true },
              { clave: 'extras', titulo: 'Extras', alinearDerecha: true },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={filas.map((f) => ({
              __clave: f.id,
              fecha: formatDateTime(f.fecha),
              cliente: f.cliente,
              item: f.item,
              proveedor: f.proveedor,
              sucursal: f.sucursal ?? '—',
              empleado: f.empleado ?? '—',
              lote: f.loteCodigo,
              campana: f.campana ?? 'Sin campaña',
              costo: formatMoneyRD(f.costoUnitario),
              extras: f.extras > 0 ? formatMoneyRD(f.extras) : '—',
              estado: f.reversada ? (
                <Badge variant="destructive">Reversada</Badge>
              ) : (
                <Badge variant="success">Entregada</Badge>
              ),
            }))}
            vacio="Todavía no se ha entregado ninguna unidad."
          />
        </CardContent>
      </Card>
    </div>
  )
}
