'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Gift, Sparkles, RotateCw, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { girarRuleta, type GiroResultado } from '@/modules/gamificacion/ruletaActions'
import { Button } from '@/components/ui/button'
import type { RuletaPremioPublico } from '@/modules/engagement/ruleta'

const PALETA = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']

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

export function RuletaWheel({
  premios,
  costo,
  saldoInicial,
}: {
  premios: RuletaPremioPublico[]
  costo: number
  saldoInicial: number
}) {
  const router = useRouter()
  const reduced = useReducedMotion()
  const [spinning, setSpinning] = useState(false)
  const [rot, setRot] = useState(0)
  const rotRef = useRef(0)
  const [resultado, setResultado] = useState<GiroResultado | null>(null)
  const [saldo, setSaldo] = useState(saldoInicial)

  const n = premios.length
  const seg = n > 0 ? 360 / n : 360
  const color = (k: number) => premios[k].color || PALETA[k % PALETA.length]

  const gradient =
    n > 0
      ? `conic-gradient(from 0deg, ${premios
          .map((_, k) => `${color(k)} ${k * seg}deg ${(k + 1) * seg}deg`)
          .join(', ')})`
      : '#e2e8f0'

  const puedeGirar = saldo >= costo && n > 0 && !spinning

  const girar = async () => {
    if (spinning || !puedeGirar) return
    setSpinning(true)
    setResultado(null)
    try {
      const res = await girarRuleta()
      if (!res.ok) {
        toast.error(res.error ?? 'No se pudo girar.')
        setSpinning(false)
        return
      }
      const k = premios.findIndex((p) => p.id === res.premioId)
      const idx = k >= 0 ? k : 0
      const target = 360 - (idx * seg + seg / 2) // llevar el centro del gajo al puntero (arriba)
      const currentMod = ((rotRef.current % 360) + 360) % 360
      const delta = ((target - currentMod) + 360) % 360
      const vueltas = reduced ? 0 : 5
      const total = rotRef.current + vueltas * 360 + delta
      rotRef.current = total
      setRot(total)
      const espera = reduced ? 250 : 4700
      window.setTimeout(() => {
        setResultado(res)
        if (typeof res.saldoRestante === 'number') setSaldo(res.saldoRestante)
        setSpinning(false)
        router.refresh()
      }, espera)
    } catch {
      toast.error('No se pudo girar. Intenta de nuevo.')
      setSpinning(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Rueda */}
      <div className="relative h-72 w-72 sm:h-80 sm:w-80">
        {/* Puntero */}
        <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1">
          <div className="h-0 w-0 border-x-[12px] border-t-[20px] border-x-transparent border-t-slate-800 drop-shadow" />
        </div>

        <div
          className="absolute inset-0 rounded-full border-8 border-white shadow-premium"
          style={{
            background: gradient,
            transform: `rotate(${rot}deg)`,
            transition: reduced ? 'none' : 'transform 4.5s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {premios.map((p, k) => {
            const angle = k * seg + seg / 2
            return (
              <div
                key={p.id}
                className="absolute left-1/2 top-1/2"
                style={{ transform: `rotate(${angle}deg) translateY(-42%)` }}
              >
                <span
                  className="block max-w-[6rem] -translate-x-1/2 -translate-y-1/2 text-center text-xs font-bold leading-tight text-white drop-shadow"
                  style={{ transform: `translate(-50%,-50%) rotate(90deg)` }}
                >
                  {p.nombre}
                </span>
              </div>
            )
          })}
        </div>

        {/* Centro */}
        <div className="absolute left-1/2 top-1/2 z-10 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white bg-slate-800 text-white shadow-lg">
          <Sparkles className="h-6 w-6" />
        </div>
      </div>

      {/* Saldo + botón */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Saldo: <span className="font-bold text-foreground">{saldo.toLocaleString('es-DO')}</span> pts ·
          Costo por giro: <span className="font-bold text-foreground">{costo}</span> pts
        </p>
        <Button
          onClick={girar}
          disabled={!puedeGirar}
          size="lg"
          className="min-w-52 py-6 text-lg font-bold shadow-glow"
        >
          {spinning ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <RotateCw className="mr-2 h-5 w-5" />
          )}
          {spinning ? 'Girando…' : saldo >= costo ? 'Girar la ruleta' : `Te faltan ${costo - saldo} pts`}
        </Button>
      </div>

      {/* Resultado */}
      {resultado && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            aria-label="Cerrar"
            onClick={() => setResultado(null)}
          />
          <div
            className="relative z-10 w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-2xl"
            style={{ animation: reduced ? 'none' : 'celebra-pop 0.4s cubic-bezier(0.16,1,0.3,1)' }}
          >
            <style>{`@keyframes celebra-pop {0%{transform:scale(0.85);opacity:0}100%{transform:scale(1);opacity:1}}`}</style>
            <div
              className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${
                resultado.gano ? 'bg-success/15' : 'bg-muted'
              } ${reduced ? '' : 'animate-bounce'}`}
            >
              {resultado.gano ? (
                <PartyPopper className="h-10 w-10 text-success" />
              ) : (
                <Gift className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
            <h2 className="mt-4 text-2xl font-extrabold text-foreground">
              {resultado.gano ? '🎉 ¡Ganaste!' : '¡Casi!'}
            </h2>
            <p className="mt-1.5 text-lg font-bold text-foreground">{resultado.premioNombre}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {resultado.gano
                ? 'Tu premio ya está en tu wallet con su código QR. Preséntalo en el negocio.'
                : 'No te desanimes, sigue participando para ganar tu premio.'}
            </p>
            <Button onClick={() => setResultado(null)} className="mt-5 w-full py-5 font-bold">
              {resultado.gano ? 'Ver mi premio' : 'Seguir'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
