'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { invitarMiembro, type InvitacionState } from '@/modules/admin/invitacionActions'
import { INVITABLE_ROLES } from '@/types'
import { roleLabel } from '@/components/layout/nav-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo } from '@/components/ui/campo'
import { SelectNativo } from '@/components/ui/select-nativo'

const init: InvitacionState = {}

export function InvitarEquipo() {
  const [state, action, pending] = useActionState(invitarMiembro, init)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.success) {
      toast.success('Invitación enviada por correo.')
      formRef.current?.reset()
    }
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  return (
    <form
      ref={formRef}
      action={action}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <Campo id="invite-email" etiqueta="Correo del miembro" className="flex-1">
        {(control) => <Input name="email" type="email" required placeholder="persona@correo.com" {...control} />}
      </Campo>
      <Campo id="invite-rol" etiqueta="Rol" className="sm:w-52">
        {(control) => (
          <SelectNativo name="rol" required defaultValue="EMPLEADO" {...control}>
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </SelectNativo>
        )}
      </Campo>
      <Button type="submit" loading={pending} className="gap-1.5">
        {!pending && <Send className="h-4 w-4" aria-hidden />}
        Invitar
      </Button>
    </form>
  )
}
