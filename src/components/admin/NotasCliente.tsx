'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, StickyNote, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  agregarNotaCliente,
  eliminarNotaCliente,
  type CrmState,
} from '@/modules/admin/crmActions'
import { Button } from '@/components/ui/button'
import { DeleteButton } from '@/components/ui/delete-button'
import { Textarea } from '@/components/ui/textarea'

export interface NotaClienteItem {
  id: string
  texto: string
  autorNombre: string | null
  createdAt: Date
}

const init: CrmState = {}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(d))
}

function DeleteNota({ notaId }: { notaId: string }) {
  const router = useRouter()

  return (
    <DeleteButton
      action={async () => {
        const fd = new FormData()
        fd.set('notaId', notaId)
        const res = await eliminarNotaCliente(init, fd)
        if (!res?.error) router.refresh()
        return res
      }}
      title="¿Eliminar esta nota?"
      label="Eliminar nota"
      successMessage="Nota eliminada."
      size="icon-sm"
    />
  )
}

export function NotasCliente({
  clienteId,
  notas,
}: {
  clienteId: string
  notas: NotaClienteItem[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState(agregarNotaCliente, init)

  useEffect(() => {
    if (state.success) {
      toast.success('Nota guardada.')
      formRef.current?.reset()
      router.refresh()
    }
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, router])

  return (
    <div className="space-y-4">
      {/* Nueva nota */}
      <form ref={formRef} action={action} className="space-y-2">
        <input type="hidden" name="clienteId" value={clienteId} />
        <Textarea
          name="texto"
          rows={2}
          maxLength={2000}
          placeholder="Observación interna sobre este cliente (solo la ve tu equipo)…"
          required
        />
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Agregar nota
        </Button>
      </form>

      {/* Historial */}
      {notas.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground/70">
          <StickyNote className="h-4 w-4" /> Sin notas todavía.
        </p>
      ) : (
        <ul className="space-y-3">
          {notas.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-warning/30 bg-warning-soft p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap text-sm text-foreground">{n.texto}</p>
                <DeleteNota notaId={n.id} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground/70">
                {n.autorNombre ?? 'Equipo'} · {fmtFecha(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
