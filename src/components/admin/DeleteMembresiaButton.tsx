'use client'

import { eliminarMembresia } from '@/modules/admin/planActions'
import { DeleteButton } from '@/components/ui/delete-button'
import { puedeBorrarseMembresia, explicarNoBorrable } from '@/modules/membresias/borrable'

/**
 * ELIMINAR UNA MEMBRESÍA QUE NUNCA LLEGÓ A USARSE.
 *
 * Existe para una sola cosa: limpiar los registros que dejan las pruebas. NO
 * es la forma de dar de baja a un cliente —para eso está cancelar, que
 * conserva el historial— y por eso el botón dice «Eliminar» y el texto de
 * confirmación empuja hacia cancelar cuando esa es la intención real.
 *
 * El botón decide si se OFRECE; quien decide si se PUEDE es el servidor, con
 * la misma función pura (`puedeBorrarseMembresia`). Que sea la misma es lo que
 * evita el fallo clásico de esta pantalla: un botón habilitado que al pulsarlo
 * devuelve «Ocurrió un error», que es lo peor que se le puede decir a alguien
 * —reintentar no va a funcionar nunca—. Aquí, si no se puede, se ve por qué
 * ANTES de tocarlo.
 */
export function DeleteMembresiaButton({
  membershipId,
  visitas,
  comprobantes,
  pagosConfirmados,
}: {
  membershipId: string
  visitas: number
  comprobantes: number
  pagosConfirmados: number
}) {
  const historial = { visitas, comprobantes, pagosConfirmados }
  const { borrable } = puedeBorrarseMembresia(historial)
  const motivo = explicarNoBorrable(historial)

  return (
    <DeleteButton
      action={async () => {
        const fd = new FormData()
        fd.set('membershipId', membershipId)
        return eliminarMembresia({}, fd)
      }}
      title="¿Eliminar esta membresía?"
      description="Se borra por completo y no se puede deshacer. Solo es posible porque no tiene visitas, comprobantes ni pagos confirmados. Si el cliente sí la usó y quieres darla de baja, cancélala en su lugar."
      successMessage="Membresía eliminada."
      label="Eliminar membresía"
      disabled={!borrable}
      // El «por qué no», en las mismas palabras que daría el servidor: la
      // frase sale de la misma función.
      disabledReason={motivo ?? undefined}
    />
  )
}
