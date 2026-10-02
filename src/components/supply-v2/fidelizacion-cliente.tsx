'use client'

import { useActionState, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { contratarMembresiaAction, miCodigoDeInvitacionAction, reclamarRecompensaAction, usarInvitacionAction } from '@/modules/supply-v2/actions-fidelizacion'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · lo que el cliente pulsa.
 *
 * Todo lo que decide algo lo decide el SERVIDOR: estos componentes solo
 * mandan el id de lo elegido. La clave de idempotencia se genera aquí y
 * viaja en el formulario, para que el doble clic no compre ni canjee dos
 * veces.
 */

function Aviso({ estado }: { estado: EstadoAccion<unknown> }) {
  if (estado.error) return <p className="text-sm text-destructive" data-testid="accion-error" role="alert">{estado.error}</p>
  if (estado.success) return <p className="text-sm text-primary" data-testid="accion-exito" role="status">{estado.success}</p>
  return null
}

function Enviar({ children, testid }: { children: React.ReactNode; testid: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} data-testid={testid} className="w-full">
      {pending ? 'Un momento…' : children}
    </Button>
  )
}

export function BotonContratar({ planId, gratuita, precio }: { planId: string; gratuita: boolean; precio: string }) {
  const [estado, accion] = useActionState(contratarMembresiaAction, {} as EstadoAccion<{ orderId: string | null }>)
  const clave = useId()
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="idempotencyKey" value={`membresia-${planId}-${clave}`} />
      <Enviar testid="btn-contratar-membresia">{gratuita ? 'Inscribirme gratis' : `Hacerme miembro · ${precio}`}</Enviar>
      <Aviso estado={estado} />
      {estado.data?.orderId && (
        <a className="block text-center text-sm underline" href={`/cliente/compras/${estado.data.orderId}`} data-testid="enlace-pagar-membresia">
          Ir a pagar
        </a>
      )}
    </form>
  )
}

export function BotonReclamar({ rewardId, puede, porQueNo }: { rewardId: string; puede: boolean; porQueNo: string | null }) {
  const [estado, accion] = useActionState(reclamarRecompensaAction, {} as EstadoAccion)
  const clave = useId()
  if (!puede) {
    return <p className="text-sm text-muted-foreground" data-testid="recompensa-bloqueada">{porQueNo}</p>
  }
  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="rewardId" value={rewardId} />
      <input type="hidden" name="idempotencyKey" value={`recompensa-${rewardId}-${clave}`} />
      <Enviar testid="btn-reclamar-recompensa">Pedirla con mis puntos</Enviar>
      <Aviso estado={estado} />
    </form>
  )
}

export function MiCodigoDeInvitacion({ programId, codigo }: { programId: string; codigo: string | null }) {
  const [estado, accion] = useActionState(miCodigoDeInvitacionAction, {} as EstadoAccion<{ code: string }>)
  const [copiado, setCopiado] = useState(false)
  const actual = estado.data?.code ?? codigo

  if (!actual) {
    return (
      <form action={accion}>
        <input type="hidden" name="programId" value={programId} />
        <Enviar testid="btn-generar-codigo">Crear mi enlace de invitación</Enviar>
        <Aviso estado={estado} />
      </form>
    )
  }

  const enlace = typeof window === 'undefined' ? `/r/${actual}` : `${window.location.origin}/cliente/invitar?codigo=${actual}`
  return (
    <div className="space-y-2">
      <p className="font-mono text-h3 tracking-widest" data-testid="mi-codigo-invitacion">{actual}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="btn-copiar-enlace"
        onClick={() => {
          navigator.clipboard?.writeText(enlace).then(
            () => setCopiado(true),
            () => setCopiado(false)
          )
        }}
      >
        {copiado ? 'Enlace copiado' : 'Copiar mi enlace'}
      </Button>
    </div>
  )
}

export function UsarInvitacion({ codigoInicial }: { codigoInicial?: string }) {
  const [estado, accion] = useActionState(usarInvitacionAction, {} as EstadoAccion)
  return (
    <form action={accion} className="space-y-2">
      <label className="block text-sm" htmlFor="codigo-invitacion">
        ¿Te invitaron? Escribe el código
      </label>
      <Input id="codigo-invitacion" name="codigo" defaultValue={codigoInicial} maxLength={40} placeholder="ABCD123456" data-testid="input-codigo-invitacion" />
      <Enviar testid="btn-usar-invitacion">Aplicar la invitación</Enviar>
      <Aviso estado={estado} />
    </form>
  )
}
