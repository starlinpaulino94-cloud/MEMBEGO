import { MembegoError, type MembegoClient } from '@membego/platform-sdk'
import type { AlmacenProyeccion } from './proyeccion'

/**
 * RECONCILIACIÓN — lo que arregla la copia cuando un webhook no llegó nunca.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL AGUJERO QUE ESTO TAPA
 *
 * El inbox evita procesar dos veces. El orden por `occurredAt` evita que un
 * evento viejo pise a uno nuevo. Ninguno de los dos hace nada si el evento
 * NO LLEGA.
 *
 * Y puede no llegar: el satélite estuvo caído más de lo que dura la política de
 * reintentos, el evento acabó en DEAD_LETTER, hubo una partición de red larga.
 * Cuando pasa, la copia queda vieja PARA SIEMPRE. Sin esto, nada la corrige y
 * nada avisa: el camarero ve un nombre desactualizado y no tiene forma de
 * saberlo.
 *
 * Es el único de los tres problemas de una proyección que no se resuelve
 * recibiendo mejor, sino preguntando.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE PUEDE RELEER TODO
 *
 * Un restaurante con veinte mil clientes proyectados no puede pedirlos todos
 * cada hora: sería un ataque a MembeGo desde dentro, y cuanto más creciera el
 * negocio, peor.
 *
 * Así que se leen LAS MÁS VIEJAS y con un presupuesto por pasada. Una copia
 * refrescada hace un minuto casi seguro está bien; una de hace tres días es
 * donde vive el problema. Con el presupuesto, la carga sobre el Core es fija y
 * conocida, y no crece con el número de clientes — lo que crece es el tiempo
 * que tarda en dar la vuelta, que es un dato que se puede mirar y ajustar.
 */

export interface FilaAReconciliar {
  customerId: string
  companyId: string
  vigenteDesde: Date
}

/** Lo que la reconciliación necesita de la base propia. */
export interface AlmacenReconciliacion extends AlmacenProyeccion {
  /** Las `limite` proyecciones más viejas, la más vieja primero. */
  masViejas(limite: number): Promise<FilaAReconciliar[]>
  /** El cliente ya no existe en el Core. */
  olvidar(customerId: string): Promise<void>
}

export interface OpcionesReconciliacion {
  /**
   * Cuántas proyecciones se refrescan por pasada. Es el presupuesto: la carga
   * que esta tarea le mete al Core, fija y conocida.
   */
  presupuesto?: number
  /**
   * No se molesta en releer lo refrescado hace menos de esto. Sin el umbral, la
   * tarea gastaría su presupuesto releyendo lo que acaba de llegar por webhook
   * — que es lo que MÁS al día está.
   */
  frescoMs?: number
  ahora?: () => Date
}

export interface ResumenReconciliacion {
  revisadas: number
  actualizadas: number
  /** Ya estaban al día: la copia coincidía con el Core. */
  sinCambios: number
  /** Desaparecidas del Core. */
  olvidadas: number
  fallidas: number
  /** Antigüedad de la copia MÁS VIEJA que quedó sin revisar, en ms. */
  desfaseMaximoPendiente: number | null
}

const PRESUPUESTO = 50
const FRESCO_MS = 15 * 60 * 1000

/**
 * Una pasada de reconciliación.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA SUTILEZA QUE DECIDE SI ESTO ARREGLA O ROMPE
 *
 * `vigenteDesde` se toma ANTES de pedir, no cuando llega la respuesta.
 *
 * La respuesta del Core refleja el estado en algún instante entre que se envió
 * la petición y que se recibió. Sellándola con la hora de LLEGADA, un cambio
 * ocurrido durante ese vuelo quedaría marcado como más viejo que la copia, y su
 * webhook —que trae el `occurredAt` real— se descartaría por «evento viejo».
 * Resultado: un cambio real perdido, sin error, por haber intentado arreglar la
 * copia.
 *
 * Con la hora de ENVÍO, el peor caso es volver a aplicar un evento que ya
 * estaba: inofensivo, porque el dato es el mismo. Se elige el fallo que no
 * pierde nada.
 */
export async function reconciliar(
  membego: MembegoClient,
  almacen: AlmacenReconciliacion,
  opciones: OpcionesReconciliacion = {}
): Promise<ResumenReconciliacion> {
  const presupuesto = opciones.presupuesto ?? PRESUPUESTO
  const frescoMs = opciones.frescoMs ?? FRESCO_MS
  const ahora = opciones.ahora ?? (() => new Date())

  const resumen: ResumenReconciliacion = {
    revisadas: 0,
    actualizadas: 0,
    sinCambios: 0,
    olvidadas: 0,
    fallidas: 0,
    desfaseMaximoPendiente: null,
  }

  // Se pide una más que el presupuesto para poder mirar la primera que se queda
  // fuera. Sin ella no habría forma de saber si la tarea va sobrada o si lleva
  // días sin dar la vuelta — y esa es la única señal de que el presupuesto se
  // quedó corto.
  const candidatas = await almacen.masViejas(presupuesto + 1)
  const t0 = ahora().getTime()
  const aRevisar = candidatas.filter((c) => t0 - c.vigenteDesde.getTime() >= frescoMs)

  const lote = aRevisar.slice(0, presupuesto)
  const sobrante = aRevisar[presupuesto]
  resumen.desfaseMaximoPendiente = sobrante ? t0 - sobrante.vigenteDesde.getTime() : null

  for (const fila of lote) {
    resumen.revisadas++

    // ANTES de pedir. Ver el comentario de arriba.
    const selloLectura = ahora()

    try {
      const cliente = await membego.customer(fila.companyId, fila.customerId)

      // Se compara para poder distinguir «revisadas» de «cambiadas». Sin la
      // comparación, el resumen diría que arregló cincuenta copias cuando en
      // realidad estaban las cincuenta bien, y no habría forma de notar que los
      // webhooks se están perdiendo.
      const vigente = await almacen.vigenciaDe(fila.customerId)

      await almacen.guardar({
        customerId: fila.customerId,
        companyId: fila.companyId,
        // Los nombres del DTO son los del contrato, en español: `nombre`,
        // `telefono`, `email`. Aquí se escribió `name`/`phone` por costumbre y
        // `tsc` lo paró — el Core de mentira del script de verificación decía
        // lo mismo que la suposición, así que las 22 comprobaciones pasaron con
        // el campo equivocado. Un doble escrito por quien se equivoca le da la
        // razón; el contrato, no.
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email || null,
        // Nunca hacia atrás: si mientras se pedía llegó un webhook más nuevo,
        // retroceder el sello volvería a abrir la puerta a que un evento viejo
        // lo pise.
        vigenteDesde: vigente && vigente > selloLectura ? vigente : selloLectura,
      })

      resumen.actualizadas++
    } catch (e) {
      // 404: en el Core ya no está. Conservar la copia sería enseñar a un
      // cliente que no existe, y quedaría atascada al frente de la cola de
      // reconciliación para siempre, gastando presupuesto en cada pasada.
      if (e instanceof MembegoError && e.status === 404) {
        await almacen.olvidar(fila.customerId)
        resumen.olvidadas++
        continue
      }
      // Cualquier otro fallo NO borra ni marca nada: un 500 del Core o un corte
      // de red no significan que el cliente no exista. Se deja como está y se
      // vuelve a intentar en la siguiente pasada — sigue siendo de las más
      // viejas, así que sale otra vez.
      resumen.fallidas++
    }
  }

  resumen.sinCambios = resumen.revisadas - resumen.actualizadas - resumen.olvidadas - resumen.fallidas
  return resumen
}

/**
 * ¿Está la reconciliación dando la vuelta, o se está quedando atrás?
 *
 * Una tarea que corre cada hora y no llega a revisar lo de hace tres días está
 * «funcionando» —no falla, no da error— y no sirve para nada. Esto convierte
 * eso en una comprobación que se puede vigilar.
 *
 * No corrige el presupuesto sola: subirlo es una decisión sobre cuánta carga
 * aguanta el Core, y la toma quien opera, no esta función.
 */
export function seEstaQuedandoAtras(
  resumen: ResumenReconciliacion,
  toleranciaMs = 24 * 60 * 60 * 1000
): boolean {
  return (resumen.desfaseMaximoPendiente ?? 0) > toleranciaMs
}
