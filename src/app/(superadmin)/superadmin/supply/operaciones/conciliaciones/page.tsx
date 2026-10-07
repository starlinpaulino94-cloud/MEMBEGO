import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Dato, FiltroChips, Momento, Paginador, Severidad, Tabla } from '@/components/supply-v2/operaciones/piezas'
import { conciliacionesDelPanel } from '@/modules/supply-v2/operations/panel-queries'
import { RUTA_OPERACIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliaciones · Operaciones' }

/** SLICE 9 · BLOQUE 4 · §21 · lo que dijo cada lado, y cuánto se diferencian. */
export default async function ConciliacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; pagina?: string }>
}) {
  await requireRole('SUPERADMIN')
  const q = await searchParams
  const base = `${RUTA_OPERACIONES}/conciliaciones`
  const r = await conciliacionesDelPanel({ outcome: q.outcome }, Number(q.pagina) || 1)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conciliaciones de pago"
        description="Cada comprobación de un cobro externo contra lo que Membego tiene escrito. Se refrescan, no se duplican: «veces» dice cuántas se ha mirado."
        eyebrow="Operaciones"
        action={<Link href={RUTA_OPERACIONES} className="text-sm underline">← Centro de Operaciones</Link>}
      />
      <Card>
        <CardContent className="space-y-3 py-3">
          <FiltroChips
            base={base}
            parametro="outcome"
            activo={q.outcome}
            opciones={[
              { valor: 'MISMATCH', etiqueta: 'No cuadran' },
              { valor: 'MATCHED', etiqueta: 'Cuadran' },
              { valor: 'WAITING', etiqueta: 'Esperando' },
              { valor: 'IGNORED', etiqueta: 'Ignoradas' },
            ]}
          />
          {r.filas.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sin-conciliaciones">Ninguna comprobación con ese filtro.</p>
          ) : (
            <Tabla cabeceras={['Veredicto', 'Sev.', 'Motivo', 'Compra', 'Transacción', 'Interno', 'Externo', 'Esperado', 'Reportado', 'Dif.', 'Veces', 'Última', '']}>
              {r.filas.map((c) => (
                <tr key={c.id} data-testid={`conciliacion-${c.id}`}>
                  <td className="px-2 py-1.5 text-xs font-semibold" data-testid={`conciliacion-outcome-${c.id}`}>{c.outcome}</td>
                  <td className="px-2 py-1.5"><Severidad valor={c.severity} /></td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={c.reasonCode} /></td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={c.orderNumber} /></td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={c.externalTransactionId} /></td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={c.internalStatus} /></td>
                  <td className="px-2 py-1.5 text-xs"><Dato valor={c.externalStatus} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums">{c.expectedCurrency ?? ''} <Dato valor={c.expectedAmount} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums">{c.reportedCurrency ?? ''} <Dato valor={c.reportedAmount} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums"><Dato valor={c.differenceAmount} /></td>
                  <td className="px-2 py-1.5 text-xs tabular-nums">{c.checks}</td>
                  <td className="px-2 py-1.5"><Momento valor={c.checkedAt} /></td>
                  <td className="px-2 py-1.5">
                    {c.incidentId ? (
                      <Link href={`${RUTA_OPERACIONES}/incidentes/${c.incidentId}`} className="text-xs underline">Incidente</Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
          <Paginador base={base} pagina={r.pagina} porPagina={r.porPagina} total={r.total} extra={q.outcome ? `outcome=${q.outcome}` : undefined} />
        </CardContent>
      </Card>
    </div>
  )
}
