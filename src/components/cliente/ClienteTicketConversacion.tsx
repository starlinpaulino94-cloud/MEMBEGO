'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Send, User, Shield, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { responderTicketCliente, type ActionState } from '@/modules/soporte/actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface Mensaje {
  id: string
  autorTipo: string
  autorNombre: string
  cuerpo: string
  createdAt: string
}

const init: ActionState = {}

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
      Enviar
    </Button>
  )
}

export function ClienteTicketConversacion({
  ticketId,
  mensajes,
  cerrado,
}: {
  ticketId: string
  mensajes: Mensaje[]
  cerrado: boolean
}) {
  const [state, action] = useActionState(responderTicketCliente, init)

  useEffect(() => {
    if (state.success) toast.success('Mensaje enviado.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {mensajes.map((m) => {
          const isCliente = m.autorTipo === 'CLIENTE'
          if (m.autorTipo === 'SISTEMA') {
            return (
              <div
                key={m.id}
                className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground"
              >
                <Settings className="h-3 w-3" /> {m.cuerpo} · {m.createdAt}
              </div>
            )
          }
          return (
            <div key={m.id} className={`flex ${isCliente ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  isCliente ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                }`}
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs opacity-80">
                  {isCliente ? <User className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                  <span>{isCliente ? 'Tú' : 'Soporte'}</span>
                  <span>· {m.createdAt}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{m.cuerpo}</p>
              </div>
            </div>
          )
        })}
      </div>

      {cerrado ? (
        <p className="rounded-lg bg-muted/50 px-4 py-3 text-center text-sm text-muted-foreground">
          Este reporte está cerrado. Si necesitas más ayuda, crea uno nuevo desde el Centro de Ayuda.
        </p>
      ) : (
        <form action={action} className="space-y-3" key={state.success ? 'sent' : 'draft'}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <Textarea
            name="cuerpo"
            rows={3}
            aria-label="Tu mensaje"
            placeholder="Escribe tu mensaje…"
            required
          />
          <SubmitBtn />
        </form>
      )}
    </div>
  )
}
