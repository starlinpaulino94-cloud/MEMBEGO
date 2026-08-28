'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

const STORAGE_KEY = 'membego_invita_recompensas'
const COLORES = ['#10b981', '#0ea5e9', '#f59e0b', '#f43f5e', '#8b5cf6', '#ffffff']

interface Pieza {
  left: number
  delay: number
  duration: number
  color: string
  size: number
  rotate: number
}

/**
 * Celebración de hito de "Invita y Gana": cuando el número de recompensas
 * obtenidas SUBIÓ desde la última visita (localStorage), lanza una lluvia de
 * confeti de ~4s + toast. Sin dependencias: CSS puro, y nada se anima con
 * prefers-reduced-motion (solo queda el toast).
 */
export function MilestoneConfetti({ recompensas }: { recompensas: number }) {
  const [piezas, setPiezas] = useState<Pieza[] | null>(null)

  useEffect(() => {
    let previas = 0
    try {
      previas = Number(localStorage.getItem(STORAGE_KEY) ?? '0')
    } catch {
      /* almacenamiento bloqueado: celebrar solo con toast */
    }
    if (recompensas > previas) {
      try {
        localStorage.setItem(STORAGE_KEY, String(recompensas))
      } catch {
        /* ignorar */
      }
      toast.success('🎉 ¡Nueva recompensa desbloqueada! Gracias por invitar.')
      const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reduced) {
        // Diferido: el confeti arranca en el siguiente tick (evita cascadas
        // de render sincrónicas dentro del efecto).
        const inicio = setTimeout(() => {
          setPiezas(
            Array.from({ length: 90 }, () => ({
              left: Math.random() * 100,
              delay: Math.random() * 1.2,
              duration: 2.4 + Math.random() * 1.6,
              color: COLORES[Math.floor(Math.random() * COLORES.length)],
              size: 6 + Math.random() * 6,
              rotate: Math.random() * 360,
            }))
          )
        }, 50)
        const fin = setTimeout(() => setPiezas(null), 4500)
        return () => {
          clearTimeout(inicio)
          clearTimeout(fin)
        }
      }
    } else if (recompensas < previas) {
      // Corrige el contador guardado si bajó (p. ej. cambio de cuenta).
      try {
        localStorage.setItem(STORAGE_KEY, String(recompensas))
      } catch {
        /* ignorar */
      }
    }
  }, [recompensas])

  if (!piezas) return null

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-celebration overflow-hidden">
      <style>{`
        @keyframes membego-confetti-fall {
          0%   { transform: translateY(-6vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(106vh) rotate(720deg); opacity: 0.6; }
        }
      `}</style>
      {piezas.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block rounded-[2px]"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.45,
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `membego-confetti-fall ${p.duration}s ease-in ${p.delay}s both`,
          }}
        />
      ))}
    </div>
  )
}
