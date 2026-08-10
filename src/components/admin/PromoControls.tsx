'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play, Copy, Archive, ArchiveRestore } from 'lucide-react'
import { toast } from 'sonner'
import {
  alternarPausaPromocion,
  duplicarPromocion,
  alternarArchivoPromocion,
  type PromocionState,
} from '@/modules/admin/promocionActions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const init: PromocionState = {}

function ControlButton({
  id,
  action,
  icon,
  label,
  successMsg,
  confirmTitle,
  confirmText,
}: {
  id: string
  action: typeof alternarPausaPromocion
  icon: React.ReactNode
  label: string
  successMsg: string
  confirmTitle?: string
  confirmText?: string
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(action, init)

  useEffect(() => {
    if (state.success) toast.success(successMsg)
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, successMsg])

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button
        size="icon"
        variant="ghost"
        type={confirmTitle ? 'button' : 'submit'}
        disabled={pending}
        title={label}
        aria-label={label}
        onClick={confirmTitle ? () => setOpen(true) : undefined}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </Button>
      {confirmTitle && (
        <ConfirmDialog
          open={open}
          title={confirmTitle}
          confirmText={confirmText}
          isLoading={pending}
          onConfirm={() => {
            setOpen(false)
            formRef.current?.requestSubmit()
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </form>
  )
}

export function PromoControls({
  id,
  titulo,
  activo,
  archivada,
}: {
  id: string
  titulo: string
  activo: boolean
  archivada: boolean
}) {
  return (
    <div className="flex items-center">
      {!archivada && (
        <ControlButton
          id={id}
          action={alternarPausaPromocion}
          icon={
            activo ? (
              <Pause className="h-4 w-4 text-warning" />
            ) : (
              <Play className="h-4 w-4 text-success" />
            )
          }
          label={activo ? 'Pausar' : 'Reanudar'}
          successMsg={activo ? `"${titulo}" pausada.` : `"${titulo}" reanudada.`}
        />
      )}
      <ControlButton
        id={id}
        action={duplicarPromocion}
        icon={<Copy className="h-4 w-4 text-muted-foreground" />}
        label="Duplicar"
        successMsg={`Copia de "${titulo}" creada (pausada).`}
      />
      <ControlButton
        id={id}
        action={alternarArchivoPromocion}
        icon={
          archivada ? (
            <ArchiveRestore className="h-4 w-4 text-info" />
          ) : (
            <Archive className="h-4 w-4 text-muted-foreground" />
          )
        }
        label={archivada ? 'Restaurar' : 'Archivar'}
        successMsg={archivada ? `"${titulo}" restaurada.` : `"${titulo}" archivada.`}
        confirmTitle={
          archivada ? undefined : `¿Archivar "${titulo}"? Saldrá de todos los listados.`
        }
        confirmText={archivada ? undefined : 'Archivar'}
      />
    </div>
  )
}
