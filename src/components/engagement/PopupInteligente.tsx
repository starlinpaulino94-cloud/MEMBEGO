'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { X, Gift, Clock, CreditCard, Flame, PartyPopper, type LucideIcon, ArrowRight } from 'lucide-react'
import type { ExperienciaHero } from '@/modules/experience/engine'

const STORAGE_KEY = 'membego_popup_seen'
const VENTANA_MS = 24 * 60 * 60 * 1000 // no repetir el mismo aviso en 24h
const DELAY_MS = 1200 // deja asentar el Home (estilo Temu)

const ICONO: Record<ExperienciaHero['tipo'], LucideIcon> = {
  BENEFICIO_VENCE: Clock,
  BENEFICIO_LISTO: Gift,
  PAGO_PENDIENTE: CreditCard,
  CAMPANA: Flame,
  REFERIDOS: PartyPopper,
}

function yaVisto(key: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const map = JSON.parse(raw) as Record<string, number>
    const ts = map[key]
    return typeof ts === 'number' && Date.now() - ts < VENTANA_MS
  } catch {
    return false
  }
}

function marcarVisto(key: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    map[key] = Date.now()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // localStorage no disponible: el popup simplemente reaparecerá otro día.
  }
}

/**
 * Engagement Engine · Fase 8 — Popup inteligente.
 * Muestra el aviso #2 de `elegirExperiencias` (el Home ya usa el #1 como
 * héroe) — así el popup NUNCA repite lo que ya está visible en la pantalla,
 * como máximo una vez cada 24h por aviso. No molesto: se puede cerrar y no
 * reaparece hasta que cambie la condición.
 */
export function PopupInteligente({
  candidato,
  color,
}: {
  candidato: ExperienciaHero | null
  color?: string
}) {
  const [visible, setVisible] = useState(false)
  const accent = color || '#0ea5e9'
  const key = candidato ? `${candidato.tipo}:${candidato.ctaHref}` : null

  useEffect(() => {
    if (!key || yaVisto(key)) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const id = window.setTimeout(() => setVisible(true), reduced ? 0 : DELAY_MS)
    return () => window.clearTimeout(id)
    // Solo al montar: el aviso se decide una vez por carga del Home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cerrar = () => {
    if (key) marcarVisto(key)
    setVisible(false)
  }

  if (!candidato || !visible) return null
  const Icon = ICONO[candidato.tipo]

  // Portal al <body>: dentro del contenido, la transición de página
  // (template.tsx) crea un containing block y el `fixed` se ancla a la
  // página (larga) en vez de a la ventana — el aviso quedaba fuera de
  // vista, abajo. En el body, `fixed` es SIEMPRE la ventana: centrado
  // garantizado sin importar el scroll.
  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-5">
      <button
        className="animate-fade-in absolute inset-0 bg-slate-950/65 backdrop-blur-sm"
        aria-label="Cerrar"
        onClick={cerrar}
      />

      {/* Entrada con rebote elástico (MMS · burst) + halo de marca que respira */}
      <div
        className="animate-burst shine shine-loop relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-card shadow-hero"
        style={{ ['--glow-color' as string]: '255 255 255' }}
        role="dialog"
        aria-modal="true"
      >
        {/* Barrido de luz continuo sobre toda la tarjeta (elemento vivo) */}
        <span aria-hidden className="shine-sweep z-20" />

        <button
          onClick={cerrar}
          aria-label="Cerrar"
          className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition hover:bg-white/30 active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Cabecera hero con gradiente de la empresa ── */}
        <div
          className="relative overflow-hidden px-6 pb-14 pt-10 text-center"
          style={{ background: `linear-gradient(140deg, ${accent}, ${accent}99 60%, ${accent}66)` }}
        >
          {/* Halos decorativos */}
          <span aria-hidden className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-white/20 blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute -bottom-16 -right-8 h-44 w-44 rounded-full bg-black/10 blur-3xl" />
          {/* Destellos que laten en cascada */}
          <span aria-hidden className="animate-pulse-glow absolute left-8 top-8 text-lg text-white/90">✦</span>
          <span aria-hidden className="animate-pulse-glow delay-300 absolute right-12 top-14 text-xs text-white/80">✦</span>
          <span aria-hidden className="animate-pulse-glow delay-500 absolute bottom-10 left-14 text-sm text-white/70">✦</span>

          {/* Icono flotando con anillo de vidrio */}
          <span className="animate-float relative mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-white/30 bg-white/20 text-white shadow-glow backdrop-blur-md">
            <Icon className="h-10 w-10 drop-shadow" />
          </span>
        </div>

        {/* ── Contenido: la tarjeta blanca "muerde" el gradiente ── */}
        <div className="relative -mt-6 rounded-t-2xl bg-card px-6 pb-6 pt-6 text-center">
          <h2 className="text-h2 text-foreground">{candidato.titulo}</h2>
          <p className="mx-auto mt-2 max-w-[30ch] text-sm leading-relaxed text-muted-foreground">
            {candidato.descripcion}
          </p>

          {/* CTA protagonista: grande, pulsando suavemente, en zona del pulgar */}
          <Link
            href={candidato.ctaHref}
            onClick={cerrar}
            className="animate-pulse-soft mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-bold text-white shadow-floating transition-transform active:scale-[0.97]"
            style={{ background: `linear-gradient(135deg, ${accent}, ${accent}d9)` }}
          >
            {candidato.ctaTexto}
            <ArrowRight className="h-5 w-5" />
          </Link>
          <button
            onClick={cerrar}
            className="mt-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
