import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Dato, Edad, ErrorCorto, FiltroChips, Momento, Paginador, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { efectosDelOutbox } from '@/modules/supply-v2/operations/panel-queries'
import { RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Outbox · Operaciones' }

/**
 * SLICE 9 · BLOQUE 4 · §19 · EL OUTBOX.
 *
 * Solo lectura, y es deliberado: no hay un «editar» sobre una fila del outbox.
 * Lo que mueve una fila es el worker, el rescate del arriendo o un reintento
 * manual del difunto —cada uno con su candado y su escalera—. Un `UPDATE` a
 * mano desde un panel se saltaría los tres.
 */
export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; pagina?: string }>
}) {
  await requireRole('SUPERADMIN')
  const q = await searchParams
  const base = `${RUTA_OPERACIONES}/outbox`
  const r = await efectosDelOutbox({ status: q.status }, Number(q.pagina) || 1)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Outbox de efectos"
        description="Los efectos apuntados dentro de la transacción del dinero y entregados fuera. Solo lectura: lo que los mueve es el worker, el rescate o un reintento."
        eyebrow="Operaciones"
        action={<Link href={RUTA_OPERACIONES} className="text-sm underline">← Centro de Operaciones</Link>}
      />
      <Card>
        <CardContent className="space-y-3 py-3">
          <FiltroChips
            base={base}
            parametro="status"
            activo={q.status}
            opciones={[
              { valor: 'PENDING', etiqueta: 'Pendientes' },
              { valor: 'PROCESSING', etiqueta: 'Reclamados' },
              { valor: 'FAILED', etiqueta: 'Fallidos' },
              { valor: 'DELIVERED', etiqueta: 'Entregados' },
              { valor: 'DEAD_LETTER', etiqueta: 'Sin salida' },
            ]}
          />
          {r.filas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-efectos">Ningún efecto con ese filtro.</p>
          ) : (
            <Tabla cabeceras={['Estado', 'Efecto', 'Compra', 'Int.', 'Disponible', 'Reclamado', 'Entregado', 'Último error', 'Edad', '']}>
              {r.filas.map((e) => (
                <tr key={e.id} data-testid={`efecto-${e.id}`}>
                  <td className="px-2 py-1.5 text-xs font-semibold" data-testid={`efecto-estado-${e.id}`}>{e.status}</td>
                  <td className="px-2 py-1.5 text-xs">{e.eventType}</td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={e.orderNumber} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums">{e.attempts}</td>
                  <td className="px-2 py-1.5"><Momento valor={e.availableAt} /></td>
                  <td className="px-2 py-1.5"><Momento valor={e.claimedAt} /></td>
                  <td className="px-2 py-1.5"><Momento valor={e.processedAt} /></td>
                  <td className="px-2 py-1.5"><ErrorCorto texto={e.lastError} /></td>
                  <td className="px-2 py-1.5"><Edad minutos={e.edadMin} /></td>
                  <td className="px-2 py-1.5">
                    <Link href={`${RUTA_OPERACIONES}/buscar?q=${encodeURIComponent(e.correlationId)}`} className="text-xs underline">
                      Historia
                    </Link>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
          <Paginador base={base} pagina={r.pagina} porPagina={r.porPagina} total={r.total} extra={q.status ? `status=${q.status}` : undefined} />
        </CardContent>
      </Card>
    </div>
  )
}
