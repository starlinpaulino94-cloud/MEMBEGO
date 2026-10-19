'use client'

/**
 * EL ÚNICO SITIO DESDE EL QUE SE IMPRIME UN TICKET (16-10-2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Había seis bloques `@media print` escritos a mano (ticket del escáner, factura,
 * cierre de caja, cuadre del día, comprobante legado…), todos con el mismo truco:
 * `body * { visibility: hidden }` y la región del ticket `position: absolute;
 * top: 0`. Medido con la app real en papel de 80 mm, ese truco producía
 * exactamente lo que el negocio veía en el mostrador:
 *
 *   · 3 páginas por un ticket. `visibility: hidden` oculta el panel pero NO le
 *     quita la altura: el documento seguía midiendo 1 700–2 200 px, y la
 *     impresora cortaba una tira por página (una con el ticket y dos en blanco).
 *   · 3 COPIAS idénticas desde los diálogos de caja: su contenido vive dentro de
 *     un `DialogContent` con `position: fixed`, y lo `fixed` se repite en CADA
 *     página impresa. Además su `overflow-y: auto` recortaba el ticket por abajo.
 *   · El ticket del escáner salía recortado por la derecha: su `position:
 *     absolute` se anclaba al envoltorio `animate-scale-in` (que conserva un
 *     `transform` tras la animación y por eso es su contenedor), no a la hoja.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÓMO FUNCIONA
 *
 * 1. El contenido se renderiza en un PORTAL colgado directamente de `<body>`:
 *    fuera del panel, de los diálogos, de cualquier `transform` u `overflow`.
 * 2. Al imprimir, el resto de hijos de `<body>` se ocultan con `display: none`
 *    (sin altura: una sola página), solo mientras dura la impresión
 *    (`body[data-imprimiendo]`). En pantalla el área nunca se ve.
 * 3. Se imprime DESPUÉS del commit de React y con las imágenes (QR, logo) ya
 *    decodificadas: `window.print` toma la foto en ese instante. Por eso se pide
 *    con `solicitud` (un contador) y no llamando a `window.print` desde el
 *    manejador del botón, donde el «COPIA #N» recién calculado aún no estaba en
 *    el DOM y la copia salía como original.
 * 4. El ancho del contenido es el ÚTIL del papel, no el del rollo: una térmica
 *    de 80 mm imprime 72 mm (576 puntos) y una de 58 mm, 48 mm (384 puntos). Un
 *    bloque de 80 mm pierde la columna de la derecha en el papel aunque la vista
 *    previa en pantalla se vea entera.
 *
 * `tests/impresion-tickets.test.ts` impide que vuelva a aparecer un `@media print`
 * o un `window.print` suelto en una pantalla de tickets; `tests/e2e/impresion-
 * tickets.spec.ts` mide en el navegador que el resultado es una página, con el
 * ticket en el origen de la hoja. Los reportes A4 del panel (`ReporteImprimible`)
 * son otro producto y siguen su propio camino.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type PapelRollo = 58 | 80
export type PapelHoja = 'carta' | 'a4'
export type Papel = PapelRollo | PapelHoja

/** Ancho útil del papel térmico, en mm. Lo que se pinta cabe aquí; el resto del rollo es margen físico. */
export const ANCHO_IMPRIMIBLE_MM: Record<PapelRollo, number> = { 58: 48, 80: 72 }

export const ATRIBUTO_AREA = 'data-impresion'
export const ATRIBUTO_ACTIVA = 'data-activa'
export const ATRIBUTO_CUERPO = 'data-imprimiendo'
const ESTILO_ID = 'membego-impresion'

/**
 * `html body[data-imprimiendo]` y no `body[...]`: el bloqueo de scroll de los
 * diálogos (react-remove-scroll) pone `body[data-scroll-locked] { overflow:
 * hidden !important }`, y con overflow oculto algunos navegadores imprimen
 * solo la primera página. Un selector más específico gana la partida.
 */
export const ESTILOS_IMPRESION = `
@media screen {
  [${ATRIBUTO_AREA}] { display: none !important; }
}
@media print {
  html { height: auto !important; overflow: visible !important; margin: 0 !important; }
  html body[${ATRIBUTO_CUERPO}] {
    height: auto !important; min-height: 0 !important; overflow: visible !important;
    margin: 0 !important; padding: 0 !important; background: white !important;
  }
  body[${ATRIBUTO_CUERPO}] > :not([${ATRIBUTO_AREA}]) { display: none !important; }
  [${ATRIBUTO_AREA}] { display: none !important; }
  body[${ATRIBUTO_CUERPO}] [${ATRIBUTO_AREA}][${ATRIBUTO_ACTIVA}] { display: block !important; position: static !important; visibility: visible !important; }
  body[${ATRIBUTO_CUERPO}] [${ATRIBUTO_AREA}][${ATRIBUTO_ACTIVA}] * { visibility: visible !important; }
  [${ATRIBUTO_AREA}] .impresion-ticket {
    margin: 0 auto; color: black !important; background: white !important;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
}
`

function asegurarEstilos() {
  if (document.getElementById(ESTILO_ID)) return
  const estilo = document.createElement('style')
  estilo.id = ESTILO_ID
  estilo.textContent = ESTILOS_IMPRESION
  document.head.appendChild(estilo)
}

/** `@page` no se puede acotar a un elemento: cada área declara el suyo y el último del documento (este portal) manda. */
function paginaDe(papel: Papel): string {
  if (papel === 'carta') return 'size: letter; margin: 12mm;'
  if (papel === 'a4') return 'size: A4; margin: 12mm;'
  return 'size: auto; margin: 0;'
}

function anchoDe(papel: Papel): CSSProperties {
  return typeof papel === 'number' ? { width: `${ANCHO_IMPRIMIBLE_MM[papel]}mm` } : { width: '100%' }
}

/** Espera a que las imágenes del área (QR, logo) estén cargadas Y decodificadas; un logo remoto lento no bloquea para siempre. */
async function esperarImagenes(raiz: HTMLElement, maxMs = 3000): Promise<void> {
  const imagenes = Array.from(raiz.querySelectorAll('img'))
  const listas = Promise.all(
    imagenes.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolver) => {
          img.addEventListener('load', () => resolver(), { once: true })
          img.addEventListener('error', () => resolver(), { once: true })
        })
      }
      await img.decode().catch(() => undefined)
    })
  )
  await Promise.race([listas, new Promise<void>((resolver) => setTimeout(resolver, maxMs))])
}

export function AreaDeImpresion({
  papel,
  solicitud = 0,
  onImpreso,
  children,
}: {
  papel: Papel
  /** Contador: cada incremento imprime una vez, después de que React haya pintado los `children` de ese momento. */
  solicitud?: number
  /** Se llama cuando el diálogo de impresión se cerró (o pasados 5 s si el navegador no avisa). */
  onImpreso?: () => void
  children: ReactNode
}) {
  const [nodo, setNodo] = useState<HTMLDivElement | null>(null)
  const atendida = useRef(0)
  const onImpresoRef = useRef(onImpreso)
  useEffect(() => {
    onImpresoRef.current = onImpreso
  }, [onImpreso])

  useEffect(() => {
    const div = document.createElement('div')
    div.setAttribute(ATRIBUTO_AREA, '')
    document.body.appendChild(div)
    asegurarEstilos()
    setNodo(div)
    return () => {
      if (div.hasAttribute(ATRIBUTO_ACTIVA)) document.body.removeAttribute(ATRIBUTO_CUERPO)
      div.remove()
    }
  }, [])

  useEffect(() => {
    if (!nodo || solicitud === 0 || solicitud === atendida.current) return
    atendida.current = solicitud
    let cancelada = false
    let limpio = false
    const limpiar = () => {
      if (limpio) return
      limpio = true
      window.removeEventListener('afterprint', limpiar)
      document.body.removeAttribute(ATRIBUTO_CUERPO)
      nodo.removeAttribute(ATRIBUTO_ACTIVA)
      onImpresoRef.current?.()
    }
    void (async () => {
      await esperarImagenes(nodo)
      // Dos frames: el commit de React ya ocurrió (este efecto corre después), falta que el navegador pinte.
      await new Promise<void>((resolver) => requestAnimationFrame(() => requestAnimationFrame(() => resolver())))
      if (cancelada) return
      // Solo ESTA área sale en el papel, aunque otra siguiera montada.
      for (const otra of Array.from(document.querySelectorAll(`[${ATRIBUTO_AREA}][${ATRIBUTO_ACTIVA}]`))) otra.removeAttribute(ATRIBUTO_ACTIVA)
      nodo.setAttribute(ATRIBUTO_ACTIVA, '')
      document.body.setAttribute(ATRIBUTO_CUERPO, '')
      window.addEventListener('afterprint', limpiar)
      window.print()
      // La foto ya se tomó al llamar a print: limpiar después no cambia lo impreso, y evita dejar el cuerpo marcado.
      setTimeout(limpiar, 5000)
    })()
    return () => {
      cancelada = true
    }
  }, [nodo, solicitud])

  if (!nodo) return null
  return createPortal(
    <>
      <style>{`@media print { @page { ${paginaDe(papel)} } }`}</style>
      <div className="impresion-ticket" style={anchoDe(papel)}>
        {children}
      </div>
    </>,
    nodo
  )
}
