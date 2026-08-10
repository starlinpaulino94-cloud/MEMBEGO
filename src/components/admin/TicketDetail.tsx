'use client'

import { useActionState, useEffect, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Send, Lock, User, Shield, Settings } from 'lucide-react'
import { toast } from 'sonner'
import {
  responderTicket,
  agregarNotaInterna,
  cambiarEstadoTicket,
  type ActionState,
} from '@/modules/soporte/actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TICKET_ESTADOS,
  estadoLabel,
  estadoBadgeClass,
  categoriaLabel,
} from '@/lib/soporte'

interface Mensaje {
  id: string
  autorTipo: string
  autorNombre: string
  cuerpo: string
  esNotaInterna: boolean
  createdAt: string
}

interface Props {
  ticket: {
    id: string
    asunto: string
    estado: string
    categoria: string
    clienteNombre: string
    clienteEmail: string
    empresaNombre: string
    adjuntoUrl: string | null
    creado: string
  }
  mensajes: Mensaje[]
}

const init: ActionState = {}

export function TicketDetail({ ticket, mensajes }: Props) {
  const [isPending, startTransition] = useTransition()

  function onEstadoChange(estado: string) {
    startTransition(async () => {
      const r = await cambiarEstadoTicket(ticket.id, estado)
      if (r.error) toast.error(r.error)
      else toast.success(`Estado: ${estadoLabel(estado)}`)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      {/* Conversación */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg">{ticket.asunto}</CardTitle>
              <Badge className={estadoBadgeClass(ticket.estado)}>
                {estadoLabel(ticket.estado)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {mensajes.map((m) => (
              <MensajeBubble key={m.id} m={m} />
            ))}
          </CardContent>
        </Card>

        {/* Responder al cliente */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Responder al cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponderForm ticketId={ticket.id} estadoActual={ticket.estado} />
          </CardContent>
        </Card>

        {/* Nota interna */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-warning" /> Nota interna
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NotaForm ticketId={ticket.id} />
          </CardContent>
        </Card>
      </div>

      {/* Panel lateral */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detalles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="Cliente" value={ticket.clienteNombre} />
            <Info label="Correo" value={ticket.clienteEmail} />
            <Info label="Empresa" value={ticket.empresaNombre} />
            <Info label="Categoría" value={categoriaLabel(ticket.categoria)} />
            <Info label="Creado" value={ticket.creado} />
            {ticket.adjuntoUrl && (
              <a
                href={ticket.adjuntoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Ver adjunto
              </a>
            )}
            <div className="space-y-1.5 pt-2">
              <Label>Cambiar estado</Label>
              <Select value={ticket.estado} onValueChange={onEstadoChange} disabled={isPending}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_ESTADOS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {estadoLabel(e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  )
}

function MensajeBubble({ m }: { m: Mensaje }) {
  const isCliente = m.autorTipo === 'CLIENTE'
  const isSistema = m.autorTipo === 'SISTEMA'

  if (isSistema) {
    return (
      <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
        <Settings className="h-3 w-3" /> {m.cuerpo} · {m.createdAt}
      </div>
    )
  }

  return (
    <div className={`flex ${isCliente ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          m.esNotaInterna
            ? 'border border-warning/30 bg-warning/15 text-warning'
            : isCliente
              ? 'bg-muted text-foreground'
              : 'bg-primary text-primary-foreground'
        }`}
      >
        <div className="mb-1 flex items-center gap-1.5 text-xs opacity-80">
          {m.esNotaInterna ? (
            <Lock className="h-3 w-3" />
          ) : isCliente ? (
            <User className="h-3 w-3" />
          ) : (
            <Shield className="h-3 w-3" />
          )}
          <span>{m.esNotaInterna ? 'Nota interna' : m.autorNombre}</span>
          <span>· {m.createdAt}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm">{m.cuerpo}</p>
      </div>
    </div>
  )
}

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  )
}

function ResponderForm({ ticketId, estadoActual }: { ticketId: string; estadoActual: string }) {
  const [state, action] = useActionState(responderTicket, init)
  useEffect(() => {
    if (state.success) toast.success('Respuesta enviada.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <form action={action} className="space-y-3" key={state.success ? 'sent' : 'draft'}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <Textarea name="cuerpo" rows={3} placeholder="Escribe tu respuesta…" required />
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm text-muted-foreground">Estado tras responder:</Label>
        <div className="w-48">
          <Select name="estado" defaultValue="ESPERANDO_CLIENTE">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_ESTADOS.map((e) => (
                <SelectItem key={e} value={e}>
                  {estadoLabel(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <SubmitBtn label="Enviar respuesta" />
      </div>
      <input type="hidden" value={estadoActual} readOnly />
    </form>
  )
}

function NotaForm({ ticketId }: { ticketId: string }) {
  const [state, action] = useActionState(agregarNotaInterna, init)
  useEffect(() => {
    if (state.success) toast.success('Nota interna agregada.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <form action={action} className="space-y-3" key={state.success ? 'saved' : 'draft'}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <Textarea
        name="cuerpo"
        rows={2}
        placeholder="Nota visible solo para el equipo…"
        required
      />
      <SubmitBtn label="Guardar nota" />
    </form>
  )
}
