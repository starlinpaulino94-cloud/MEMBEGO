import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Dato, Edad, ErrorCorto, FiltroChips, Momento, Paginador, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { eventosDelInbox } from '@/modules/supply-v2/operations/panel-queries'
import { RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Eventos externos · Operaciones' }

/**
 * SLICE 9 · BLOQUE 4 · §4D · EL INBOX.
 *
 * Lo que la pasarela mandó y qué hicimos con él. El cuerpo guardado ya viene
 * saneado del bloque 1 —sin firmas ni tokens— y aquí NO se muestra completo:
 * lo que sirve para operar es el estado, los intentos y el error, no el JSON.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; pagina?: string }>
}) {
  await requireRole('SUPERADMIN')
  const q = await searchParams
  const base = `${RUTA_OPERACIONES}/inbox`
  const r = await eventosDelInbox({ status: q.status }, Number(q.pagina) || 1)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Eventos externos recibidos"
        description="El inbox: una fila por evento, con su identidad del proveedor, su estado y sus intentos. El cuerpo se guarda saneado y no se muestra aquí."
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
              { valor: 'RECEIVED', etiqueta: 'Recibidos' },
              { valor: 'PROCESSED', etiqueta: 'Procesados' },
              { valor: 'FAILED', etiqueta: 'Fallidos' },
              { valor: 'DEAD_LETTER', etiqueta: 'Sin salida' },
              { valor: 'IGNORED', etiqueta: 'Ignorados' },
            ]}
          />
          {r.filas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-eventos">Ningún evento con ese filtro.</p>
          ) : (
            <Tabla cabeceras={['Estado', 'Pasarela', 'Tipo', 'Id del proveedor', 'Compra', 'Int.', 'Último error', 'Recibido', 'Edad', '']}>
              {r.filas.map((e) => (
                <tr key={e.id} data-testid={`evento-${e.id}`}>
                  <td className="px-2 py-1.5 text-xs font-semibold" data-testid={`evento-estado-${e.id}`}>{e.status}</td>
                  <td className="px-2 py-1.5 text-xs">{e.provider}</td>
                  <td className="px-2 py-1.5 text-xs">{e.eventType}</td>
                  <td className="px-2 py-1.5 text-xs">{e.externalEventId}</td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={e.orderNumber} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums">{e.attempts}</td>
                  <td className="px-2 py-1.5"><ErrorCorto texto={e.lastError} /></td>
                  <td className="px-2 py-1.5"><Momento valor={e.receivedAt} /></td>
                  <td className="px-2 py-1.5"><Edad minutos={e.edadMin} /></td>
                  <td className="px-2 py-1.5">
                    <Link href={`${RUTA_OPERACIONES}/buscar?q=${encodeURIComponent(e.correlationId)}`} className="text-xs underline" data-testid={`historia-${e.id}`}>
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
