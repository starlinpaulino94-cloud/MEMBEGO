'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

const emptySubscribe = () => () => {}
const pad = (n: number) => n.toString().padStart(2, '0')

/**
 * Contador regresivo compacto y en vivo para promociones por vencer
 * ("Termina en 02:14:33"). SSR-safe: en el servidor pinta el valor inicial y
 * en el cliente empieza a correr.
 */
export function PromoCountdown({
  hasta,
  className,
}: {
  hasta: string | Date
  className?: string
}) {
  const target = new Date(hasta).getTime()
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
  const texto = d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`

  return (
    <span
      suppressHydrationWarning
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 font-mono text-caption font-bold tabular-nums text-rose-600 dark:text-rose-400',
        className
      )}
      aria-label={mounted ? `Termina en ${texto}` : undefined}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      Termina en {texto}
    </span>
  )
}
