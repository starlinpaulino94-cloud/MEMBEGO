'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { CARRITO_VACIO, CLAVE_CARRITO, agregar as agregarAlCarrito, fijarCantidad, leerCarrito, quitar as quitarDelCarrito, totalDeUnidades, vaciarNegocio, type Carrito, type ResultadoCarrito } from '@/modules/checkout/domain'

/**
 * El carrito vive en el NAVEGADOR (localStorage), sin cuenta. Guarda solo qué variante y cuántas: los
 * precios y la disponibilidad se piden al servidor cada vez. Todo acceso al almacenamiento va en try/catch
 * (modo privado, datos bloqueados): si no se puede guardar, el carrito de esa visita vive en memoria.
 */

const EVENTO = 'mg-carrito-cambio'
let enMemoria: string | null = null

function leerCrudo(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_CARRITO) ?? enMemoria
  } catch {
    return enMemoria
  }
}

function escribir(c: Carrito) {
  const texto = JSON.stringify(c)
  enMemoria = texto
  try {
    window.localStorage.setItem(CLAVE_CARRITO, texto)
  } catch {
    // Sin almacenamiento: queda en memoria durante esta visita.
  }
  window.dispatchEvent(new Event(EVENTO))
}

function suscribir(avisar: () => void) {
  window.addEventListener(EVENTO, avisar)
  window.addEventListener('storage', avisar)
  return () => {
    window.removeEventListener(EVENTO, avisar)
    window.removeEventListener('storage', avisar)
  }
}

export function useCarrito() {
  // El servidor y la primera pintura ven «sin carrito» (null): no hay desajuste de hidratación.
  const crudo = useSyncExternalStore(suscribir, leerCrudo, () => null)
  const carrito = useMemo<Carrito>(() => (crudo === null ? CARRITO_VACIO : leerCarrito(crudo)), [crudo])

  const agregar = useCallback((slug: string, varianteId: string, cantidad: number): ResultadoCarrito => {
    const r = agregarAlCarrito(leerCarrito(leerCrudo()), slug, varianteId, cantidad)
    if (r.ok) escribir(r.carrito)
    return r
  }, [])
  const fijar = useCallback((slug: string, varianteId: string, cantidad: number) => escribir(fijarCantidad(leerCarrito(leerCrudo()), slug, varianteId, cantidad)), [])
  const quitar = useCallback((slug: string, varianteId: string) => escribir(quitarDelCarrito(leerCarrito(leerCrudo()), slug, varianteId)), [])
  const vaciar = useCallback((slug: string) => escribir(vaciarNegocio(leerCarrito(leerCrudo()), slug)), [])

  return { carrito, unidades: totalDeUnidades(carrito), agregar, fijar, quitar, vaciar }
}
