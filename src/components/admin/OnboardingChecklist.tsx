import Link from 'next/link'
import { CheckCircle2, Circle, Rocket, ArrowRight } from 'lucide-react'
import type { OnboardingEmpresa } from '@/modules/empresas/onboarding'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PublicarEmpresaButton } from './PublicarEmpresaButton'

/**
 * F5.1: checklist de onboarding en el dashboard. Guía a la empresa hacia
 * los módulos existentes hasta que su perfil esté listo para publicarse.
 */
export function OnboardingChecklist({ onboarding }: { onboarding: OnboardingEmpresa }) {
  // Publicada y completa: no molestar.
  if (onboarding.publicado && onboarding.listoParaPublicar) return null

  const pct = Math.round((onboarding.completados / onboarding.total) * 100)

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <Rocket className="h-5 w-5 text-primary" />
            {onboarding.publicado
              ? 'Completa tu perfil'
              : 'Prepara tu empresa para el marketplace'}
          </CardTitle>
          <span className="text-sm font-semibold text-primary">
            {onboarding.completados}/{onboarding.total} completado
          </span>
        </div>
        {/* Barra de progreso */}
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary/15">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {onboarding.items.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between gap-3 rounded-lg bg-card p-2.5 text-sm shadow-sm"
          >
            <span className="flex items-center gap-2">
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
              )}
              <span className={item.done ? 'text-muted-foreground line-through' : 'text-foreground'}>
                {item.label}
              </span>
              {!item.done && !item.requeridoParaPublicar && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-label-sm font-medium uppercase tracking-wide text-muted-foreground">comercio</span>
              )}
            </span>
            {!item.done && (
              <Link href={item.href}>
                <Button size="sm" variant="outline" className="gap-1 text-xs">
                  {item.cta} <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            )}
          </div>
        ))}

        {!onboarding.publicado && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-primary">
              Tu empresa aún <strong>no es visible</strong> en el marketplace.
              {onboarding.listoParaPublicar
                ? ' ¡Todo listo para publicar! Los pasos de comercio puedes hacerlos después.'
                : ' Completa el perfil para poder publicarla; los pasos de comercio no bloquean.'}
            </p>
            <PublicarEmpresaButton habilitado={onboarding.listoParaPublicar} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
