'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { ajustarLavadosMembresia } from '@/modules/superadmin/membresiaActions'

/**
 * Superadmin · ajuste manual de lavados/beneficios restantes de una
 * membresía. Pide un motivo (queda en la auditoría con el valor anterior).
 */
export function AjustarLavados({
  membershipId,
  lavados,
  esIlimitado,
}: {
  membershipId: string
  lavados: number
  esIlimitado: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(String(lavados))
  const [motivo, setMotivo] = useState('')
  const [pending, startTransition] = useTransition()

  if (esIlimitado) {
    return <span className="text-xs font-semibold text-muted-foreground">Ilimitado</span>
  }

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-bold tabular-nums text-foreground">{lavados}</span>
        <button
          type="button"
          title="Ajustar lavados/beneficios"
          className="text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => {
            setValor(String(lavados))
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
    const n = Number(valor)
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Indica una cantidad válida.')
      return
    }
    if (!motivo.trim()) {
      toast.error('Escribe el motivo del ajuste.')
      return
    }
    startTransition(async () => {
      const res = await ajustarLavadosMembresia({
        membershipId,
        lavados: n,
        motivo: motivo.trim(),
      })
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Cantidad actualizada.')
        setEditando(false)
      }
    })
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        type="number"
        min={0}
        max={9999}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
      />
      <input
        type="text"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo del ajuste"
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
