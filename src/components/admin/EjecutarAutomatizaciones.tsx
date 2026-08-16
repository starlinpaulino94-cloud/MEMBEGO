'use client'

import { Zap } from 'lucide-react'
import { toast } from 'sonner'
import {
  ejecutarAutomatizaciones,
  type AutomatizacionState,
} from '@/modules/admin/automatizacionActions'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

const init: AutomatizacionState = {}

export function EjecutarAutomatizaciones() {
  return (
    <BotonConfirmado
      accion={ejecutarAutomatizaciones}
      estadoInicial={init}
      confirmacion={{
        titulo: '¿Ejecutar las automatizaciones ahora?',
        descripcion: 'Se enviarán las notificaciones pendientes a tus clientes.',
        textoConfirmar: 'Ejecutar',
      }}
      // El mensaje depende del resultado, así que va por `alExito`: decir
      // «listo» cuando no se envió nada es peor que no decir nada.
      alExito={(estado) => {
        if (!estado.resultado) return
        const { cumpleanos, porVencer, inactivos, vigilancia } = estado.resultado
        const total = cumpleanos + porVencer + inactivos + vigilancia
        toast.success(
          total === 0
            ? 'Todo al día: no había avisos nuevos que enviar.'
            : `Enviados: ${cumpleanos} de cumpleaños, ${porVencer} por vencer, ${inactivos} de inactividad y ${vigilancia} avisos al equipo.`
        )
      }}
    >
      <Zap className="mr-2 h-4 w-4" aria-hidden />
      Ejecutar ahora
    </BotonConfirmado>
  )
}
