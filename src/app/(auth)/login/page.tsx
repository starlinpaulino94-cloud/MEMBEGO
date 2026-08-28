import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/LoginForm'
import { landingUrlFor } from '@/lib/site'
import { missingPublicEnv } from '@/lib/env'

export default function LoginPage() {
  // Diagnóstico de entorno: si faltan las variables públicas de Supabase
  // (típico en previews de Vercel sin envs marcadas para Preview), el login es
  // IMPOSIBLE — mejor decirlo de frente que dejar al usuario intentando.
  const faltantes = missingPublicEnv()

  return (
    <>
      {faltantes.length > 0 && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <p className="font-semibold">Este despliegue no está configurado.</p>
          <p className="mt-1 text-warning/80">
            Faltan variables de entorno: {faltantes.join(', ')}. En Vercel, márcalas
            también para el entorno <b>Preview</b> y vuelve a desplegar.
          </p>
        </div>
      )}
      <Suspense fallback={<div className="text-small text-muted-foreground">Cargando…</div>}>
        <LoginForm />
      </Suspense>

      {/* Additional Context */}
      <div className="mt-8 space-y-6">
        <div className="text-center">
          <p className="mb-4 text-small text-muted-foreground">¿Aún no tienes cuenta?</p>
          <a
            href={landingUrlFor('/empresas')}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 text-small font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Explorar Empresas
          </a>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-4 text-center">
          <p className="text-caption">
            Descubre promociones y beneficios exclusivos antes de registrarte
          </p>
          <a
            href={landingUrlFor('/promociones')}
            className="text-primary hover:text-primary font-semibold text-xs mt-2 inline-block"
          >
            Ver todas las promociones →
          </a>
        </div>
      </div>
    </>
  )
}
