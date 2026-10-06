import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { resumenIncidencias } from '@/modules/supply/incidencias'
import { FormResolverIncidencia } from '@/components/supply/form-resolver-incidencia'
import { FormAccion } from '@/components/supply/form-accion'
import { abrirIncidenciaAdminAction } from '@/modules/supply/actions-lotes'
import { proveedoresElegibles } from '@/modules/supply/proveedores'
import { CardHeader, CardTitle } from '@/components/ui/card'
import {
  INCIDENCIA_VIVA,
  SUPPLY_INCIDENCIA_ESTADO_LABELS,
  SUPPLY_INCIDENCIA_TIPO_LABELS,
} from '@/modules/supply/catalogo'
import { TRANSICIONES_INCIDENCIA } from '@/modules/supply/estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Incidencias de cumplimiento' }

/**
 * MEMBEGO SUPPLY · incidencias y disputas (Fases 29, 30).
 *
 * «Me negaron el beneficio», «me cobraron la pizza igual», «la sucursal no
 * aceptó el voucher». Sin este registro, la única fuente sobre cómo cumple un
 * proveedor es que alguien se acuerde de contarlo, y la decisión de volver a
 * comprarle 5.000 unidades se toma a ciegas.
 *
 * Resolver NO borra la redención. Cambia el estado de la disputa y, si hace
 * falta, se compensa con un derecho nuevo o un ajuste financiero: la entrega
 * original se queda donde está.
 */
export default async function IncidenciasPage() {
  await requireRole('SUPERADMIN')

  const [proveedores, lotes] = await Promise.all([
    proveedoresElegibles(),
    sinEmpresa('Membego Supply: lotes para abrir incidencia', (tx) =>
      tx.supplyLote.findMany({ where: { estado: { in: ['ACTIVO', 'AGOTADO'] } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, codigo: true, snapshotItemNombre: true, proveedor: { select: { name: true } } } })
    ),
  ])
  const [resumen, incidencias] = await Promise.all([
    resumenIncidencias(),
    sinEmpresa('Membego Supply: incidencias de cumplimiento', (tx) =>
      tx.supplyIncidencia.findMany({
        orderBy: [{ estado: 'asc' }, { createdAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          tipo: true,
          estado: true,
          detalle: true,
          resolucion: true,
          createdAt: true,
          loteId: true,
          proveedor: { select: { name: true } },
          cliente: { select: { nombre: true } },
          reportadoPor: { select: { name: true } },
          resueltoPor: { select: { name: true } },
        },
      })
    ),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidencias de cumplimiento"
        description="Lo que sale mal en el mostrador, ligado al lote y al proveedor. Es lo que convierte «dicen que no atienden bien» en un dato."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="incidencias" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Abiertas"
          value={resumen.abiertas}
          accent={resumen.abiertas > 0 ? 'warning' : 'success'}
        />
        <StatCard label="En revisión" value={resumen.enRevision} />
        <StatCard label="Resueltas" value={resumen.resueltas} />
        <StatCard label="Total" value={resumen.total} />
      </div>

      <Card id="crear">
        <CardHeader>
          <CardTitle>Crear incidencia</CardTitle>
        </CardHeader>
        <CardContent>
          <FormAccion
            accion={abrirIncidenciaAdminAction}
            etiqueta="Abrir incidencia"
            nota="Apunta a un beneficio, una redención, una venta, un lote o un proveedor. Lo que se sepa: cuanto más, mejor conciliación."
            campos={[
              { name: 'tipo', label: 'Tipo', tipo: 'select', opciones: Object.entries(SUPPLY_INCIDENCIA_TIPO_LABELS).map(([value, label]) => ({ value, label })) },
              { name: 'proveedorId', label: 'Proveedor', tipo: 'select', opciones: [{ value: '', label: '—' }, ...proveedores.map((p) => ({ value: p.id, label: p.nombre }))] },
              { name: 'loteId', label: 'Lote', tipo: 'select', opciones: [{ value: '', label: '—' }, ...lotes.map((l) => ({ value: l.id, label: `${l.codigo} · ${l.snapshotItemNombre} · ${l.proveedor.name}` }))] },
              { name: 'clienteBusqueda', label: 'Cliente (correo o nombre exacto)', maxLength: 160 },
              { name: 'derechoId', label: 'Id de derecho', maxLength: 60 },
              { name: 'redencionId', label: 'Id de redención', maxLength: 60 },
              { name: 'ventaId', label: 'Id de venta', maxLength: 60 },
              { name: 'detalle', label: 'Qué pasó', tipo: 'textarea', required: true, maxLength: 2000 },
            ]}
          />
        </CardContent>
      </Card>

      {incidencias.length === 0 ? (
        <EmptyState
          variant="card"
          title="Sin incidencias"
          description="Nadie ha reportado problemas con los beneficios entregados. Los clientes pueden abrir una desde su pantalla de beneficios, y plataforma desde el formulario de arriba."
        />
      ) : (
        <div className="space-y-3">
          {incidencias.map((i) => {
            const siguientes = TRANSICIONES_INCIDENCIA[i.estado]
            const abierta = INCIDENCIA_VIVA.includes(i.estado)
            return (
              <Card key={i.id} className={abierta ? 'border-warning/40' : undefined}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{SUPPLY_INCIDENCIA_TIPO_LABELS[i.tipo]}</p>
                      <p className="text-caption text-muted-foreground">
                        {i.proveedor.name}
                        {i.cliente ? ` · ${i.cliente.nombre}` : ''} · {formatDateTime(i.createdAt)}
                        {i.reportadoPor ? ` · reportó ${i.reportadoPor.name}` : ''}
                      </p>
                    </div>
                    <Badge
                      variant={
                        i.estado === 'ABIERTA'
                          ? 'destructive'
                          : abierta
                            ? 'warning'
                            : i.estado === 'RECHAZADA'
                              ? 'outline'
                              : 'success'
                      }
                    >
                      {SUPPLY_INCIDENCIA_ESTADO_LABELS[i.estado]}
                    </Badge>
                  </div>

                  <p className="text-sm">{i.detalle}</p>

                  {i.resolucion && (
                    <p className="rounded-lg bg-muted/40 p-3 text-sm">
                      <strong>Resolución:</strong> {i.resolucion}
                      {i.resueltoPor ? ` — ${i.resueltoPor.name}` : ''}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {i.loteId && (
                      <Link
                        href={`/superadmin/supply/lotes/${i.loteId}`}
                        className="text-caption underline underline-offset-4"
                      >
                        Ver el lote
                      </Link>
                    )}
                    {siguientes.length > 0 && (
                      <FormResolverIncidencia
                        incidenciaId={i.id}
                        estadosPosibles={[...siguientes]}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
