'use client'

import { useEffect, useState } from 'react'
import { tomarCelebracionDeCookie } from '@/lib/celebracion-entre-dominios'
import { sessionCookieDomain } from '@/lib/site'
import {
  CelebracionOverlay,
  type CelebracionData,
} from '@/components/invitaciones/CelebracionOverlay'

const KEY = 'membego_celebracion'

/**
 * Muestra el anuncio de felicitación POR ENCIMA del Home cuando el cliente
 * acaba de registrarse por una campaña de invitación y entró con auto-login.
 * Los datos viajan en sessionStorage (los deja la landing de invitación justo
 * antes de navegar) y se consumen una sola vez.
 */
export function CelebracionBienvenida() {
  const [data, setData] = useState<CelebracionData | null>(null)

  useEffect(() => {
    try {
      // Con dos dominios la landing la deja en una cookie corta; con uno, en sessionStorage.
      const raw = sessionStorage.getItem(KEY) ?? tomarCelebracionDeCookie(sessionCookieDomain())
      if (raw) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setData(JSON.parse(raw) as CelebracionData)
        sessionStorage.removeItem(KEY)
      }
    } catch {
      // Datos corruptos: se ignoran (la celebración es realce, no núcleo).
    }
  }, [])

  if (!data) return null
  return <CelebracionOverlay data={data} mode="cerrar" onClose={() => setData(null)} />
}
