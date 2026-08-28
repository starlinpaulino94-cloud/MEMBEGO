import Link from 'next/link'
import { CheckCircle2, ArrowRight, PartyPopper } from 'lucide-react'
import type { OnboardingCliente } from '@/modules/social/queries'
import { Button } from '@/components/ui/button'

/**
 * Asistente de bienvenida del cliente (Onboarding Fase 3C · B2C). Guía los
 * pasos (perfil → intereses → descubrir empresas → primera membresía) con un
 * "paso actual". NO es obligatorio: el cliente puede usar la app sin
 * completarlo. El progreso se deriva de datos reales (getOnboardingCliente),
 * así que se retoma solo.
 */
export function WizardCliente({
  onboarding,
  nombre,
}: {
  onboarding: OnboardingCliente
  nombre: string
}) {
  const pct = Math.round((onboarding.completados / onboarding.total) * 100)
  const currentIndex = onboarding.items.findIndex((i) => !i.done)
  const completo = onboarding.completados === onboarding.total

  if (completo) {
    return (
      <div className="rounded-2xl border border-success/25 bg-card p-8 text-center shadow-sm">
        <PartyPopper className="mx-auto h-10 w-10 text-success" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          ¡Todo listo, {nombre}!
        </h1>
        <p className="mt-2 text-muted-foreground">
          Completaste tu configuración. Explora empresas y aprovecha tus beneficios.
        </p>
        <Link href="/mis-membresias" className="mt-6 inline-block">
          <Button className="gap-1.5">
            Ir a mis membresías <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Bienvenida</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          Hola, {nombre} 👋
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Personaliza tu experiencia en unos pasos. No es obligatorio: puedes
          hacerlo ahora o cuando quieras.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">
            {onboarding.completados} de {onboarding.total}
          </span>
          <span className="text-sm font-semibold text-primary">{pct}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ol className="space-y-3">
        {onboarding.items.map((item, i) => {
          const isCurrent = i === currentIndex
          return (
            <li
              key={item.key}
              className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition ${
                isCurrent ? 'border-primary/30 bg-primary/10 shadow-sm' : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center gap-3">
                {item.done ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                ) : (
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {i + 1}
                  </span>
                )}
                <div>
                  <p
                    className={`text-sm font-medium ${
                      item.done ? 'text-muted-foreground line-through' : 'text-foreground'
                    }`}
                  >
                    {item.label}
                  </p>
                  {isCurrent && <p className="text-xs text-primary">Siguiente paso</p>}
                </div>
              </div>
              {!item.done && item.cta && (
                <Link href={item.href}>
                  <Button
                    size="sm"
                    variant={isCurrent ? 'default' : 'outline'}
                    className="gap-1 text-xs"
                  >
                    {item.cta} <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              )}
            </li>
          )
        })}
      </ol>

      <div className="text-center">
        <Link
          href="/mis-membresias"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Saltar por ahora
        </Link>
      </div>
    </div>
  )
}
