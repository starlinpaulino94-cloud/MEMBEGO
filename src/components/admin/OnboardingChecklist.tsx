import Link from 'next/link'
import { CheckCircle2, ChevronDown, Circle, Rocket, ArrowRight } from 'lucide-react'
import type { OnboardingEmpresa } from '@/modules/empresas/onboarding'
import { Button } from '@/components/ui/button'
import { PublicarEmpresaButton } from './PublicarEmpresaButton'

/**
 * F5.1: checklist de onboarding en el dashboard. Guía a la empresa hacia
 * los módulos existentes hasta que su perfil esté listo para publicarse.
 *
 * LO SIGUIENTE, NO LA LISTA ENTERA (piloto de rediseño, oct 2026). Enseñaba los catorce pasos a la vez, hechos y por
 * hacer, cada uno con su botón: ocupaba casi una pantalla entera por encima de lo que pasó hoy en el negocio, y no
 * decía por dónde empezar. Ahora dice cuánto falta y enseña los TRES siguientes —primero los que bloquean la
 * publicación—; los catorce siguen a un clic, plegados.
 */
const SIGUIENTES = 3

export function OnboardingChecklist({ onboarding }: { onboarding: OnboardingEmpresa }) {
  // Publicada y completa: no molestar.
  if (onboarding.publicado && onboarding.listoParaPublicar) return null

  const pct = Math.round((onboarding.completados / onboarding.total) * 100)
  const pendientes = onboarding.items.filter((i) => !i.done)
  // `sort` es estable: dentro de cada grupo se respeta el orden del asistente.
  const siguientes = [...pendientes]
    .sort((a, b) => Number(b.requeridoParaPublicar) - Number(a.requeridoParaPublicar))
    .slice(0, SIGUIENTES)

  return (
    <section aria-labelledby="onboarding-titulo" className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
        <div className="min-w-0">
          <h2 id="onboarding-titulo" className="flex items-center gap-2 text-h4 text-foreground">
            <Rocket aria-hidden className="h-4 w-4 text-primary" />
            {onboarding.publicado ? 'Completa tu perfil' : 'Termina de configurar tu negocio'}
          </h2>
          <p className="mt-0.5 text-small text-muted-foreground">
            {onboarding.completados} de {onboarding.total} listos
            {pendientes.length > 0 ? ' · esto es lo siguiente' : ''}
          </p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-56">
          <div
            role="progressbar"
            aria-label="Pasos completados"
            aria-valuemin={0}
            aria-valuemax={onboarding.total}
            aria-valuenow={onboarding.completados}
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-small font-semibold tabular-nums text-foreground">{pct} %</span>
        </div>
      </div>

      {siguientes.length > 0 && (
        <ul className="border-t border-border">
          {siguientes.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-5 py-3 text-sm last:border-0"
            >
              {/* `flex-wrap` + base de 12rem: en un móvil el botón baja de línea en vez de salirse de la tarjeta. */}
              <span className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
                <Circle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                <span className="text-foreground">{item.label}</span>
              </span>
              <Link href={item.href}>
                <Button size="sm" variant="outline" className="gap-1 text-xs">
                  {item.cta} <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-5 py-3">
        <details className="group w-full">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-small font-medium text-primary hover:underline">
            Ver los {onboarding.total} pasos
            <ChevronDown aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {onboarding.items.map((item) => (
              <li key={item.key} className="flex min-w-0 items-center gap-2 text-small">
                {item.done ? (
                  <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <Circle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
                {item.done ? (
                  <span className="text-muted-foreground">
                    <span className="sr-only">Hecho: </span>
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href} className="text-foreground hover:text-primary hover:underline">
                    {item.label}
                  </Link>
                )}
                {!item.done && !item.requeridoParaPublicar && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-label-sm font-medium uppercase tracking-wide text-muted-foreground">
                    comercio
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>

        {!onboarding.publicado && (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="text-caption text-muted-foreground">
              Tu empresa aún <strong className="text-foreground">no es visible</strong> en el marketplace.
              {onboarding.listoParaPublicar
                ? ' ¡Todo listo para publicar! Los pasos de comercio puedes hacerlos después.'
                : ' Completa el perfil para poder publicarla; los pasos de comercio no bloquean.'}
            </p>
            <PublicarEmpresaButton habilitado={onboarding.listoParaPublicar} />
          </div>
        )}
      </div>
    </section>
  )
}
