'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarClock, Check, Loader2, Pencil, X } from 'lucide-react'
import { ajustarVencimientoMembresia } from '@/modules/superadmin/membresiaActions'

/**
 * Superadmin · alarga manualmente el vencimiento de una membresía.
 * Siempre exige motivo porque cambia acceso del cliente sin registrar cobro.
 */
export function AjustarVencimiento({
  membershipId,
  fecha,
  fechaInput,
}: {
  membershipId: string
  fecha: string
  fechaInput: string
}) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(fechaInput)
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>{fecha}</span>
        <button
          type="button"
          title="Alargar vencimiento"
          className="text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => {
            setValor(fechaInput)
            setMotivo('')
            setEditando(true)
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </span>
    )
  }

  function guardar() {
    if (!valor) {
      toast.error('Indica la nueva fecha de vencimiento.')
      return
    }
    if (!motivo.trim()) {
      toast.error('Escribe el motivo del ajuste.')
      return
    }
    startTransition(async () => {
      const res = await ajustarVencimientoMembresia({
        membershipId,
        fecha: valor,
        motivo: motivo.trim(),
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Vencimiento actualizado.')
        setEditando(false)
        router.refresh()
      }
    })
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <input
        type="date"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-36 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
      />
      <input
        type="text"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo"
        maxLength={200}
        className="w-36 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            guardar()
          }
        }}
      />
      <button
        type="button"
        title="Guardar"
        disabled={pending}
        onClick={guardar}
        className="rounded-lg bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        title="Cancelar"
        disabled={pending}
        onClick={() => setEditando(false)}
        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
