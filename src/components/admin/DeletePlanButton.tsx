'use client'

import { eliminarPlan } from '@/modules/admin/planActions'
import { DeleteButton } from '@/components/ui/delete-button'
import { plural } from '@/lib/plural'

/**
 * ELIMINAR UN PLAN — y decir la verdad cuando no se puede.
 *
 * Dos cosas estaban mal, y las dos se notaban solo al pulsar:
 *
 *  · Se miraban SOLO las membresías vendidas. Un plan también puede estar
 *    SOLICITADO —alguien pidió cambiarse a él—, y esa clave foránea impide
 *    borrar igual. El botón se veía habilitado, PostgreSQL rechazaba el
 *    borrado y aparecía «Ocurrió un error. Intenta de nuevo.»: lo peor que se
 *    puede decir, porque reintentar no iba a funcionar nunca.
 *
 *  · «membresía(s)». El paréntesis no es un plural mal resuelto, es el sistema
 *    diciendo «no me molesté», y en una pantalla por lo demás cuidada es justo
 *    el detalle que hace dudar del resto.
 *
 * `solicitudes` es opcional para no romper a quien todavía no lo pase; cuando
 * falta se comporta como antes.
 */
export function DeletePlanButton({
  planId,
  memberships,
  solicitudes = 0,
}: {
  planId: string
  memberships: number
  solicitudes?: number
}) {
  const enUso = memberships + solicitudes
  const motivos = [
    memberships > 0 ? plural(memberships, 'membresía vendida', 'membresías vendidas') : null,
    solicitudes > 0
      ? plural(solicitudes, 'cambio de plan pendiente', 'cambios de plan pendientes')
      : null,
  ].filter(Boolean)

  return (
    <DeleteButton
      action={async () => {
        const fd = new FormData()
        fd.set('planId', planId)
        return eliminarPlan({}, fd)
      }}
      title="¿Eliminar este plan?"
      description="Esta acción no se puede deshacer. Si solo quieres dejar de ofrecerlo, púsalo en pausa."
      successMessage="Plan eliminado."
      label="Eliminar plan"
      disabled={enUso > 0}
      disabledReason={motivos.join(' y ')}
    />
  )
}
