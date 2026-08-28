'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { invitarMiembro, type InvitacionState } from '@/modules/admin/invitacionActions'
import { INVITABLE_ROLES } from '@/types'
import { roleLabel } from '@/components/layout/nav-config'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="invite-email">Correo del miembro</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          placeholder="persona@correo.com"
        />
      </div>
      <div className="space-y-1.5 sm:w-52">
        <Label htmlFor="invite-rol">Rol</Label>
        <select
          id="invite-rol"
          name="rol"
          required
          defaultValue="EMPLEADO"
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm"
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending} className="gap-1.5">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Invitar
      </Button>
    </form>
  )
}
