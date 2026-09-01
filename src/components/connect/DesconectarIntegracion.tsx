'use client'

import { desconectarAppAction, type AccionState } from '@/modules/connect/adminActions'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

const INIT: AccionState = {}

/**
 * DESCONECTAR, con la consecuencia dicha antes de pulsar (§26 del rediseño).
 *
 * La acción de servidor borra además las credenciales: dejar un token vivo de
 * un servicio que la empresa cree apagado sería exactamente lo contrario de lo
 * que pidió.
 */
export function DesconectarIntegracion({
  conexionId,
  nombre,
  consecuencia,
}: {
  conexionId: string
  nombre: string
  consecuencia: string
}) {
  return (
    <BotonConfirmado
      accion={desconectarAppAction}
      estadoInicial={INIT}
      campos={{ id: conexionId }}
      variant="ghost"
      size="sm"
      confirmacion={{
        titulo: `¿Desconectar ${nombre}?`,
        descripcion: `${consecuencia} Se borran sus credenciales; para volver habrá que conectarlo de nuevo.`,
        textoConfirmar: 'Desconectar',
        peligrosa: true,
      }}
      mensajeExito={`${nombre} desconectado.`}
    >
      Desconectar
    </BotonConfirmado>
  )
}
