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
        <div className="mb-6 rounded-lg border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">
          <p className="font-semibold">Este despliegue no está configurado.</p>
          <p className="mt-1 text-amber-200/80">
            Faltan variables de entorno: {faltantes.join(', ')}. En Vercel, márcalas
            también para el entorno <b>Preview</b> y vuelve a desplegar.
          </p>
        </div>
      )}
      <Suspense fallback={<div className="text-white/60">Cargando...</div>}>
        <LoginForm />
      </Suspense>

      {/* Additional Context */}
      <div className="mt-8 space-y-6">
        <div className="text-center">
          <p className="text-white/60 text-sm mb-4">¿Aún no tienes cuenta?</p>
          <a
            href={landingUrlFor('/empresas')}
            className="inline-block rounded-lg border border-white/20 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Explorar Empresas
          </a>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-center">
          <p className="text-white/70 text-xs">
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
