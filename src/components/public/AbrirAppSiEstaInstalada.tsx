'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { irALaApp } from '@/lib/anfitriones'
import { corriendoComoApp } from '@/lib/pwa/instalacion'

/**
 * LA APP INSTALADA NO ABRE LA LANDING.
 *
 * El manifiesto arranca en `/cliente/inicio`, pero los teléfonos que
 * instalaron MembeGo cuando arrancaba en `/` pueden seguir abriendo la portada
 * hasta que el navegador relea el manifiesto. Si la portada se abre dentro de
 * la app instalada (modo standalone), se sustituye por la app del cliente: sin
 * sesión el proxy lleva al login y, tras entrar, a su inicio. En una pestaña
 * normal del navegador no hace nada: la landing sigue siendo la landing.
 */
export function AbrirAppSiEstaInstalada() {
  const router = useRouter()
  useEffect(() => {
    if (corriendoComoApp()) irALaApp(router, '/cliente/inicio', { reemplazar: true })
  }, [router])
  return null
}
