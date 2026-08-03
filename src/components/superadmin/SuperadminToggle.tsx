'use client'

import { useActionState, useEffect } from 'react'
import { Loader2, ShieldMinus, ShieldPlus } from 'lucide-react'
import { toast } from 'sonner'
import { alternarSuperadmin, type AccesoState } from '@/modules/superadmin/accesoActions'
import { Button } from '@/components/ui/button'

const init: AccesoState = {}

/** Otorga o retira el rango SUPERADMIN a un usuario de staff (nunca a uno mismo). */
export function SuperadminToggle({
  userId,
  nombre,
  esSuperadmin,
  esYo,
}: {
  userId: string
  nombre: string
  esSuperadmin: boolean
  esYo: boolean
}) {
  const [state, action, pending] = useActionState(alternarSuperadmin, init)

  useEffect(() => {
    if (state.success) {
      toast.success(
        esSuperadmin
          ? `${nombre} ya no es superadmin.`
          : `${nombre} ahora es superadmin de toda la plataforma.`
      )
    }
    if (state.error) toast.error(state.error)
    // Solo reaccionar al resultado de ESTE envío.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (esYo) return null

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const ok = window.confirm(
          esSuperadmin
            ? `¿Quitarle el rango de superadmin a ${nombre}? Volverá a ser administrador de su empresa.`
            : `¿Hacer a ${nombre} SUPERADMIN? Tendrá control TOTAL de la plataforma: todas las empresas, todos los clientes, todos los pagos.`
        )
        if (!ok) e.preventDefault()
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Button
        type="submit"
        size="sm"
        variant={esSuperadmin ? 'outline' : 'secondary'}
        disabled={pending}
        className="text-xs"
      >
        {pending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : esSuperadmin ? (
          <ShieldMinus className="mr-1.5 h-3.5 w-3.5" />
        ) : (
          <ShieldPlus className="mr-1.5 h-3.5 w-3.5" />
        )}
        {esSuperadmin ? 'Quitar superadmin' : 'Hacer superadmin'}
      </Button>
    </form>
  )
}
