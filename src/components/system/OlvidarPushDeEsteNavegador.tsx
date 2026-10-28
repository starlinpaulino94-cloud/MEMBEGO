'use client'

import { useEffect } from 'react'
import { olvidarPushDeEsteNavegador } from '@/lib/pwa/push-cliente'

/**
 * En las pantallas de entrada (sin sesión): este navegador deja de estar a
 * nombre de quien se fue. Ver `olvidarPushDeEsteNavegador`.
 */
export function OlvidarPushDeEsteNavegador() {
  useEffect(() => {
    void olvidarPushDeEsteNavegador()
  }, [])
  return null
}
