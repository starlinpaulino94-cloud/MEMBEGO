'use client'

import { Bolt } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { InicioVista } from '@/modules/home/vista'

type Relampago = NonNullable<InicioVista['relampago']>

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
  return days > 0 ? `${days}d ${clock}` : clock
}

export function RetailRelampago({ relampago }: { relampago: Relampago }) {
  const expiresAt = Date.parse(relampago.hasta)
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, expiresAt - Date.now()))
    tick()
    const intervalId = window.setInterval(tick, 1_000)
    return () => window.clearInterval(intervalId)
  }, [expiresAt])

  if (remaining === 0) return null

  return (
    <Link
      href={relampago.href}
      className="flex min-h-11 items-center justify-between gap-3 border-y border-border bg-primary-soft px-4 py-2 text-caption text-foreground md:px-6"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Bolt className="size-4 text-primary" aria-hidden />
        Oferta relámpago con canje en QR
      </span>
      <span className="shrink-0 font-mono font-semibold tabular-nums text-primary" aria-live="off">
        {remaining === null ? 'Tiempo limitado' : `Termina en ${formatRemaining(remaining)}`}
      </span>
    </Link>
  )
}
