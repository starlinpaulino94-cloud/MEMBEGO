/**
 * NÚCLEO PURO de la concurrencia acotada de las colas de salida (hallazgo A-6).
 *
 * Sin Prisma, sin red, sin `server-only`: decide CUÁNTAS entregas se intentan a
 * la vez y CUÁNDO hay que parar, y las dos cosas se prueban.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTABA MAL
 *
 * Las cuatro rutas de salida recorrían su lista con un `for` y un `await`
 * dentro: cada entrega esperaba a que la anterior terminara o agotara sus diez
 * segundos de timeout. Eso tiene dos consecuencias de tamaños muy distintos.
 *
 * En el FAN-OUT es una molestia: cinco suscripciones lentas dejan el worker del
 * bus ocupado cincuenta segundos en una sola operación de negocio.
 *
 * En el BARRIDO es un fallo. El cron toma hasta cien filas y tiene sesenta
 * segundos de presupuesto (`maxDuration`). Con un receptor caído, cada fila
 * cuesta diez segundos: procesa unas seis y la plataforma mata la función. Las
 * noventa y cuatro restantes no se intentan, no aparece ningún error, y al día
 * siguiente vuelve a pasar exactamente lo mismo con las mismas seis primeras.
 * Una cola que solo drena su primer 6 % está atascada y parece que funciona.
 */

/**
 * Cuántas entregas salen a la vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SEIS Y NO SESENTA
 *
 * Esto no es un pool de trabajos independientes. En un barrido, muchas de las
 * filas pendientes apuntan AL MISMO servidor — están pendientes precisamente
 * porque ese servidor está mal—, así que el límite no reparte carga entre
 * destinos: se la concentra en uno. Un número alto convertiría nuestro reintento
 * en una avalancha contra alguien que ya está caído, y encima justo cuando
 * intenta levantarse.
 *
 * Seis convierte una espera en serie en una paralela (es la diferencia entre
 * seis filas por minuto y sesenta) sin parecer un ataque desde el otro lado.
 */
export const CONCURRENCIA = 6

export interface OpcionesParalelo {
  /**
   * Se pregunta ANTES de empezar cada elemento. Al devolver `false` no se toman
   * más, y los que ya estaban en vuelo terminan.
   *
   * Es lo que permite respetar el presupuesto de una función serverless: en vez
   * de que la plataforma mate el proceso a mitad de una entrega —dejando la
   * fila escrita a medias y sin saber qué pasó—, el barrido deja de tomar
   * trabajo y devuelve cuántas quedaron. Parar a tiempo y decirlo es
   * infinitamente mejor que que te corten.
   */
  continuar?: () => boolean
}

export interface ResultadoParalelo<R> {
  /** Lo devuelto por cada elemento que SÍ se procesó, en orden de entrada. */
  resultados: R[]
  /** Cuántos se quedaron sin empezar porque `continuar` dijo que no. */
  sinEmpezar: number
}

/**
 * Recorre `items` con como mucho `limite` en vuelo a la vez.
 *
 * NO usa `Promise.all` sobre trozos («lotes»): un lote de seis en el que cinco
 * responden en 50 ms y uno agota diez segundos deja cinco huecos parados
 * esperando al lento. Aquí cada trabajador toma el siguiente en cuanto acaba el
 * suyo, así que el único que espera es el que le toca.
 *
 * `fn` NO debe lanzar: quien llama ya envuelve cada entrega en su propio
 * manejo de errores, y un rechazo aquí abortaría a los demás trabajadores. Si
 * lanzara, el error sale por donde entró — no se traga en silencio.
 */
export async function enParalelo<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>,
  opciones: OpcionesParalelo = {}
): Promise<ResultadoParalelo<R>> {
  const resultados = new Array<R>(items.length)
  const procesado = new Array<boolean>(items.length).fill(false)
  let siguiente = 0
  let parado = false

  const trabajador = async () => {
    for (;;) {
      if (opciones.continuar && !opciones.continuar()) {
        parado = true
        return
      }
      const i = siguiente++
      if (i >= items.length) return
      resultados[i] = await fn(items[i], i)
      procesado[i] = true
    }
  }

  const trabajadores = Math.max(1, Math.min(limite, items.length))
  await Promise.all(Array.from({ length: trabajadores }, trabajador))

  // Se compacta por lo REALMENTE procesado y no por `siguiente`: al parar, los
  // índices que un trabajador reservó y otro no llegó a empezar quedarían como
  // huecos vacíos en medio del array.
  const hechos = resultados.filter((_, i) => procesado[i])
  return {
    resultados: hechos,
    sinEmpezar: parado ? items.length - hechos.length : 0,
  }
}

/**
 * Un `continuar` que respeta un presupuesto de tiempo.
 *
 * `margenMs` es lo que se reserva para terminar lo que esté en vuelo y escribir
 * su resultado. Sin ese margen, el barrido tomaría trabajo hasta el último
 * milisegundo y la plataforma lo mataría en mitad de una escritura — que es
 * justo el estado del que cuesta salir: una fila marcada a medias.
 */
export function antesDe(
  presupuestoMs: number,
  margenMs: number,
  ahora: () => number = Date.now
): () => boolean {
  const fin = ahora() + presupuestoMs - margenMs
  return () => ahora() < fin
}
