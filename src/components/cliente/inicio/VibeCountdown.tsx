'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}
const pad = (n: number) => n.toString().padStart(2, '0')

/**
 * El contador del chip «Termina en 04h:22m» de la tarjeta relámpago del
 * rediseño violeta. Solo el texto: el chip que lo viste lo pone la tarjeta.
 * SSR-safe igual que PromoCountdown: el servidor pinta el valor inicial.
 */
export function VibeCountdown({ hasta }: { hasta: string | Date }) {
  const target = new Date(hasta).getTime()
  useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [ms, setMs] = useState(() => Math.max(0, target - Date.now()))

  useEffect(() => {
    const id = setInterval(() => setMs(Math.max(0, target - Date.now())), 30_000)
    return () => clearInterval(id)
  }, [target])

  const min = Math.floor(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const texto = d > 0 ? `${d}d ${pad(h)}h` : `${pad(h)}h:${pad(m)}m`

  return <span suppressHydrationWarning>Termina en {texto}</span>
}
