import 'server-only'
import { publicar, qstashConfigurado } from '@/lib/jobs/qstash'
import { anotarFallo } from '@/lib/prisma-errors'
import { RUTA_TRABAJOS, RUTA_TRABAJOS_MUERTOS, type CargaReintentoEntrega } from '@/modules/jobs/tipos'
import { claveDedup } from '@/modules/jobs/cola'
import { proximoIntentoTras } from '@/modules/integraciones/reintentos'

/**
 * PROGRAMAR EL SIGUIENTE INTENTO de una entrega que acaba de fallar.
 *
 * Las dos colas de salida —satélites (`eventos_salientes`) y webhooks de
 * empresa (`entregas_webhook`)— llaman aquí desde el MISMO sitio en el que
 * anotan el fallo. Que sea el mismo sitio es lo que garantiza que no exista una
 * entrega fallida sin su reintento programado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO USA `encolar()`
 *
 * `encolar()` es el patrón de la casa y aquí sería un error grave. Cuando
 * QStash no está configurado, `encolar()` DEGRADA A EJECUTAR EN LÍNEA — y un
 * reintento ejecutado en línea es, palabra por palabra, lo contrario de lo que
 * se le pide:
 *
 *   1. se ejecutaría AHORA, sin la espera que da sentido a toda la escalera;
 *   2. ese intento volvería a fallar (el receptor sigue caído hace un
 *      milisegundo), anotaría el fallo, y anotar el fallo volvería a programar…
 *      dentro del mismo request. Una recursión que se come los ocho intentos y
 *      el presupuesto de la función en el mismo segundo.
 *
 * Así que aquí se publica DIRECTAMENTE, y si no hay cola no pasa nada: la fila
 * conserva su `proximoIntentoAt` y el cron diario la recoge. Es exactamente el
 * comportamiento de antes de esta fase — el peor caso de la versión nueva es el
 * caso normal de la vieja.
 */

export type ColaSalida = CargaReintentoEntrega['cola']

export interface ResultadoProgramacion {
  /** Cuándo toca el siguiente intento. Null = la entrega está muerta. */
  fecha: Date | null
  /** ¿Quedó en la cola? False = lo recogerá el cron. */
  encolado: boolean
}

/**
 * Calcula cuándo toca el siguiente intento y lo deja en la cola.
 *
 * NO escribe en la base: devuelve la fecha para que quien llama la guarde en el
 * MISMO `update` en el que anota el fallo. Dos escrituras separadas sobre la
 * misma fila abrirían una ventana en la que la entrega está fallada y no tiene
 * cuándo — y es justo la ventana en la que el cron la vería «vencida» y la
 * atendería a destiempo.
 */
export async function programarReintento(input: {
  cola: ColaSalida
  entregaId: string
  companyId: string
  /** Intentos YA hechos, contando el que acaba de fallar. */
  intentos: number
  ahora?: Date
}): Promise<ResultadoProgramacion> {
  const proximo = proximoIntentoTras(input.intentos, input.entregaId, input.ahora ?? new Date())
  if (!proximo) return { fecha: null, encolado: false }

  if (!qstashConfigurado()) return { fecha: proximo.fecha, encolado: false }

  const carga: CargaReintentoEntrega = {
    tipo: 'reintento-entrega',
    cola: input.cola,
    entregaId: input.entregaId,
    intentos: input.intentos,
    companyId: input.companyId,
  }

  const ok = await publicar(RUTA_TRABAJOS, carga, {
    retrasoS: proximo.esperaS,
    deduplicationId: claveDedup(carga),
    // UNO, y no los tres de `encolar()`. Si nuestro endpoint devuelve 500 al
    // ejecutar el reintento, la entrega ya quedó anotada y con su PRÓXIMO
    // intento programado: insistir sobre el mismo trabajo sería un intento
    // extra que nadie contó. Uno cubre el fallo transitorio de red al
    // entregarnos el mensaje, que es lo único que aquí merece reintento.
    reintentos: 1,
    rutaFallo: RUTA_TRABAJOS_MUERTOS,
  }).catch(() => false)

  if (!ok) {
    // No es un fallo del que haya que rescatar nada: la fila guarda la fecha y
    // el cron barre. Se anota porque «cuántos reintentos no llegaron a la cola»
    // es la señal de que QStash está mal configurado, y sin ella la única
    // pista sería que los eventos tardan más de lo que dice la documentación.
    import('@/modules/observabilidad/eventos')
      .then(({ registrarEvento }) =>
        registrarEvento({
          dominio: 'cola',
          accion: 'degradacion',
          ok: false,
          motivo: 'reintento_no_encolado',
          companyId: input.companyId,
          extra: { cola: input.cola, intentos: input.intentos },
        })
      )
      .catch(anotarFallo('integraciones:programar-reintento', { id: input.entregaId }))
  }

  return { fecha: proximo.fecha, encolado: ok }
}
