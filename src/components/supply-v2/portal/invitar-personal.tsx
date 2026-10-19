'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { invitarPersonalProveedorAction } from '@/modules/supply-v2/actions-acceso'
import { PRESETS_ROL_PROVEEDOR, ROLES_DE_PROVEEDOR, type RolDeProveedor } from '@/modules/supply-v2/suppliers/acceso-dominio'
import type { InvitacionDePersonal } from '@/modules/supply-v2/suppliers/acceso'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · invitar personal del proveedor (§7) con
 * un rol de proveedor (dueño, operador, finanzas, solo lectura). El preset se
 * guarda en la invitación y la cuenta nace ya acotada.
 */
export function InvitarPersonal({ esDueno }: { esDueno: boolean }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<InvitacionDePersonal>, FormData>(invitarPersonalProveedorAction, {})
  const [rol, setRol] = useState<RolDeProveedor>('SUPPLIER_OPERATOR')
  const roles = ROLES_DE_PROVEEDOR.filter((r) => esDueno || r !== 'SUPPLIER_OWNER')
  return (
    <form action={enviar} className="space-y-3" data-testid="form-invitar-personal">
      <div>
        <Label htmlFor="emailPersonal">Correo</Label>
        <Input id="emailPersonal" name="email" type="email" required maxLength={160} autoComplete="off" data-testid="input-email-personal" />
      </div>
      <div>
        <Label htmlFor="rolPersonal">Qué hará</Label>
        <select id="rolPersonal" name="rol" value={rol} onChange={(e) => setRol(e.target.value as RolDeProveedor)} className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="select-rol-personal">
          {roles.map((r) => (
            <option key={r} value={r}>{PRESETS_ROL_PROVEEDOR[r].label}</option>
          ))}
        </select>
        <p className="mt-1 text-caption text-muted-foreground">{PRESETS_ROL_PROVEEDOR[rol].descripcion}</p>
      </div>
      {estado.error && <p className="text-sm text-destructive" role="alert" data-testid="invitar-error">{estado.error}</p>}
      {estado.success && <p className="text-sm text-success" data-testid="invitar-ok">{estado.success}</p>}
      <Button type="submit" size="lg" disabled={pendiente} loading={pendiente} data-testid="btn-invitar-personal">Enviar invitación</Button>
    </form>
  )
}
