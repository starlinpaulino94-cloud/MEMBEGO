import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { LIMITE_MANIFIESTO, manifiestoDelDia } from '@/modules/excursiones/checkin/queries'
import { diaLocal } from '@/modules/excursiones/checkin/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { CheckinScanner } from '@/components/excursiones/CheckinScanner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ManifiestoTabla } from '@/components/excursiones/ManifiestoTabla'

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
  const { filas, resumen, totalDelDia, truncado } = await manifiestoDelDia(companyId, elegido)

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

            {truncado ? (
              <Alert className="mt-4" role="status">
                <AlertDescription>
                  Este día tiene {totalDelDia.toLocaleString('es-DO')} salidas y aquí se muestran las primeras {LIMITE_MANIFIESTO}, por hora.
                  Los totales de arriba cuentan solo esas.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="mt-4">
              <ManifiestoTabla filas={filas} dia={elegido} />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
