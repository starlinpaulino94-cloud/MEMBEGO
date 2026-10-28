'use client'

import { useCallback, useEffect, useState } from 'react'
import { activarPush, desactivarPush, estadoPush, type EstadoPush, type ResultadoActivacion } from '@/lib/pwa/push-cliente'

/**
 * El estado de las notificaciones push en ESTE navegador, para cualquier UI
 * que lo pinte (el aviso dentro de la app, la tarjeta de Configuración).
 * `estado === null` mientras se averigua: la UI no debe ofrecer nada aún.
 */
export function useNotificacionesPush() {
  const [estado, setEstado] = useState<EstadoPush | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const refrescar = useCallback(async () => {
    setEstado(await estadoPush())
  }, [])

  useEffect(() => {
    let vivo = true
    estadoPush().then((e) => {
      if (vivo) setEstado(e)
    })
    return () => {
      vivo = false
    }
  }, [])

  const activar = useCallback(async (): Promise<ResultadoActivacion> => {
    setOcupado(true)
    try {
      const resultado = await activarPush()
      await refrescar()
      return resultado
    } finally {
      setOcupado(false)
    }
  }, [refrescar])

  const desactivar = useCallback(async () => {
    setOcupado(true)
    try {
      await desactivarPush()
      await refrescar()
    } finally {
      setOcupado(false)
    }
  }, [refrescar])

  return { estado, ocupado, activar, desactivar, refrescar }
}
