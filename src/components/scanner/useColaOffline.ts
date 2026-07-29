'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  limpiar,
  marcarEnviada,
  marcarFallo,
  nuevaPendiente,
  ordenar,
  reemplazar,
  resumen,
  siguienteAEnviar,
  type Pendiente,
  type ResumenCola,
  type TipoPendiente,
} from '@/modules/scanner/colaOffline'
import { almacenDisponible, guardarCola, leerCola } from '@/modules/scanner/almacenCola'

/**
 * ORQUESTACIÓN DE LA COLA SIN CONEXIÓN (Fase 7, punto 28).
 *
 * Junta las tres piezas: la política (`colaOffline.ts`, pura y probada), el
 * almacenamiento (`almacenCola.ts`) y el mundo real —React, `navigator.onLine`
 * y las server actions—.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA COLA ES UN ALMACÉN DE MÓDULO Y NO ESTADO DE REACT
 *
 * La cola vive en `localStorage`, que es un almacén EXTERNO a React: lo escribe
 * este código, sobrevive a las recargas y podría cambiarlo otra pestaña. La
 * forma correcta de leer algo así es `useSyncExternalStore`, no `useState` más
 * un efecto que lo hidrata al montar.
 *
 * Dos ventajas concretas, ninguna teórica:
 *
 *  · **Una sola cola.** Si dos componentes usaran el hook con estado propio,
 *    cada uno tendría su copia y ambos escribirían sobre el mismo
 *    `localStorage`, pisándose. Con un almacén de módulo eso no puede pasar
 *    aunque alguien monte el hook en dos sitios.
 *  · **Sin parpadeo al hidratar.** React usa `instantaneaServidor` para el
 *    render del servidor y solo después lee el almacenamiento de verdad, que
 *    es exactamente el orden que evita un desajuste de hidratación.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOBRE `navigator.onLine`
 *
 * Miente, y hay que saberlo: dice `true` en cuanto hay una interfaz de red
 * levantada, aunque el wifi del local no llegue a internet. Ese es exactamente
 * el caso de una pista con un repetidor a medias. Por eso `onLine` se usa solo
 * para lo que sí acierta —detectar que la red VOLVIÓ y disparar el reenvío al
 * instante— y nunca para decidir que algo va a fallar. Si dice que hay red y no
 * la hay, el intento falla, se reintenta con espera creciente y no se ha
 * perdido nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA A LA VEZ
 *
 * El bucle envía una entrada, espera el resultado y vuelve a mirar. No hay
 * paralelismo: mantiene el orden FIFO (que en este dominio decide números de
 * ticket) y evita que una red mala reciba cinco peticiones simultáneas de las
 * que ninguna llega.
 */

/**
 * Envía UNA entrada. Recibe la entrada entera y no solo su `FormData` porque
 * la cola guarda visitas y canjes, que son dos server actions distintas: quien
 * usa el hook es el que sabe cuál corresponde a cada `tipo`.
 */
export type EnviarPendiente = (p: Pendiente) => Promise<{ error?: string; success?: boolean }>

export interface ColaOffline {
  cola: Pendiente[]
  resumen: ResumenCola
  enLinea: boolean
  /** `false` si el navegador no deja guardar: se cae al envío directo. */
  disponible: boolean
  /** Encola una operación que no se pudo completar. Devuelve la entrada creada. */
  encolar: (entrada: {
    tipo: TipoPendiente
    datos: Record<string, string>
    etiqueta?: string
  }) => Pendiente | null
  /** Fuerza un intento ya, sin esperar al temporizador. */
  reintentarAhora: () => void
  /** Quita una entrada descartada que una persona ya resolvió. */
  descartar: (id: string) => void
}

// ── El almacén ──────────────────────────────────────────────────────────────

/** Referencia estable para el render del servidor: `useSyncExternalStore`
 *  exige que la instantánea no cambie de identidad si no cambió el contenido. */
const VACIA: Pendiente[] = []

let colaActual: Pendiente[] = VACIA
let hidratada = false
let almacenOk: boolean | null = null

const oyentes = new Set<() => void>()

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

function instantanea(): Pendiente[] {
  if (!hidratada && typeof window !== 'undefined') {
    hidratada = true
    // La limpieza al cargar quita lo ya enviado hace rato. Se hace aquí y no en
    // el bucle para que el contador no aparezca inflado el primer segundo.
    colaActual = disponible() ? ordenar(limpiar(leerCola())) : VACIA
  }
  return colaActual
}

function instantaneaServidor(): Pendiente[] {
  return VACIA
}

/** Memorizado: `almacenDisponible` escribe una sonda, y `getSnapshot` se llama
 *  en cada render. Sondear el almacenamiento sesenta veces por segundo sería
 *  absurdo, y el resultado no cambia durante la vida de la página. */
function disponible(): boolean {
  if (almacenOk === null) almacenOk = almacenDisponible()
  return almacenOk
}

function aplicar(siguiente: Pendiente[]): void {
  colaActual = ordenar(siguiente)
  guardarCola(colaActual)
  for (const oyente of oyentes) oyente()
}

// ── El hook ─────────────────────────────────────────────────────────────────

const sinRed = () => () => {}

function suscribirRed(oyente: () => void): () => void {
  window.addEventListener('online', oyente)
  window.addEventListener('offline', oyente)
  return () => {
    window.removeEventListener('online', oyente)
    window.removeEventListener('offline', oyente)
  }
}

/**
 * @param enviar función que hace el envío real (la server action envuelta).
 */
export function useColaOffline(enviar: EnviarPendiente): ColaOffline {
  const cola = useSyncExternalStore(suscribir, instantanea, instantaneaServidor)
  const enLinea = useSyncExternalStore(
    suscribirRed,
    () => navigator.onLine,
    // En el servidor se asume que hay red: es lo que no cambia nada. Asumir lo
    // contrario pintaría "sin conexión" durante un instante en cada carga.
    () => true
  )
  const hayAlmacen = useSyncExternalStore(sinRed, disponible, () => false)

  // Un envío a la vez. La referencia, y no un estado, porque cambiarlo no debe
  // repintar nada y porque tiene que leerse dentro del propio ciclo asíncrono.
  const enviandoRef = useRef(false)

  const bombear = useCallback(async () => {
    if (enviandoRef.current) return

    const p = siguienteAEnviar(colaActual, Date.now(), navigator.onLine)
    if (!p) return

    enviandoRef.current = true
    aplicar(reemplazar(colaActual, { ...p, estado: 'enviando' }))

    try {
      const r = await enviar(p)
      // `success` explícito. Un resultado sin `error` pero sin `success`
      // tampoco se da por bueno: en la duda, se reintenta (y si el servidor ya
      // lo registró, el reenvío choca con el QR invalidado y termina como
      // "QR ya utilizado", que sí es definitivo).
      aplicar(
        reemplazar(
          colaActual,
          r?.success ? marcarEnviada(p) : marcarFallo(p, r?.error ?? 'respuesta_ambigua')
        )
      )
    } catch (e) {
      // Aquí caen los fallos de red de verdad: la llamada rechazada.
      aplicar(
        reemplazar(colaActual, marcarFallo(p, e instanceof Error ? e.message : 'error_de_red'))
      )
    } finally {
      enviandoRef.current = false
    }
  }, [enviar])

  // Bucle. Cada 3 s mira si toca enviar algo; `siguienteAEnviar` decide de
  // verdad, según la espera creciente de cada entrada.
  useEffect(() => {
    if (!hayAlmacen) return
    const t = setInterval(() => {
      void bombear()
      // La limpieza va aquí: así las entradas ya enviadas desaparecen solas a
      // los diez minutos sin que nadie haga nada.
      const limpia = limpiar(colaActual)
      if (limpia.length !== colaActual.length) aplicar(limpia)
    }, 3000)
    return () => clearInterval(t)
  }, [hayAlmacen, bombear])

  // Cuando vuelve la red, no se espera al siguiente tic.
  useEffect(() => {
    if (enLinea) void bombear()
  }, [enLinea, bombear])

  const encolar = useCallback(
    (entrada: { tipo: TipoPendiente; datos: Record<string, string>; etiqueta?: string }) => {
      if (!hayAlmacen) return null
      const p = nuevaPendiente(entrada)
      aplicar([...colaActual, p])
      return p
    },
    [hayAlmacen]
  )

  const reintentarAhora = useCallback(() => {
    // Se reponen a "pendiente" con el temporizador a cero: es un botón que
    // pulsa una persona, y su expectativa es que pase ahora.
    aplicar(colaActual.map((p) => (p.estado === 'pendiente' ? { ...p, proximoIntento: 0 } : p)))
    void bombear()
  }, [bombear])

  const descartar = useCallback((id: string) => {
    aplicar(colaActual.filter((p) => p.id !== id))
  }, [])

  return {
    cola,
    resumen: resumen(cola),
    enLinea,
    disponible: hayAlmacen,
    encolar,
    reintentarAhora,
    descartar,
  }
}
