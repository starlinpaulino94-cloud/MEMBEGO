'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  FileText,
  Gift,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getNotificaciones,
  marcarTodasLeidas,
  marcarLeida,
} from '@/modules/notificaciones/actions'
import type { Notificacion } from '@prisma/client'

const TIPO_ICON: Record<string, { icon: LucideIcon; cls: string }> = {
  PAGO_APROBADO: { icon: CheckCircle2, cls: 'bg-success/10 text-success' },
  PAGO_RECHAZADO: { icon: XCircle, cls: 'bg-destructive/10 text-destructive' },
  NUEVO_COMPROBANTE: { icon: FileText, cls: 'bg-info/10 text-info' },
  MEMBRESIA_POR_VENCER: { icon: AlertTriangle, cls: 'bg-warning/15 text-warning' },
  MEMBRESIA_ACTIVADA: { icon: BadgeCheck, cls: 'bg-success/10 text-success' },
  PROMOCION_NUEVA: { icon: Gift, cls: 'bg-primary/10 text-primary' },
  SISTEMA: { icon: Bell, cls: 'bg-muted text-muted-foreground' },
}

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'ahora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(date))
}

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [notifs, setNotifs] = useState<Notificacion[] | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  function handleOpen() {
    if (!open && notifs === null) {
      startTransition(async () => {
        const data = await getNotificaciones()
        setNotifs(data)
        setCount(data.filter((n) => !n.leida).length)
      })
    }
    setOpen((o) => !o)
  }

  function handleMarkAll() {
    startTransition(async () => {
      await marcarTodasLeidas()
      setNotifs((prev) => prev?.map((n) => ({ ...n, leida: true })) ?? null)
      setCount(0)
      // Sincroniza el resto de la app (contadores/listas) sin recargar.
      router.refresh()
    })
  }

  function handleClick(notif: Notificacion) {
    if (!notif.leida) {
      startTransition(async () => {
        await marcarLeida(notif.id)
        setNotifs((prev) =>
          prev?.map((n) => (n.id === notif.id ? { ...n, leida: true } : n)) ?? null
        )
        setCount((c) => Math.max(0, c - 1))
        router.refresh()
      })
    }
    setOpen(false)
    if (notif.href) router.push(notif.href)
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label={count > 0 ? `Notificaciones (${count} sin leer)` : 'Notificaciones'}
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          // El contador crece a 18px para que su texto quepa a 12px, el suelo
          // del sistema. A 10px se leía mal justo donde importa: cuántas cosas
          // tienes pendientes. `aria-hidden` porque la cuenta ya va en el
          // `aria-label` del botón — si no, el lector la anuncia dos veces.
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[12px] font-bold leading-none text-white"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border/60 bg-popover shadow-lg sm:w-96">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Notificaciones</p>
              {count > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <CheckCheck className="h-3 w-3" />
                  Marcar todas leídas
                </button>
              )}
            </div>

            <div className="max-h-[26rem] overflow-y-auto">
              {notifs === null ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Cargando…</div>
              ) : notifs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No tienes notificaciones.
                </div>
              ) : (
                <ul>
                  {notifs.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => handleClick(n)}
                        className={cn(
                          'w-full px-4 py-3 text-left transition hover:bg-muted/50',
                          !n.leida && 'bg-info/5'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {(() => {
                            const t = TIPO_ICON[n.tipo] ?? TIPO_ICON.SISTEMA
                            const Icon = t.icon
                            return (
                              <span
                                className={cn(
                                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                                  t.cls
                                )}
                              >
                                <Icon className="h-4 w-4" />
                              </span>
                            )
                          })()}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className={cn('truncate text-sm', !n.leida ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
                                {n.titulo}
                              </p>
                              <span className="shrink-0 text-xs text-muted-foreground/70">
                                {timeAgo(n.createdAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {n.mensaje}
                            </p>
                            {n.href && (
                              <span className="mt-1 flex items-center gap-1 text-xs text-primary">
                                <ExternalLink className="h-3 w-3" /> Ver detalle
                              </span>
                            )}
                          </div>
                          {!n.leida && (
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
