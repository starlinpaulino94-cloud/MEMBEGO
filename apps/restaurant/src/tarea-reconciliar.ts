import type { MembegoClient } from '@membego/platform-sdk'
import {
  reconciliar,
  seEstaQuedandoAtras,
  type AlmacenReconciliacion,
  type OpcionesReconciliacion,
  type ResumenReconciliacion,
} from './reconciliacion'

/**
 * LA TAREA PROGRAMADA — lo que convierte `reconciliar()` en algo que de verdad
 * corrige la copia.
 *
 * Un barrido que nadie dispara corrige exactamente lo mismo que no tenerlo. Esto
 * es quien lo dispara, y añade las tres cosas que una pasada suelta no necesita
 * y una programada sí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 1 · NO SOLAPARSE
 *
 * Si una pasada tarda más que el intervalo, la siguiente arranca encima. Las dos
 * piden LAS MISMAS filas —las más viejas— y le meten al Core el doble de carga
 * que el presupuesto promete. Y no falla nada: las dos escriben el mismo dato.
 * El síntoma es que el Core recibe el doble de peticiones de las que nadie
 * autorizó, justo cuando la tarea ya iba lenta.
 *
 * El cerrojo está en la BASE y no en memoria: un satélite puede correr en varias
 * instancias, y un cerrojo en memoria las deja solaparse igual mientras aparenta
 * que no.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 2 · DECIR QUÉ HIZO
 *
 * `revisadas: 50, actualizadas: 50` significa que los webhooks se están
 * perdiendo todos. `revisadas: 50, sinCambios: 50` significa que van bien y esta
 * tarea es un seguro. Son situaciones opuestas y sin el desglose se ven iguales.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 3 · GRITAR CUANDO NO DA LA VUELTA
 *
 * Una tarea que corre cada hora y no llega a lo de hace tres días está
 * «funcionando» —termina, no da error, devuelve 200— y no sirve para nada. Es
 * el fallo más silencioso de los tres, y por eso es el único que se registra
 * como error.
 */

/**
 * Cerrojo entre pasadas. Lo implementa el satélite contra su base, no esta
 * función: aquí no se sabe qué hay debajo.
 *
 * La implementación está en `cerrojo.ts` y es un ARRENDAMIENTO, no un
 * `pg_try_advisory_lock` — ese fue el primer intento y está mal con un pool de
 * conexiones. El porqué, allí.
 */
export interface Cerrojo {
  /** `false` = otra pasada está corriendo. No se espera: se sale. */
  intentar(): Promise<boolean>
  soltar(): Promise<void>
}

export type ResultadoTarea =
  | { corrio: false; motivo: 'ya-en-curso' }
  | { corrio: true; resumen: ResumenReconciliacion; quedandoAtras: boolean }

export interface OpcionesTarea extends OpcionesReconciliacion {
  /** Por encima de esto se considera que la tarea no da la vuelta. */
  toleranciaMs?: number
  registrar?: (nivel: 'info' | 'error', mensaje: string) => void
}

// `console.warn` y no `console.log` para lo informativo: la regla del proyecto
// solo permite `warn` y `error`, y tiene razón — un `log` en un proceso de
// servidor se pierde en cuanto alguien filtra por nivel. Quien quiera otra cosa
// pasa su propio `registrar`.
const registroPorDefecto = (nivel: 'info' | 'error', mensaje: string) => {
  if (nivel === 'error') console.error(mensaje)
  else console.warn(mensaje)
}

export async function tareaReconciliar(
  membego: MembegoClient,
  almacen: AlmacenReconciliacion,
  cerrojo: Cerrojo,
  opciones: OpcionesTarea = {}
): Promise<ResultadoTarea> {
  const registrar = opciones.registrar ?? registroPorDefecto

  if (!(await cerrojo.intentar())) {
    // No es un error: es la señal de que la anterior sigue trabajando. Se
    // registra igual, porque si aparece en cada pasada el intervalo se quedó
    // corto y eso hay que verlo.
    registrar('info', '[reconciliación] otra pasada en curso, se salta esta')
    return { corrio: false, motivo: 'ya-en-curso' }
  }

  try {
    const resumen = await reconciliar(membego, almacen, opciones)
    const quedandoAtras = seEstaQuedandoAtras(resumen, opciones.toleranciaMs)

    registrar(
      'info',
      `[reconciliación] revisadas=${resumen.revisadas} actualizadas=${resumen.actualizadas} ` +
        `sinCambios=${resumen.sinCambios} olvidadas=${resumen.olvidadas} fallidas=${resumen.fallidas}`
    )

    if (quedandoAtras) {
      const horas = Math.round((resumen.desfaseMaximoPendiente ?? 0) / 3600_000)
      registrar(
        'error',
        `[reconciliación] SE ESTÁ QUEDANDO ATRÁS: hay copias sin revisar de hace ${horas}h. ` +
          'La tarea termina bien y no está corrigiendo nada. Subir el presupuesto o el ritmo.'
      )
    }

    return { corrio: true, resumen, quedandoAtras }
  } finally {
    // SIEMPRE. Un cerrojo que no se suelta porque la pasada falló deja la tarea
    // muerta para siempre, y el síntoma —«otra pasada en curso»— parece que
    // está trabajando.
    await cerrojo.soltar()
  }
}
