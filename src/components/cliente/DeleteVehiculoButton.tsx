'use client'

import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { eliminarVehiculo, type ProfileState } from '@/modules/cliente/profileActions'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

const init: ProfileState = {}

/**
 * El aviso de éxito se lanza al resolverse la acción, no en el `useEffect` de
 * `BotonConfirmado`: borrar el vehículo retira su tarjeta de la lista, así que
 * el `useEffect` de un componente recién desmontado no llega a correr y el
 * toast se perdía. Aquí la continuación de la promesa sobrevive al desmontaje.
 * El error sigue saliendo del propio `BotonConfirmado`, una sola vez.
 */
async function eliminarConAviso(
  estadoPrevio: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const resultado = await eliminarVehiculo(estadoPrevio, formData)
  if (resultado.success) toast.success('Vehículo eliminado.')
  return resultado
}

export function DeleteVehiculoButton({ vehiculoId, label }: { vehiculoId: string; label: string }) {
  return (
    <BotonConfirmado
      accion={eliminarConAviso}
      estadoInicial={init}
      campos={{ vehiculoId }}
      variant="ghost"
      size="icon"
      ariaLabel="Eliminar vehículo"
      title="Eliminar vehículo"
      confirmacion={{
        titulo: `¿Eliminar "${label}"?`,
        textoConfirmar: 'Eliminar',
        peligrosa: true,
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </BotonConfirmado>
  )
}
