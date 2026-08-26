import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { manifiestoDelDia } from '@/modules/excursiones/checkin/queries'
import { diaLocal } from '@/modules/excursiones/checkin/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { CheckinScanner } from '@/components/excursiones/CheckinScanner'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Check-in' }

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string }>
}) {
  const user = await requireRole([...ADMIN_ROLES, 'RECEPCION', 'EMPLEADO'])
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el check-in de excursiones" />

  const { dia } = await searchParams
  const hoy = diaLocal(new Date())
  const elegido = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : hoy
  const { filas, resumen } = await manifiestoDelDia(companyId, elegido)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h2 className="text-h2 text-foreground">Check-in</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Escanea el QR de la reserva para registrar quién se sube. Leer no embarca a nadie:
          primero ves de quién es, y confirmas tú.
        </p>
      </div>

      <CheckinScanner />

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h3 text-foreground">
            Salidas {elegido === hoy ? 'de hoy' : `del ${elegido}`}
          </h2>
          <form method="GET" className="flex items-center gap-2">
            <label htmlFor="mf-dia" className="text-caption text-muted-foreground">
              Ver otro día
            </label>
            <input
              id="mf-dia"
              name="dia"
              type="date"
              defaultValue={elegido}
              className="rounded-lg border border-border bg-muted px-2 py-1 text-sm text-foreground"
            />
            <button
              type="submit"
              className="rounded-lg border border-border px-2 py-1 text-sm text-foreground hover:bg-muted"
            >
              Ver
            </button>
          </form>
        </div>

        {filas.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No hay salidas registradas para ese día.
          </p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <dd className="text-h3 text-foreground">{resumen.reservas}</dd>
                <dt className="text-caption text-muted-foreground">Reservas</dt>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <dd className="text-h3 text-foreground">{resumen.embarcadas}</dd>
                <dt className="text-caption text-muted-foreground">Con check-in</dt>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <dd className="text-h3 text-foreground">{resumen.pasajeros}</dd>
                <dt className="text-caption text-muted-foreground">Pasajeros</dt>
              </div>
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <dd className="text-h3 text-foreground">{resumen.presentes}</dd>
                <dt className="text-caption text-muted-foreground">Se subieron</dt>
              </div>
            </dl>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Hora</th>
                    <th className="py-2 pr-3">Cliente</th>
                    <th className="py-2 pr-3">Excursión</th>
                    <th className="py-2 pr-3">Pax</th>
                    <th className="py-2">Embarque</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 text-muted-foreground">{f.hora ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/admin/excursiones/reservas/${f.id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {f.cliente}
                        </Link>
                        {f.telefono ? (
                          <span className="block text-caption text-muted-foreground">{f.telefono}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{f.excursion}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {f.presentes}/{f.totalPasajeros}
                      </td>
                      <td className="py-2">
                        {f.esCombo && f.totalItems > 0 ? (
                          f.itemsCompletados === 0 ? (
                            <StatusChip tone="neutral">Sin embarcar (0/{f.totalItems})</StatusChip>
                          ) : f.itemsCompletados < f.totalItems ? (
                            <div>
                              <StatusChip tone="warning">
                                Parcial ({f.itemsCompletados}/{f.totalItems} acts)
                              </StatusChip>
                              {f.checkinAt && (
                                <span className="block text-caption text-muted-foreground">
                                  {formatDateTime(f.checkinAt)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div>
                              <StatusChip tone="success">
                                Completo ({f.itemsCompletados}/{f.totalItems} acts)
                              </StatusChip>
                              {f.checkinAt && (
                                <span className="block text-caption text-muted-foreground">
                                  {formatDateTime(f.checkinAt)}
                                </span>
                              )}
                            </div>
                          )
                        ) : f.checkinAt ? (
                          <div>
                            <StatusChip tone={f.presentes === f.totalPasajeros ? 'success' : 'warning'}>
                              {f.presentes === f.totalPasajeros ? 'Completo' : 'Parcial'}
                            </StatusChip>
                            <span className="block text-caption text-muted-foreground">
                              {formatDateTime(f.checkinAt)}
                            </span>
                          </div>
                        ) : (
                          <StatusChip tone="neutral">Sin embarcar</StatusChip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
