'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Flame, ArrowRight } from 'lucide-react'
import type { ExperienciaHero } from '@/modules/experience/engine'

const emptySubscribe = () => () => {}
const pad = (n: number) => n.toString().padStart(2, '0')

/** Contador grande en vivo (SSR-safe). */
function Contador({ expiraEn }: { expiraEn: string }) {
  const target = new Date(expiraEn).getTime()
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [ms, setMs] = useState(() => Math.max(0, target - Date.now()))
  useEffect(() => {
    const id = setInterval(() => setMs(Math.max(0, target - Date.now())), 1000)
    return () => clearInterval(id)
  }, [target])

  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const bloques = d > 0
    ? [{ v: d, t: 'días' }, { v: h, t: 'h' }, { v: m, t: 'm' }]
    : [{ v: h, t: 'h' }, { v: m, t: 'm' }, { v: sec, t: 's' }]

  return (
    <div className="flex items-center gap-1.5" aria-label={mounted ? undefined : 'placeholder'}>
      {bloques.map((b, i) => (
        <div key={i} className="flex flex-col items-center">
          <span className="min-w-[2.5rem] rounded-lg bg-white/25 px-2 py-1 text-center font-mono text-lg font-bold tabular-nums text-white">
            {pad(b.v)}
          </span>
          <span className="mt-0.5 text-xs font-semibold uppercase text-white/70">{b.t}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * MEE · Banner de una campaña de marketing elegida como héroe de la pantalla.
 * Conserva el branding propio de la campaña (colores/imagen configurados por
 * el admin) en vez de los tonos fijos del sistema — a diferencia del resto de
 * experiencias, una campaña SÍ es contenido de marca del negocio.
 */
export function CampanaBanner({ exp }: { exp: ExperienciaHero }) {
  const c = exp.campana
  const primary = c?.colorPrimario || '#e11d48'
  const secondary = c?.colorSecundario || '#9f1239'
  const arte = c?.bannerUrl || c?.imagenUrl

  return (
    <div
      className="animate-scale-in relative mb-6 overflow-hidden rounded-2xl p-5 text-white shadow-premium sm:p-6"
      style={{ background: `linear-gradient(120deg, ${primary}, ${secondary})` }}
      data-experiencia={exp.tipo}
    >
      {arte && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={arte} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${primary}ee, ${secondary}cc)` }} />
        </>
      )}
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-3xl" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider">
            <Flame className="h-3.5 w-3.5" /> {exp.eyebrow.replace(/^🔥\s*/, '')}
          </span>
          <h2 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
            {exp.titulo}
          </h2>
          <p className="max-w-lg text-sm text-white/85">{exp.descripcion}</p>
          {c?.cuposRestantes != null && c.cuposRestantes <= 50 && (
            <p className="text-xs font-bold text-white">
              🔥 ¡Solo quedan {c.cuposRestantes} cupo{c.cuposRestantes !== 1 ? 's' : ''}!
            </p>
          )}
          {c && c.reclamados > 0 && (
            <p className="text-xs font-semibold text-white/90">
              ✅ {c.reclamados} persona{c.reclamados !== 1 ? 's' : ''} ya
              {c.reclamados !== 1 ? ' reclamaron' : ' reclamó'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          {exp.hasta && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-white/70">Termina en</p>
              <Contador expiraEn={exp.hasta} />
            </div>
          )}
          <Link
            href={exp.ctaHref}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-2.5 text-sm font-bold shadow-md transition hover:scale-105"
            style={{ color: primary }}
          >
            {exp.ctaTexto}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
