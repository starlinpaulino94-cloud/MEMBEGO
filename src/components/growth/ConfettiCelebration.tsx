'use client'

import { useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { PartyPopper, Gift, ArrowRight } from 'lucide-react'

const emptySubscribe = () => () => {}

interface ConfettiCelebrationProps {
  /** Nombre del beneficio desbloqueado (si lo hay). */
  beneficio?: string | null
  /** Ruta del botón principal. */
  href: string
  ctaLabel?: string
}

const COLORES = ['#A855F7', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899']

/**
 * Growth Engine 3.0 · Celebración premium a pantalla completa tras el registro
 * (req #4). Confeti en CSS (sin dependencias externas, compatible con CSP).
 */
export function ConfettiCelebration({
  beneficio,
  href,
  ctaLabel = 'Ver mi beneficio',
}: ConfettiCelebrationProps) {
  // Solo se anima en el cliente (evita mismatch de hidratación).
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  // Piezas de confeti con posición/retraso deterministas por índice.
  const piezas = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 12) * 0.25,
        dur: 2.6 + ((i * 7) % 20) / 10,
        color: COLORES[i % COLORES.length],
        size: 6 + (i % 4) * 2,
        rot: (i * 47) % 360,
      })),
    []
  )

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-primary/15 via-card to-card px-4 text-center">
      {/* Confeti */}
      {mounted && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {piezas.map((p, i) => (
            <span
              key={i}
              className="absolute -top-6 block rounded-lg"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size * 1.6,
                backgroundColor: p.color,
                transform: `rotate(${p.rot}deg)`,
                animation: `mg-confetti ${p.dur}s linear ${p.delay}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes mg-confetti {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(540deg); opacity: 0.9; }
        }
      `}</style>

      <div className="relative z-10 w-full max-w-md">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary/15">
          <PartyPopper className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-3xl font-bold text-foreground">🎉 ¡Felicidades!</h1>
        <p className="mt-2 text-lg text-muted-foreground">Ya formas parte de MembeGo.</p>

        {beneficio && (
          <div className="mt-6 rounded-2xl border border-success/25 bg-success/10 p-5">
            <p className="text-sm font-semibold text-success">Has desbloqueado</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Gift className="h-6 w-6 text-success" />
              <span className="text-xl font-bold text-foreground">{beneficio}</span>
            </div>
          </div>
        )}

        <Link
          href={href}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground shadow-glow transition hover:opacity-95"
        >
          {ctaLabel} <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
    </div>
  )
}
