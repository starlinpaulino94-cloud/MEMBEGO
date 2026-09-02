'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
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

// ── Types ───────────────────────────────────────────────────────────────────

type Channel = 'whatsapp' | 'instagram' | 'messenger' | 'email'

interface Message {
  id: string
  sender: 'lead' | 'agent'
  text: string
  timestamp: string
}

interface Conversation {
  id: string
  leadNombre: string
  leadEmail: string
  channel: Channel
  lastMessage: string
  lastMessageAt: string
  unread: number
  messages: Message[]
}

// ── Constants ───────────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<Channel, { icon: typeof MessageCircle; label: string; color: string; bgColor: string }> = {
  whatsapp: { icon: MessageCircle, label: 'WhatsApp', color: 'text-green-600', bgColor: 'bg-green-100' },
  instagram: { icon: Camera, label: 'Instagram', color: 'text-purple-600', bgColor: 'bg-purple-100' },
  messenger: { icon: MessageSquare, label: 'Messenger', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  email: { icon: Mail, label: 'Email', color: 'text-muted-foreground', bgColor: 'bg-muted' },
}

const FILTER_OPTIONS = [
  { key: 'todos', label: 'Todos' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'messenger', label: 'Messenger' },
  { key: 'email', label: 'Email' },
] as const

const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: '1',
    leadNombre: 'María García',
    leadEmail: 'maria@autolavado.com',
    channel: 'whatsapp',
    lastMessage: 'Hola, me interesa el plan premium',
    lastMessageAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    unread: 2,
    messages: [
      { id: 'm1', sender: 'lead', text: 'Hola, buenas tardes', timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'agent', text: 'Hola María, ¿en qué puedo ayudarte?', timestamp: new Date(Date.now() - 28 * 60 * 1000).toISOString() },
      { id: 'm3', sender: 'lead', text: 'Me interesa el plan premium para mi negocio', timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
      { id: 'm4', sender: 'lead', text: 'Hola, me interesa el plan premium', timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString() },
    ],
  },
  {
    id: '2',
    leadNombre: 'Carlos Rodríguez',
    leadEmail: 'carlos@lavadorapido.com',
    channel: 'instagram',
    lastMessage: '¿Tienen disponibilidad para mañana?',
    lastMessageAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    unread: 0,
    messages: [
      { id: 'm1', sender: 'lead', text: 'Hola, vi su página en Instagram', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'agent', text: 'Hola Carlos, gracias por escribirnos. ¿En qué te podemos ayudar?', timestamp: new Date(Date.now() - 4.5 * 60 * 60 * 1000).toISOString() },
      { id: 'm3', sender: 'lead', text: '¿Tienen disponibilidad para mañana?', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    ],
  },
  {
    id: '3',
    leadNombre: 'Ana Martínez',
    leadEmail: 'ana@premiumcw.com',
    channel: 'email',
    lastMessage: 'Recibí la cotización, gracias',
    lastMessageAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    unread: 1,
    messages: [
      { id: 'm1', sender: 'agent', text: 'Hola Ana, te enviamos la cotización solicitada.', timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'lead', text: 'Recibí la cotización, gracias', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
    ],
  },
  {
    id: '4',
    leadNombre: 'Pedro López',
    leadEmail: 'pedro@elbrillo.com',
    channel: 'messenger',
    lastMessage: '¿Cuál es el precio?',
    lastMessageAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    unread: 0,
    messages: [
      { id: 'm1', sender: 'lead', text: 'Hola, ¿cuánto cuesta el servicio?', timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'agent', text: 'Hola Pedro, tenemos varios planes desde RD$800/mes.', timestamp: new Date(Date.now() - 5.5 * 60 * 60 * 1000).toISOString() },
      { id: 'm3', sender: 'lead', text: '¿Cuál es el precio?', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() },
    ],
  },
  {
    id: '5',
    leadNombre: 'Laura Sánchez',
    leadEmail: 'laura@superclean.com',
    channel: 'whatsapp',
    lastMessage: 'Perfecto, agendamos para el viernes',
    lastMessageAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    unread: 0,
    messages: [
      { id: 'm1', sender: 'lead', text: 'Hola, quiero agendar una demo', timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'agent', text: 'Claro Laura, ¿qué día te conviene?', timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString() },
      { id: 'm3', sender: 'lead', text: '¿El viernes a las 10am?', timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      { id: 'm4', sender: 'agent', text: 'Perfecto, agendado para el viernes a las 10am.', timestamp: new Date(Date.now() - 24.5 * 60 * 60 * 1000).toISOString() },
      { id: 'm5', sender: 'lead', text: 'Perfecto, agendamos para el viernes', timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
    ],
  },
  {
    id: '6',
    leadNombre: 'Roberto Díaz',
    leadEmail: 'roberto@carspa.com',
    channel: 'whatsapp',
    lastMessage: '¿Aceptan tarjeta de crédito?',
    lastMessageAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    unread: 3,
    messages: [
      { id: 'm1', sender: 'lead', text: 'Buenos días, tengo una pregunta', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'agent', text: 'Hola Roberto, dime', timestamp: new Date(Date.now() - 55 * 60 * 1000).toISOString() },
      { id: 'm3', sender: 'lead', text: '¿Aceptan tarjeta de crédito?', timestamp: new Date(Date.now() - 50 * 60 * 1000).toISOString() },
      { id: 'm4', sender: 'lead', text: '¿Aceptan tarjeta de crédito?', timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
      { id: 'm5', sender: 'lead', text: '¿Aceptan tarjeta de crédito?', timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
    ],
  },
  {
    id: '7',
    leadNombre: 'Sofía Hernández',
    leadEmail: 'sofia@lavadoservice.com',
    channel: 'email',
    lastMessage: 'Quiero cancelar mi reserva',
    lastMessageAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    unread: 0,
    messages: [
      { id: 'm1', sender: 'lead', text: 'Buenos días, reserve un servicio para el lunes.', timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'agent', text: 'Hola Sofía, tu reserva está confirmada para el lunes a las 9am.', timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString() },
      { id: 'm3', sender: 'lead', text: 'Quiero cancelar mi reserva', timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
    ],
  },
  {
    id: '8',
    leadNombre: 'Miguel Fernández',
    leadEmail: 'miguel@quickwash.com',
    channel: 'instagram',
    lastMessage: '¿Hacen envíos a todo el país?',
    lastMessageAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    unread: 0,
    messages: [
      { id: 'm1', sender: 'lead', text: 'Hola, ¿hacen envíos a todo el país?', timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() },
      { id: 'm2', sender: 'agent', text: 'Hola Miguel, actualmente operamos solo en Santo Domingo y Santiago.', timestamp: new Date(Date.now() - 71 * 60 * 60 * 1000).toISOString() },
    ],
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Ahora'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Ayer'
  return `Hace ${days}d`
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ConversacionesPage() {
  const [selectedId, setSelectedId] = useState<string>('1')
  const [searchQuery, setSearchQuery] = useState('')
  const [channelFilter, setChannelFilter] = useState<string>('todos')
  const [newMessage, setNewMessage] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>(INITIAL_CONVERSATIONS)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const selected = conversations.find((c) => c.id === selectedId) ?? null

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return conversations
      .filter((c) => {
        if (channelFilter !== 'todos' && c.channel !== channelFilter) return false
        if (q && !c.leadNombre.toLowerCase().includes(q) && !c.lastMessage.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
  }, [conversations, searchQuery, channelFilter])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selected?.messages.length])

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedId) return
    const msg: Message = {
      id: `m${Date.now()}`,
      sender: 'agent',
      text: newMessage.trim(),
      timestamp: new Date().toISOString(),
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? { ...c, messages: [...c.messages, msg], lastMessage: msg.text, lastMessageAt: msg.timestamp }
          : c,
      ),
    )
    setNewMessage('')
  }

  const selectConversation = (id: string) => {
    setSelectedId(id)
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)))
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Gestiona las conversaciones de tus prospectos en todos los canales.
      </p>

      <div className="flex h-[calc(100vh-220px)] min-h-[500px] overflow-hidden rounded-2xl border border-border bg-card">
        {/* ── Left Panel: Conversation List ── */}
        <div className="flex w-[350px] shrink-0 flex-col border-r border-border">
          {/* Search */}
          <div className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
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
                const cfg = CHANNEL_CONFIG[conv.channel]
                const Icon = cfg.icon
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
                    <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', cfg.bgColor)}>
                      <Icon className={cn('h-4 w-4', cfg.color)} />
                    </span>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-small font-medium truncate">{conv.leadNombre}</p>
                        <span className="text-caption text-muted-foreground shrink-0">
                          {relativeTime(conv.lastMessageAt)}
                        </span>
                      </div>
                      <p className="text-caption text-muted-foreground mt-0.5 truncate">{conv.lastMessage}</p>
                    </div>

                    {/* Unread badge */}
                    {conv.unread > 0 && (
                      <span className="mt-0.5 shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground tabular-nums">
                        {conv.unread}
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
                const cfg = CHANNEL_CONFIG[selected.channel]
                const Icon = cfg.icon
                return (
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', cfg.bgColor)}>
                    <Icon className={cn('h-4 w-4', cfg.color)} />
                  </span>
                )
              })()}
              <div className="min-w-0 flex-1">
                <p className="text-small font-medium">{selected.leadNombre}</p>
                <p className="text-caption text-muted-foreground">
                  {CHANNEL_CONFIG[selected.channel].label} · {selected.leadEmail}
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
                {selected.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn('flex', msg.sender === 'agent' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[70%] px-3.5 py-2 text-small',
                        msg.sender === 'agent'
                          ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-sm'
                          : 'bg-muted rounded-2xl rounded-bl-sm',
                      )}
                    >
                      <p>{msg.text}</p>
                      <p
                        className={cn(
                          'mt-1 text-[10px]',
                          msg.sender === 'agent' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                        )}
                      >
                        {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Escribe un mensaje..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  className="flex-1"
                />
                <Button size="icon" onClick={sendMessage} disabled={!newMessage.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
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
    </div>
  )
}
