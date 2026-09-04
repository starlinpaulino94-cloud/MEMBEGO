'use client'
// allow: SIZE_OK — sidebar + chat panel share selection/message state; splitting adds context/lift for no behavioral gain

import { useState, useMemo, useRef, useEffect, useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search,
  MessageCircle,
  Camera,
  MessageSquare,
  Mail,
  Send,
  ExternalLink,
} from 'lucide-react'
import { CANAL_TINTE } from '../paleta'
import { sendMessage, type ConversacionActionState } from '@/modules/crm/conversacion-actions'
import type { Conversacion, Mensaje } from '@/modules/crm/conversaciones-queries'

// ── Types ───────────────────────────────────────────────────────────────────

type Channel = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER' | 'EMAIL'

interface ChatPanelProps {
  conversaciones: Conversacion[]
  conversacionInicial: Conversacion | null
  mensajesIniciales: Mensaje[]
  companyId: string
}

// ── Constants ───────────────────────────────────────────────────────────────

const CHANNEL_ICON: Record<Channel, typeof MessageCircle> = {
  WHATSAPP: MessageCircle,
  INSTAGRAM: Camera,
  MESSENGER: MessageSquare,
  EMAIL: Mail,
}

const CHANNEL_LABEL: Record<Channel, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  MESSENGER: 'Messenger',
  EMAIL: 'Email',
}

const CHANNEL_TINTE: Record<Channel, { texto: string; fondo: string }> = {
  WHATSAPP: CANAL_TINTE.whatsapp,
  INSTAGRAM: CANAL_TINTE.instagram,
  MESSENGER: CANAL_TINTE.messenger,
  EMAIL: CANAL_TINTE.email,
}

const FILTER_OPTIONS = [
  { key: 'todos', label: 'Todos' },
  { key: 'WHATSAPP', label: 'WhatsApp' },
  { key: 'INSTAGRAM', label: 'Instagram' },
  { key: 'MESSENGER', label: 'Messenger' },
  { key: 'EMAIL', label: 'Email' },
] as const

const EMPTY_STATE: ConversacionActionState = {}

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Ahora'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Ayer'
  return `Hace ${days}d`
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit' }).format(date)
}

// ── Component ───────────────────────────────────────────────────────────────

export function ChatPanel({
  conversaciones,
  conversacionInicial,
  mensajesIniciales,
}: ChatPanelProps) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(conversacionInicial?.id ?? null)
  const [searchQuery, setSearchQuery] = useState('')
  const [channelFilter, setChannelFilter] = useState<string>('todos')
  const [newMessage, setNewMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [actionState, formAction, isPending] = useActionState(sendMessage, EMPTY_STATE)

  // Sync selectedId when server data changes (after revalidation)
  useEffect(() => {
    if (conversacionInicial && !selectedId) {
      setSelectedId(conversacionInicial.id)
    }
  }, [conversacionInicial, selectedId])

  // Refresh data after successful message send
  useEffect(() => {
    if (actionState?.success) {
      setNewMessage('')
      router.refresh()
    }
  }, [actionState, router])

  const selected = useMemo(
    () => (selectedId ? conversaciones.find((c) => c.id === selectedId) ?? conversacionInicial : conversacionInicial),
    [selectedId, conversaciones, conversacionInicial],
  )

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return conversaciones
      .filter((c) => {
        if (channelFilter !== 'todos' && c.canal !== channelFilter) return false
        if (q) {
          const leadNombre = c.lead?.nombre?.toLowerCase() ?? ''
          const ultimoMensaje = c.ultimoMensaje?.toLowerCase() ?? ''
          if (!leadNombre.includes(q) && !ultimoMensaje.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const dateA = a.ultimaFecha ? new Date(a.ultimaFecha).getTime() : 0
        const dateB = b.ultimaFecha ? new Date(b.ultimaFecha).getTime() : 0
        return dateB - dateA
      })
  }, [conversaciones, searchQuery, channelFilter])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajesIniciales.length])

  const selectConversation = (id: string) => {
    setSelectedId(id)
    router.refresh()
  }

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[500px] overflow-hidden rounded-2xl border border-border bg-card">
      {/* ── Left Panel: Conversation List ── */}
      <div className="flex w-[350px] shrink-0 flex-col border-r border-border">
        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar conversación"
              placeholder="Buscar conversación..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Channel filters */}
        <div className="flex gap-1 px-3 pb-3">
          {FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              variant={channelFilter === opt.key ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setChannelFilter(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        <div className="border-t border-border" />

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageCircle className="mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-small text-muted-foreground">No hay conversaciones</p>
            </div>
          ) : (
            filtered.map((conv) => {
              const canal = conv.canal as Channel
              const Icon = CHANNEL_ICON[canal] ?? MessageCircle
              const tinte = CHANNEL_TINTE[canal] ?? CANAL_TINTE.email
              const isActive = conv.id === selectedId
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => selectConversation(conv.id)}
                  className={cn(
                    'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50',
                    isActive && 'bg-primary/10 border-l-2 border-primary',
                  )}
                >
                  {/* Channel icon */}
                  <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tinte.fondo)}>
                    <Icon className={cn('h-4 w-4', tinte.texto)} />
                  </span>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-small font-medium truncate">{conv.lead?.nombre ?? 'Sin nombre'}</p>
                      <span className="text-caption text-muted-foreground shrink-0">
                        {conv.ultimaFecha ? relativeTime(new Date(conv.ultimaFecha)) : ''}
                      </span>
                    </div>
                    <p className="text-caption text-muted-foreground mt-0.5 truncate">{conv.ultimoMensaje ?? ''}</p>
                  </div>

                  {/* Unread badge */}
                  {conv.noLeidos > 0 && (
                    <span className="mt-0.5 shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground tabular-nums">
                      {conv.noLeidos}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right Panel: Conversation View ── */}
      {selected ? (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            {(() => {
              const canal = selected.canal as Channel
              const Icon = CHANNEL_ICON[canal] ?? MessageCircle
              const tinte = CHANNEL_TINTE[canal] ?? CANAL_TINTE.email
              return (
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tinte.fondo)}>
                  <Icon className={cn('h-4 w-4', tinte.texto)} />
                </span>
              )
            })()}
            <div className="min-w-0 flex-1">
              <p className="text-small font-medium">{selected.lead?.nombre ?? 'Sin nombre'}</p>
              <p className="text-caption text-muted-foreground">
                {CHANNEL_LABEL[selected.canal as Channel] ?? selected.canal} · {selected.lead?.email ?? ''}
              </p>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Ver perfil
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="space-y-3">
              {mensajesIniciales.map((msg) => {
                const isAgent = msg.direccion === 'SALIENTE'
                return (
                  <div
                    key={msg.id}
                    className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[70%] px-3.5 py-2 text-small',
                        isAgent
                          ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-lg'
                          : 'bg-muted rounded-2xl rounded-bl-lg',
                      )}
                    >
                      <p>{msg.contenido}</p>
                      <p
                        className={cn(
                          'mt-1 text-caption',
                          isAgent ? 'text-primary-foreground/70' : 'text-muted-foreground',
                        )}
                      >
                        {formatTime(new Date(msg.createdAt))}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-border px-4 py-3">
            <form
              action={async (formData) => {
                formData.set('conversacionId', selected.id)
                formAction(formData)
              }}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="tipo" value="TEXTO" />
              <Input
                name="contenido"
                aria-label="Escribe un mensaje"
                placeholder="Escribe un mensaje..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    e.currentTarget.form?.requestSubmit()
                  }
                }}
                className="flex-1"
                disabled={isPending}
              />
              <Button type="submit" size="icon" disabled={!newMessage.trim() || isPending}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-center">
          <div>
            <MessageCircle className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
            <p className="text-small text-muted-foreground">Selecciona una conversación</p>
          </div>
        </div>
      )}
    </div>
  )
}
