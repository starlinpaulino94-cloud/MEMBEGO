'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker (Fase 7, punto 28).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO EN PRODUCCIÓN, Y A PROPÓSITO
 *
 * En desarrollo, un service worker sirviendo archivos cacheados sobre un
 * servidor con recarga en caliente produce el peor síntoma que existe: cambias
 * el código, recargas, y ves lo de antes. Se pierden tardes enteras en eso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE MONTA
 *
 * En el layout raíz, para que el escáner tenga el service worker registrado
 * ANTES de que se vaya la luz —registrar cuando ya no hay red no sirve de
 * nada—. Y no hace falta acotarlo al escáner: la política de `public/sw.js` es
 * red primero para todo lo navegable, así que en el resto de la aplicación no
 * cambia nada salvo que una página cargue estando sin conexión.
 */
export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    // Tras la carga: registrar compite por ancho de banda con lo que el
    // usuario está esperando ver.
    const registrar = () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => {
        // Falla en navegación privada y con algunas políticas de empresa. No es
        // un error del que haya que enterarse: la aplicación funciona igual,
        // solo que sin poder abrirse sin conexión.
        console.warn('[sw] no se pudo registrar:', e)
      })
    }

    if (document.readyState === 'complete') registrar()
    else {
      window.addEventListener('load', registrar)
      return () => window.removeEventListener('load', registrar)
    }
  }, [])

  return null
}
