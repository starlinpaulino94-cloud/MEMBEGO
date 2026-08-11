'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import {
  ejecutarAutomatizaciones,
  type AutomatizacionState,
} from '@/modules/admin/automatizacionActions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const init: AutomatizacionState = {}

export function EjecutarAutomatizaciones() {
  const [state, action, pending] = useActionState(ejecutarAutomatizaciones, init)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success && state.resultado) {
      const { cumpleanos, porVencer, inactivos, vigilancia } = state.resultado
      const total = cumpleanos + porVencer + inactivos + vigilancia
      toast.success(
        total === 0
          ? 'Todo al día: no había avisos nuevos que enviar.'
          : `Enviados: ${cumpleanos} de cumpleaños, ${porVencer} por vencer, ${inactivos} de inactividad y ${vigilancia} avisos al equipo.`
      )
    }
    if (state.error) toast.error(state.error)
  }, [state.success, state.resultado, state.error])

  return (
    <form ref={formRef} action={action}>
      <Button type="button" disabled={pending} onClick={() => setConfirmOpen(true)}>
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Zap className="mr-2 h-4 w-4" />
        )}
        Ejecutar ahora
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="¿Ejecutar las automatizaciones ahora?"
        description="Se enviarán las notificaciones pendientes a tus clientes."
        confirmText="Ejecutar"
        isLoading={pending}
        onConfirm={() => {
          setConfirmOpen(false)
          formRef.current?.requestSubmit()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </form>
  )
}
