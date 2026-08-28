'use client'

import { useEffect, useState } from 'react'
import { Users, Flame, Gift, UserPlus } from 'lucide-react'
import type { PruebaSocial as PruebaSocialData } from '@/modules/engagement/pruebaSocial'

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** Formatea números grandes: 1250 → "1.2k". */
function compact(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
}

/**
 * Engagement Engine · Fase 4 — Prueba social del Home (datos reales).
 * Muestra miembros, registros de la semana y beneficios reclamados, con un
 * "ticker" en vivo de la actividad reciente. Respeta prefers-reduced-motion.
 */
export function PruebaSocial({ data, color }: { data: PruebaSocialData; color?: string }) {
  const reduced = useReducedMotion()
  const { recientes } = data
  const accent = color || '#0ea5e9'
  const [idx, setIdx] = useState(0)

  // Rota la actividad reciente cada ~3.5s (salvo movimiento reducido).
  useEffect(() => {
    if (reduced || recientes.length <= 1) return
    const id = setInterval(() => setIdx((i) => (i + 1) % recientes.length), 3500)
    return () => clearInterval(id)
  }, [reduced, recientes.length])

  const stats = [
    { icon: Users, label: 'miembros', value: compact(data.totalMiembros), show: data.totalMiembros > 0 },
    { icon: Flame, label: 'esta semana', value: `+${compact(data.registrosSemana)}`, show: data.registrosSemana > 0 },
    { icon: Gift, label: 'beneficios reclamados', value: compact(data.beneficiosReclamados), show: data.beneficiosReclamados > 0 },
  ].filter((s) => s.show)

  const actual = recientes[idx]

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      {/* Ticker de actividad reciente */}
      {actual && (
        <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
            )}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-success">En vivo</span>
          <div key={idx} className={`min-w-0 flex-1 ${reduced ? '' : 'animate-slide-up'}`}>
            <p className="truncate text-sm text-foreground">
              <span className="inline-flex items-center gap-1 font-semibold">
                {actual.tipo === 'beneficio' ? (
                  <Gift className="h-3.5 w-3.5" style={{ color: accent }} />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" style={{ color: accent }} />
                )}
                {actual.nombre}
              </span>{' '}
              <span className="text-muted-foreground">
                {actual.tipo === 'beneficio' ? 'reclamó un beneficio' : 'se registró'} · {actual.hace}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Estadísticas reales */}
      {stats.length > 0 && (
        <div className="grid grid-cols-3 divide-x divide-border/60">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-0.5 px-2 py-3 text-center">
              <span className="flex items-center gap-1.5 text-lg font-extrabold text-foreground">
                <s.icon className="h-4 w-4" style={{ color: accent }} />
                {s.value}
              </span>
              <span className="text-xs leading-tight text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
