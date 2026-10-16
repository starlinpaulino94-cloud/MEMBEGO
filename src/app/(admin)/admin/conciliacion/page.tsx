import Link from 'next/link'
import { ArrowRight, CheckCircle2, TriangleAlert } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole, usuarioPuedeFuncion } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney } from '@/lib/format'
import { conciliar } from '@/modules/observabilidad/conciliacion'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { CasosDeHallazgo } from '@/components/conciliacion/CasosDeHallazgo'

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
 * La pantalla no corrige nada POR SU CUENTA a propósito: cada hallazgo es una
 * lista de casos y cada caso trae la acción que lo resuelve —generar el
 * comprobante, reintentar la entrega, cerrar el registro con una nota, ir a la
 * caja—, que una persona pulsa y que queda en la bitácora. Arreglar en
 * automático un descuadre de dinero es la forma más rápida de convertir un
 * error visible en uno invisible.
 */
const VENTANAS = [7, 30, 90, 365] as const
const ETIQUETA_VENTANA: Record<number, string> = { 7: '7 días', 30: '30 días', 90: '90 días', 365: '1 año' }

export default async function ConciliacionPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  if (!companyId) return <SinEmpresaActiva seccion="la conciliación" />

  const { dias: diasPedidos } = await searchParams
  const dias = VENTANAS.find((v) => String(v) === diasPedidos) ?? VENTANAS[0]

  const [r, prefs, puedeResolver, empresa] = await Promise.all([
    conciliar(companyId, dias),
    getRegionalPrefs(companyId),
    // Misma función que confirmar un pago: quien puede aprobar un pago puede resolver un cobro. El servidor la vuelve a exigir.
    usuarioPuedeFuncion(user, 'pagos', 'confirmar_pago'),
    conEmpresa(companyId, (tx) => tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })),
  ])
  const zonaHoraria = empresa?.zonaHoraria || 'America/Santo_Domingo'
  const dinero = (n: number) => formatMoney(n, prefs)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analítica"
        title="Conciliación"
        description={`Comprobaciones cruzadas entre membresías, transacciones y caja de los últimos ${r.ventanaDias} días. Cada caso trae la acción que lo resuelve.`}
      />

      <nav aria-label="Periodo" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Mirar:</span>
        {VENTANAS.map((v) => (
          <Link
            key={v}
            href={v === VENTANAS[0] ? '/admin/conciliacion' : `/admin/conciliacion?dias=${v}`}
            aria-current={v === dias ? 'true' : undefined}
            className={`rounded-lg border px-3 py-1 ${v === dias ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
          >
            {ETIQUETA_VENTANA[v]}
          </Link>
        ))}
        <span className="text-caption text-muted-foreground">Las entregas pendientes se revisan siempre completas.</span>
      </nav>

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
              id={h.clave}
              data-testid={`hallazgo-${h.clave}`}
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
              {h.casos.length > 0 && (
                <CasosDeHallazgo casos={h.casos} total={h.cantidad} puedeResolver={puedeResolver} zonaHoraria={zonaHoraria} lote={h.lote} dias={dias} />
              )}
            </li>
          ))}
        </ul>
      )}

      {!puedeResolver && !r.cuadra && (
        <p className="text-caption">
          Tu usuario puede ver los casos pero no resolver cobros: pide a quien apruebe pagos que use los botones.
        </p>
      )}

      <p className="text-caption">
        Estas comprobaciones no corrigen nada por su cuenta: cada caso necesita que alguien
        decida qué pasó y pulse la acción. Ninguna recobra dinero, todas quedan en la
        bitácora con quién las hizo, y corregir un descuadre en automático sería la forma
        más rápida de convertir un error visible en uno invisible.
      </p>
    </div>
  )
}

