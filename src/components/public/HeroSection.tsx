import Link from 'next/link'
import { ArrowRight, QrCode, ShieldCheck, Sparkles } from 'lucide-react'
import type { PlatformStats } from '@/modules/marketplace/cached'

function fmt(n: number) {
  return new Intl.NumberFormat('es-DO').format(n)
}

export function HeroSection({ stats }: { stats: PlatformStats }) {
  // Solo métricas reales con valor y centradas en el cliente (marca única:
  // sin conteos de "empresas" ni "ciudades" que delaten un marketplace).
  const metrics = [
    { label: 'Membresías activas', value: stats.membresiasActivas },
    { label: 'Promociones vigentes', value: stats.promocionesVigentes },
  ].filter((m) => m.value > 0)

  return (
    <section className="relative overflow-hidden bg-slate-950">
      {/* Base de marca + glows + textura */}
      <div className="absolute inset-0 surface-hero" />
      <div className="absolute inset-0 bg-grid-light mask-fade" />
      <div className="absolute -top-32 -right-24 h-[28rem] w-[28rem] animate-pulse-glow rounded-full bg-primary/25 blur-3xl" />
      <div className="absolute -bottom-40 -left-24 h-[28rem] w-[28rem] animate-pulse-glow rounded-full bg-primary/25 blur-3xl delay-500" />

      <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-20 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Copy */}
          <div className="text-white">
            <span className="inline-flex animate-slide-up items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white/80 backdrop-blur">
              <Sparkles className="h-4 w-4 text-white/85" />
              Tu membresía y tus beneficios, digitales
            </span>

            <h1 className="mt-6 animate-slide-up text-display delay-75">
              Tus beneficios,
              <br />
              <span className="bg-gradient-to-r from-white via-sky-100 to-sky-300 bg-clip-text text-transparent">
                siempre contigo.
              </span>
            </h1>

            <p className="mt-6 max-w-xl animate-slide-up text-body leading-relaxed text-white/80 delay-100">
              Olvídate de las tarjetas físicas. Activa tu membresía, recibe tu
              código QR único y disfruta beneficios, promociones y planes
              exclusivos — todo desde tu teléfono.
            </p>

            <div className="mt-9 flex animate-slide-up flex-col gap-3 delay-150 sm:flex-row">
              <Link
                href="/registro"
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-card px-6 py-3.5 font-semibold text-primary shadow-glow-strong transition-all hover:bg-primary/10 active:scale-[0.98]"
              >
                Crear mi cuenta gratis
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/promociones"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 font-semibold text-white backdrop-blur transition-all hover:bg-white/20 active:scale-[0.98]"
              >
                Ver promociones
              </Link>
            </div>

            {/* Métricas reales */}
            {metrics.length > 0 && (
              <div className="mt-12 flex animate-slide-up flex-wrap gap-x-10 gap-y-5 delay-200">
                {metrics.map((m) => (
                  <div key={m.label}>
                    <div className="text-h1">
                      {fmt(m.value)}
                    </div>
                    <div className="mt-0.5 text-sm text-primary/80">{m.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Visual: tarjeta de membresía digital flotante */}
          <div className="relative mx-auto w-full max-w-sm animate-scale-in delay-100">
            {/* Halo detrás de la tarjeta */}
            <div className="absolute inset-0 -z-10 scale-110 rounded-[2rem] bg-primary/20 blur-2xl" />

            <div className="animate-float">
              {/* Sombra/carta trasera para profundidad */}
              <div className="absolute inset-0 translate-x-5 translate-y-6 rounded-[1.75rem] bg-white/5 ring-1 ring-white/10 backdrop-blur" />

              <div className="relative rounded-2xl bg-gradient-brand p-6 shadow-premium-lg ring-1 ring-white/20">
                <div className="flex items-center justify-between text-white">
                  <span className="text-h3">MembeGo</span>
                  <ShieldCheck className="h-6 w-6 text-white" />
                </div>
                <p className="mt-1 text-overline tracking-[0.2em] text-white/70">
                  Membresía digital
                </p>

                <div className="mt-6 flex items-center justify-center rounded-2xl bg-card p-4 shadow-inner">
                  {/* QR estilizado (decorativo) */}
                  <div className="grid grid-cols-5 gap-1">
                    {Array.from({ length: 25 }).map((_, i) => {
                      const on = [0, 1, 2, 4, 5, 7, 9, 10, 12, 14, 15, 18, 20, 21, 22, 24].includes(i)
                      return (
                        <div
                          key={i}
                          className={`h-5 w-5 rounded-lg ${on ? 'bg-foreground' : 'bg-muted'}`}
                        />
                      )
                    })}
                  </div>
                </div>

                <div className="mt-6 flex items-end justify-between text-white">
                  <div>
                    <p className="text-overline tracking-wider text-white/70">Titular</p>
                    <p className="font-semibold">Tu nombre</p>
                  </div>
                  <div className="text-right">
                    <p className="text-overline tracking-wider text-white/70">Plan</p>
                    <p className="font-semibold">Premium</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Chips flotantes */}
            <div className="absolute -left-5 top-10 hidden animate-float-slow items-center gap-1.5 rounded-2xl bg-card px-3.5 py-2.5 text-sm font-medium text-foreground shadow-premium sm:flex">
              <QrCode className="h-4 w-4 text-primary" /> Válida al instante
            </div>
            <div className="absolute -bottom-4 -right-3 hidden animate-float items-center gap-1.5 rounded-2xl bg-card px-3.5 py-2.5 text-sm font-medium text-foreground shadow-premium delay-300 sm:flex">
              <Sparkles className="h-4 w-4 text-warning" /> Beneficios exclusivos
            </div>
          </div>
        </div>
      </div>

      {/* Transición suave hacia el contenido claro */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent" />
    </section>
  )
}
