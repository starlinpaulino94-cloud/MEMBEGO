'use client'

import { useRouter } from 'next/navigation'
import { confirmarPago } from '@/modules/admin/actions'
import { RenovarMembresiaDialog } from '@/components/admin/RenovarMembresiaDialog'
import { cancelarMembresia, desactivarMembresia } from '@/modules/admin/planActions'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { ConfirmarPagoButton, RechazarPagoButton } from '@/components/admin/ValidarPagoActions'
import type { MembershipEstado } from '@/types'

/**
 * LO QUE ESTE COMPONENTE NECESITA, Y NADA MÁS.
 *
 * Recibía además `clienteId`, `planLavados` y `planEsIlimitado`, que ni
 * siquiera se desestructuraban: la página los calculaba y los mandaba para
 * nada. `planPrecio` viajaba a un campo oculto que la acción ya no lee — el
 * monto de una renovación lo calcula el servidor a partir del plan, porque un
 * precio pintado al renderizar se queda viejo en cuanto alguien lo cambia.
 *
 * Props que no se usan no son inofensivas: engañan al leer, y sobre todo hacen
 * pensar que el dato importa. `clienteId` sí importaba — pero para ENLAZAR a la
 * ficha del cliente, cosa que ahora hace la propia tabla.
 */
interface Props {
  membershipId: string
  estado: MembershipEstado
  /**
   * Datos del cobro para la pantalla de renovación. Renovar escribe un
   * ingreso, así que quien lo hace tiene que ver QUÉ va a cobrar y declararlo;
   * un botón suelto no puede pedir eso.
   */
  renovacion?: {
    clienteId: string
    clienteNombre: string
    planNombre: string
    precioTexto: string
    lavadosPlan: number | null
    lavadosRegalo: number
    vigenciaDias: number
    vence: string | null
  }
}

/**
 * LOS ERRORES SE CUENTAN POR TOAST, COMO EN TODO EL PANEL.
 *
 * Antes este componente sostenía cuatro `useActionState` solo para juntar sus
 * errores en un `<span role="alert">` dentro de la celda. La intención era
 * buena —que un lector de pantalla anunciara el fallo—, pero era el único sitio
 * de la aplicación que lo hacía así, y aprender dónde mirar el resultado de una
 * acción no debería depender de en qué tabla estás. El toaster de la aplicación
 * ya es una región `aria-live`, así que el anuncio se conserva y el sitio pasa
 * a ser el mismo que en el resto del panel.
 */
export function MembershipAdminActions({ membershipId, estado, renovacion }: Props) {
  const router = useRouter()
  // Cualquiera de las cuatro cambia la fila: hay que recargar los datos del
  // servidor para que la tabla deje de enseñar el estado anterior.
  const refrescar = () => router.refresh()

  return (
    <div className="flex flex-wrap items-center gap-2">
      {estado === 'PENDIENTE' && (
        <BotonConfirmado
          accion={confirmarPago}
          estadoInicial={{}}
          campos={{ membershipId }}
          size="sm"
          variant="success"
          alExito={refrescar}
        >
          Activar
        </BotonConfirmado>
      )}

      {estado === 'PENDIENTE_PAGO' && (
        <>
          <ConfirmarPagoButton membershipId={membershipId} />
          <RechazarPagoButton membershipId={membershipId} />
        </>
      )}

      {(estado === 'ACTIVA' || estado === 'VENCIDA') && renovacion && (
        <RenovarMembresiaDialog membershipId={membershipId} {...renovacion} />
      )}

      {estado === 'ACTIVA' && (
        <BotonConfirmado
          accion={desactivarMembresia}
          estadoInicial={{}}
          campos={{ membershipId }}
          size="sm"
          variant="outline"
          className="border-warning/30 text-warning hover:bg-warning/15 hover:text-warning"
          alExito={refrescar}
          confirmacion={{
            titulo: '¿Desactivar esta membresía?',
            descripcion:
              'La membresía pasa a vencida y el cliente deja de poder usarla. Se puede renovar después.',
            textoConfirmar: 'Desactivar',
          }}
        >
          Desactivar
        </BotonConfirmado>
      )}

      {estado !== 'CANCELADA' && (
        <BotonConfirmado
          accion={cancelarMembresia}
          estadoInicial={{}}
          campos={{ membershipId }}
          size="sm"
          variant="outline"
          className="border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive"
          alExito={refrescar}
          confirmacion={{
            titulo: '¿Cancelar esta membresía?',
            descripcion: 'No se puede deshacer.',
            textoConfirmar: 'Sí, cancelar',
            peligrosa: true,
          }}
        >
          Cancelar
        </BotonConfirmado>
      )}
    </div>
  )
}
