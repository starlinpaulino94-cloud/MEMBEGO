'use client'

import { useEffect, useState } from 'react'
import { hayCookieDeSesion, interpretarSesion, type SesionLigera } from '@/lib/auth/sesion-ligera'

/**
 * El estado de sesión para la landing, sin volver dinámico su layout: se pregunta
 * UNA vez por página al endpoint ligero (varias tarjetas comparten la respuesta) y
 * se recuerda unos segundos, lo justo para no repetir la consulta al navegar entre
 * fichas pero sin quedarse desfasado después de iniciar o cerrar sesión.
 *
 * Mientras llega la respuesta (y si el navegador no ejecuta JavaScript) el estado
 * es `cargando`, y quien lo pinte debe mostrar la variante de VISITANTE: sus
 * enlaces funcionan para cualquiera, porque `/login` devuelve en un solo salto a
 * quien ya tiene sesión.
 *
 * Solo se pregunta si el navegador trae la cookie de sesión (`hayCookieDeSesion`): sin ella la respuesta
 * solo puede ser «visitante» y el tráfico anónimo no hace ninguna petición. Esa comprobación se repite en
 * cada montaje, ANTES de mirar el caché: al cerrar sesión la cookie desaparece y la landing deja de mostrar
 * «Ir a mi app» al instante, sin esperar a que caduque el caché de unos segundos.
 */

const VIGENCIA_MS = 15_000
let cache: { en: number; promesa: Promise<SesionLigera> } | null = null

function consultar(): Promise<SesionLigera> {
  const ahora = Date.now()
  if (cache && ahora - cache.en < VIGENCIA_MS) return cache.promesa
  const promesa = fetch('/api/v1/auth/sesion', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => interpretarSesion(j))
    .catch((): SesionLigera => ({ estado: 'visitante' }))
  cache = { en: ahora, promesa }
  return promesa
}

export function useSesionLigera(): SesionLigera {
  const [sesion, setSesion] = useState<SesionLigera>({ estado: 'cargando' })
  useEffect(() => {
    let vivo = true
    if (!hayCookieDeSesion(document.cookie)) {
      cache = null
      setSesion({ estado: 'visitante' })
      return
    }
    consultar().then((s) => {
      if (vivo) setSesion(s)
    })
    return () => {
      vivo = false
    }
  }, [])
  return sesion
}
