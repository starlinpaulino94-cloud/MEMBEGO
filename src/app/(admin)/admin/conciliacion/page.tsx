import Link from 'next/link'
import { ArrowRight, CheckCircle2, TriangleAlert } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney } from '@/lib/format'
import { conciliar } from '@/modules/observabilidad/conciliacion'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Conciliación',
  description: 'Que el descuadre lo encuentre el sistema, no el cliente',
}

/**
 * CONCILIACIÓN (auditoría · bloque 3 §18).
 *
 * Membresías, Transacciones y Caja son tres registros de la misma realidad, y
 * nada comprobaba que contaran lo mismo. Un cobro que entra en uno y no en otro
 * no da ningún error: da un informe que no cuadra tres meses después, cuando ya
 * nadie recuerda el día.
 *
 * La pantalla no corrige nada a propósito. Cada hallazgo es un caso que alguien
 * tiene que mirar: arreglar en automático un descuadre de dinero es la forma más
 * rápida de convertir un error visible en uno invisible.
 */
export default async function ConciliacionPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  if (!companyId) return <SinEmpresaActiva seccion="la conciliación" />

  const [r, prefs] = await Promise.all([conciliar(companyId), getRegionalPrefs(companyId)])
  const dinero = (n: number) => formatMoney(n, prefs)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analítica"
        title="Conciliación"
        description={`Comprobaciones cruzadas entre membresías, transacciones y caja de los últimos ${r.ventanaDias} días.`}
      />

      {r.cuadra ? (
        <div className="flex items-start gap-3 rounded-2xl border border-success/25 bg-success/8 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="font-semibold text-foreground">Todo cuadra</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Ningún cobro sin registrar, ninguna caja abierta de días anteriores y ningún
              turno con faltante en los últimos {r.ventanaDias} días.
            </p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {r.hallazgos.map((h) => (
            <li
              key={h.clave}
              className={`rounded-2xl border p-4 ${
                h.severidad === 'ALTA'
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-warning/30 bg-warning/5'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <TriangleAlert
                    className={`mt-0.5 h-5 w-5 shrink-0 ${
                      h.severidad === 'ALTA' ? 'text-destructive' : 'text-warning'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {h.titulo}
                      <span className="ml-2 tabular-nums text-muted-foreground">
                        ({h.cantidad})
                      </span>
                    </p>
                    {/* La explicación no es opcional: un hallazgo que no dice
                        qué significa se ignora la segunda vez que aparece. */}
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                      {h.explicacion}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {h.monto != null && (
                    <span className="font-semibold tabular-nums text-foreground">
                      {dinero(h.monto)}
                    </span>
                  )}
                  {h.href && (
                    <Link
                      href={h.href}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Revisar <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-caption">
        Estas comprobaciones no corrigen nada por su cuenta: cada caso necesita que alguien
        decida qué pasó. Corregir un descuadre de dinero en automático es la forma más
        rápida de convertir un error visible en uno invisible.
      </p>
    </div>
  )
}
