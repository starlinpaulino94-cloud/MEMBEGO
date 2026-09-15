'use client'

import { Trash2 } from 'lucide-react'
import { eliminarVehiculo, type ProfileState } from '@/modules/cliente/profileActions'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

const init: ProfileState = {}

export function DeleteVehiculoButton({ vehiculoId, label }: { vehiculoId: string; label: string }) {
  return (
    <BotonConfirmado
      accion={eliminarVehiculo}
      estadoInicial={init}
      campos={{ vehiculoId }}
      variant="ghost"
      size="icon"
      ariaLabel="Eliminar vehículo"
      title="Eliminar vehículo"
      mensajeExito="Vehículo eliminado."
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
