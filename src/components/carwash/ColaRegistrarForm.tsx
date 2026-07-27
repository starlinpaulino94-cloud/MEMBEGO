'use client'

import { useActionState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import { registrarEnCola, type ColaActionState } from '@/modules/carwash/cola-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** App Car Wash · E5 — alta rápida en la cola (placa o descripción bastan). */
export function ColaRegistrarForm() {
  const [state, action, pending] = useActionState<ColaActionState, FormData>(
    registrarEnCola,
    {}
  )
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      formRef.current?.reset()
    }
    if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      {/* Pista (F4): el teclado del celular abre en MAYÚSCULAS y sin corrector,
          que es como se escribe una placa. Sin esto había que pulsar shift en
          cada letra y el corrector "arreglaba" la placa. */}
      <Input
        name="placa"
        placeholder="Placa (ej. A123456)"
        className="min-h-11 uppercase"
        maxLength={20}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <Input
        name="descripcion"
        placeholder="Vehículo (ej. Corolla gris)"
        className="min-h-11"
        maxLength={120}
        autoComplete="off"
      />
      <Input
        name="servicio"
        placeholder="Servicio (ej. Lavado full)"
        className="min-h-11"
        maxLength={120}
      />
      <Input
        name="notaInterna"
        placeholder="Nota interna (opcional)"
        className="min-h-11"
        maxLength={300}
      />
      <Button type="submit" disabled={pending} className="min-h-11 gap-1.5">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Agregar a la cola
      </Button>
    </form>
  )
}
