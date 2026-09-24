import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import Form from 'next/form'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import {
  SUPPLY_DERECHO_ESTADO_LABELS,
  SUPPLY_ORIGEN_LABELS,
} from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Derechos de clientes' }

/**
 * MEMBEGO SUPPLY · derechos emitidos (Fase 11).
 *
 * «¿Quién recibió cada unidad?» tiene aquí su respuesta: una fila por persona,
 * con el lote del que salió, la campaña que la financió y su estado.
 *
 * ACTIVO y REDIMIDO se cuentan por separado arriba, otra vez: los activos son
 * una obligación pendiente del proveedor y todavía no costaron nada.
 */
export default async function DerechosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { estado, q } = await searchParams
  const busqueda = (q ?? '').trim().slice(0, 80)

  const { derechos, conteo } = await sinEmpresa(
    'Membego Supply: derechos emitidos en toda la plataforma',
    async (tx) => {
      const where = {
        ...(estado ? { estado: estado as never } : {}),
        ...(busqueda
          ? {
              OR: [
                { cliente: { nombre: { contains: busqueda, mode: 'insensitive' as const } } },
                { lote: { codigo: { contains: busqueda, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      }
      const [derechos, porEstado] = await Promise.all([
        tx.supplyDerecho.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 300,
          select: {
            id: true,
            estado: true,
            origen: true,
            vencAt: true,
            emitidoAt: true,
            redimidoAt: true,
            costoUnitario: true,
            precioCliente: true,
            cliente: { select: { id: true, nombre: true } },
            proveedor: { select: { name: true } },
            asignacion: { select: { etiqueta: true } },
            lote: { select: { id: true, codigo: true, snapshotItemNombre: true } },
            vouchers: { where: { estado: 'ACTIVO' }, select: { id: true }, take: 1 },
          },
        }),
        tx.supplyDerecho.groupBy({ by: ['estado'], _count: { _all: true } }),
      ])
      return {
        derechos,
        conteo: Object.fromEntries(porEstado.map((g) => [g.estado, g._count._all])) as Record<
          string,
          number
        >,
      }
    }
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Derechos de clientes"
        description="Quién tiene hoy el derecho a recibir qué, de qué lote salió y qué campaña lo financió."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="derechos" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Disponibles"
          value={(conteo.ACTIVO ?? 0).toLocaleString('es-DO')}
          sub="obligación viva del proveedor"
          accent="brand"
        />
        <StatCard
          label="Utilizados"
          value={(conteo.REDIMIDO ?? 0).toLocaleString('es-DO')}
          sub="entregados de verdad"
          accent="success"
        />
        <StatCard
          label="Retenidos"
          value={(conteo.RETENIDO ?? 0).toLocaleString('es-DO')}
          sub="en checkout o reserva"
        />
        <StatCard
          label="Vencidos o cancelados"
          value={((conteo.VENCIDO ?? 0) + (conteo.CANCELADO ?? 0) + (conteo.REVOCADO ?? 0)).toLocaleString(
            'es-DO'
          )}
          sub="cerrados sin usarse"
        />
      </div>

      <Form action="/superadmin/supply/derechos" className="flex flex-wrap gap-2">
        <Input
          name="q"
          defaultValue={busqueda}
          placeholder="Buscar por cliente o lote…"
          className="max-w-sm"
          aria-label="Buscar derechos"
        />
        <select
          name="estado"
          defaultValue={estado ?? ''}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          {Object.entries(SUPPLY_DERECHO_ESTADO_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </Form>

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Derechos emitidos"
            columnas={[
              { clave: 'cliente', titulo: 'Cliente' },
              { clave: 'producto', titulo: 'Producto' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'lote', titulo: 'Lote' },
              { clave: 'campana', titulo: 'Campaña' },
              { clave: 'origen', titulo: 'Origen' },
              { clave: 'emitido', titulo: 'Emitido' },
              { clave: 'vence', titulo: 'Vence' },
              { clave: 'costo', titulo: 'Costo', alinearDerecha: true },
              { clave: 'pagado', titulo: 'Pagó', alinearDerecha: true },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={derechos.map((d) => ({
              __clave: d.id,
              cliente: d.cliente.nombre,
              producto: d.lote.snapshotItemNombre,
              proveedor: d.proveedor.name,
              lote: (
                <Link
                  href={`/superadmin/supply/lotes/${d.lote.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {d.lote.codigo}
                </Link>
              ),
              campana: d.asignacion?.etiqueta ?? 'Sin campaña',
              origen: SUPPLY_ORIGEN_LABELS[d.origen],
              emitido: formatDate(d.emitidoAt),
              vence: formatDate(d.vencAt),
              costo: formatMoneyRD(Number(d.costoUnitario)),
              pagado:
                Number(d.precioCliente) > 0 ? formatMoneyRD(Number(d.precioCliente)) : 'Regalo',
              estado: (
                <Badge
                  variant={
                    d.estado === 'ACTIVO'
                      ? 'success'
                      : d.estado === 'REDIMIDO'
                        ? 'info'
                        : 'outline'
                  }
                >
                  {SUPPLY_DERECHO_ESTADO_LABELS[d.estado]}
                </Badge>
              ),
            }))}
            vacio="Todavía no se ha emitido ningún derecho."
          />
        </CardContent>
      </Card>
    </div>
  )
}
