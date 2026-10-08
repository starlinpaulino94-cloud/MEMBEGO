'use client'

import { useEffect, useState } from 'react'
import { resumirCarrito, type EmpresaDelCarrito } from '@/modules/checkout/actions'
import type { LineaDeCarrito } from '@/modules/checkout/domain'
import type { ResumenPublico } from '@/modules/checkout/service'

export type EstadoResumen = { estado: 'cargando' } | { estado: 'error'; error: string } | { estado: 'listo'; empresa: EmpresaDelCarrito; resumen: ResumenPublico }

/**
 * Los precios y la disponibilidad de un carrito, tal como están HOY en el servidor. Se vuelve a pedir cuando
 * cambian las líneas o la sucursal (con una pequeña espera para no preguntar a cada clic).
 */
export function useResumen(companySlug: string, lineas: readonly LineaDeCarrito[], sucursalId: string | null): EstadoResumen {
  const [estado, setEstado] = useState<EstadoResumen>({ estado: 'cargando' })
  const llave = JSON.stringify([companySlug, lineas, sucursalId])

  useEffect(() => {
    let vigente = true
    const espera = setTimeout(async () => {
      try {
        const r = await resumirCarrito({ companySlug, sucursalId, lineas: [...lineas] })
        if (!vigente) return
        setEstado(r.ok ? { estado: 'listo', empresa: r.empresa, resumen: r.resumen } : { estado: 'error', error: r.error })
      } catch {
        if (vigente) setEstado({ estado: 'error', error: 'No se pudo cargar tu carrito. Intenta de nuevo.' })
      }
    }, 200)
    return () => {
      vigente = false
      clearTimeout(espera)
    }
    // `llave` resume las tres entradas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llave])

  return estado
}
