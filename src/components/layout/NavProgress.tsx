'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * LA BARRA FINA DE PROGRESO DE NAVEGACIÓN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * Las rutas del panel son `force-dynamic`: al pulsar un módulo, el servidor
 * tiene que resolver sesión, empresa y consultas antes de devolver nada. En
 * una conexión normal son cientos de milisegundos en los que la pantalla NO
 * CAMBIA. Sin señal, la lectura es «no me hizo caso» y la gente vuelve a
 * pulsar — que es peor, porque encola otra navegación.
 *
 * Dos píxeles de barra arriba convierten «no pasa nada» en «está viniendo».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE ESCUCHA EL CLIC Y NO EL ESTADO DE CADA ENLACE
 *
 * `useLinkStatus` da el estado pendiente de UN enlace y hay que llamarlo
 * dentro de él. Aquí hace falta lo contrario: una sola barra global que sirva
 * para los enlaces del menú, los de las migas, los de las tarjetas y los que
 * aparezcan mañana. Escuchar el clic en el documento los cubre todos sin que
 * ninguno tenga que saber que esta barra existe.
 *
 * NO SE MUESTRA cuando el clic no va a producir una navegación del enrutador:
 * enlaces externos, `target="_blank"`, descargas, clics con modificador (que
 * abren pestaña), anclas de la misma página y —el caso que más molesta— volver
 * a pulsar la ruta en la que ya estás. Una barra que aparece sin que cambie
 * nada enseña a ignorarla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE APAGA SOLA, SIN UN EFECTO QUE LA APAGUE
 *
 * No hay ningún `useEffect` que mire la ruta y cierre la barra. Lo que se
 * guarda es LA URL DESDE LA QUE SE PULSÓ, y la barra está activa mientras esa
 * URL siga siendo la actual. En cuanto el enrutador aterriza en otra, la
 * condición deja de cumplirse y la barra desaparece en el mismo render.
 *
 * Es estado DERIVADO en vez de estado sincronizado. Un efecto que llama a
 * `setState` al cambiar la ruta hace lo mismo pero con un render de más y una
 * ventana en la que los dos estados discrepan; aquí no puede haber discrepancia
 * porque solo hay un dato.
 */

/** Tramos del avance simulado: rápido al principio y cada vez más lento. */
const TRAMOS = [18, 34, 48, 60, 70, 78, 84, 88]
const MS_POR_TRAMO = 220
/** Techo de seguridad: pasado esto, la navegación no va a llegar. */
const MS_ABANDONO = 12_000

export function NavProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  /** La URL actual, tal y como la ve el enrutador. */
  const aqui = `${pathname}?${searchParams.toString()}`

  /** La URL desde la que se pulsó, o null si no hay navegación en curso. */
  const [origen, setOrigen] = useState<string | null>(null)
  const [avance, setAvance] = useState(0)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Activa mientras seguimos donde estábamos: llegar a otra ruta la apaga sin
  // que nadie tenga que apagarla.
  const activa = origen !== null && origen === aqui

  const limpiar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = null
  }, [])

  useEffect(() => {
    let paso = 0

    function avanzar() {
      const siguiente = TRAMOS[paso]
      if (siguiente === undefined) return
      paso += 1
      // Dentro de un temporizador, no en el cuerpo del efecto: no encadena
      // renders y es lo que la barra necesita para moverse.
      setAvance(siguiente)
      temporizador.current = setTimeout(avanzar, MS_POR_TRAMO)
    }

    function onClick(e: MouseEvent) {
      // Clic con modificador o botón secundario: el navegador abre otra
      // pestaña o el menú contextual. Esta pestaña no navega.
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const ancla = (e.target as HTMLElement | null)?.closest?.('a')
      if (!(ancla instanceof HTMLAnchorElement)) return
      if (ancla.target && ancla.target !== '_self') return
      if (ancla.hasAttribute('download')) return

      const href = ancla.getAttribute('href')
      if (!href || href.startsWith('#')) return

      let url: URL
      try {
        url = new URL(ancla.href, window.location.href)
      } catch {
        return
      }
      // Externo: se lo lleva el navegador, no el enrutador.
      if (url.origin !== window.location.origin) return
      // Ancla dentro de la misma página.
      if (url.pathname === window.location.pathname && url.hash) return
      // La ruta activa otra vez: no hay navegación que esperar.
      if (
        url.pathname + url.search ===
        window.location.pathname + window.location.search
      ) {
        return
      }

      limpiar()
      paso = 0
      setAvance(8)
      setOrigen(`${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`)
      temporizador.current = setTimeout(avanzar, MS_POR_TRAMO)
    }

    document.addEventListener('click', onClick, { capture: true })
    return () => {
      document.removeEventListener('click', onClick, { capture: true })
      limpiar()
    }
  }, [limpiar])

  // Guardia de abandono. El `setState` va dentro del temporizador, así que no
  // encadena renders; y solo se arma mientras hay algo que esperar.
  useEffect(() => {
    if (!activa) {
      limpiar()
      return
    }
    const t = setTimeout(() => setOrigen(null), MS_ABANDONO)
    return () => clearTimeout(t)
  }, [activa, limpiar])

  if (!activa) return null

  return (
    <div
      // `aria-hidden`: es decoración de estado. Anunciar un porcentaje que
      // sube solo no le dice nada útil a quien usa lector de pantalla, y el
      // cambio de página ya se anuncia por sí mismo.
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-toast h-0.5"
    >
      <div
        // `motion-reduce`: con movimiento reducido la barra sigue apareciendo
        // —la información es útil— pero salta entre tramos en vez de deslizarse.
        className="h-full bg-primary transition-[width] duration-slow ease-out motion-reduce:transition-none"
        style={{ width: `${avance}%` }}
      />
    </div>
  )
}
