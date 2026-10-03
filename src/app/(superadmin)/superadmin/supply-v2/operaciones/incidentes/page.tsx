import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Dato, Edad, FiltroChips, Paginador, Severidad, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { incidentesDelPanel } from '@/modules/supply-v2/operations/panel-queries'
import { etiquetaDeMotivoDePago } from '@/modules/supply-v2/core/catalogo'
import { RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Incidentes · Operaciones' }

/**
 * SLICE 9 · BLOQUE 4 · §4B · INCIDENTES FINANCIEROS DE PAGOS EXTERNOS.
 *
 * Lo abierto primero y lo grave arriba, que es el orden en el que alguien con
 * prisa quiere la lista. Filtros por estado y severidad, paginación en el
 * servidor: la página no se trae la tabla para contarla.
 */
export default async function IncidentesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; pagina?: string }>
}) {
  await requireRole('SUPERADMIN')
  const q = await searchParams
  const pagina = Number(q.pagina) || 1
  const base = `${RUTA_OPERACIONES}/incidentes`
  const r = await incidentesDelPanel({ status: q.status, severity: q.severity }, pagina)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incidentes de pago externo"
        description="Lo que la pasarela dice y Membego no confirma, con su motivo, su severidad y su dueño. Abrir uno para investigarlo y resolverlo."
        eyebrow="Operaciones"
        action={<Link href={RUTA_OPERACIONES} className="text-sm underline">← Centro de Operaciones</Link>}
      />

      <Card>
        <CardContent className="space-y-3 py-3">
          <div className="flex flex-wrap gap-4">
            <FiltroChips
              base={base}
              parametro="status"
              activo={q.status}
              opciones={[
                { valor: 'OPEN', etiqueta: 'Abiertos' },
                { valor: 'INVESTIGATING', etiqueta: 'En investigación' },
                { valor: 'RESOLVED', etiqueta: 'Resueltos' },
              ]}
            />
            <FiltroChips
              base={base}
              parametro="severity"
              activo={q.severity}
              opciones={[
                { valor: 'HIGH', etiqueta: 'Alta' },
                { valor: 'MEDIUM', etiqueta: 'Media' },
                { valor: 'LOW', etiqueta: 'Baja' },
              ]}
            />
          </div>

          {r.filas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-incidentes">
              Ningún incidente con ese filtro.
            </p>
          ) : (
            <Tabla cabeceras={['Sev.', 'Estado', 'Motivo', 'Compra', 'Pasarela', 'Importe', 'Edad', '']}>
              {r.filas.map((i) => (
                <tr key={i.id} data-testid={`incidente-${i.id}`}>
                  <td className="px-2 py-1.5"><Severidad valor={i.severity} testid={`incidente-sev-${i.id}`} /></td>
                  <td className="px-2 py-1.5 text-xs font-medium" data-testid={`incidente-estado-${i.id}`}>{i.status}</td>
                  <td className="px-2 py-1.5 text-sm">{etiquetaDeMotivoDePago(i.reasonCode)}</td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={i.orderNumber} /></td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={i.externalTransactionId ?? i.provider} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums">{i.currency} {i.amount}</td>
                  <td className="px-2 py-1.5"><Edad minutos={i.edadMin} /></td>
                  <td className="px-2 py-1.5">
                    <Link href={`${base}/${i.id}`} className="text-xs underline" data-testid={`abrir-incidente-${i.id}`}>
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}

          <Paginador
            base={base}
            pagina={r.pagina}
            porPagina={r.porPagina}
            total={r.total}
            extra={[q.status ? `status=${q.status}` : '', q.severity ? `severity=${q.severity}` : ''].filter(Boolean).join('&')}
          />
        </CardContent>
      </Card>
    </div>
  )
}
