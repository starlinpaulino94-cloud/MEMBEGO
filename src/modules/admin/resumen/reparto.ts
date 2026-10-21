/**
 * REPARTO DE LAS CONSULTAS DEL RESUMEN EN TRANSACCIONES PARALELAS (auditoría admin · fase 5, tarea 5.1).
 *
 * Una transacción de Prisma usa UNA conexión y ejecuta las sentencias una tras otra, aunque se las lance con `Promise.all`.
 * Con todo el Resumen en una sola, las 15 consultas se ponían en fila: medido contra la base de QA (≈ 0,3 s por viaje), la
 * cabecera tardaba 5,5 s en pintarse frente a los 2 s del diseño anterior, que abría una transacción por consulta. Menos
 * sentencias no es menos espera si se serializan.
 *
 * El reparto es el término medio: las consultas se reparten entre unas pocas transacciones (`GRUPOS`) que corren a la vez.
 * El tiempo de pared pasa a ser el del grupo más cargado y no el de la suma, y cada transacción sigue costando sus tres viajes de
 * control (BEGIN, `set_config` de la empresa, COMMIT), por eso no se abre una por consulta. Es una función pura para poder
 * probar que cada tarea cae en un grupo y solo en uno, y que el reparto no depende del azar.
 */

export interface TareaConPeso<T> {
  /** Cuántas sentencias hace: ordena el reparto, no el resultado. */
  peso: number
  correr: T
}

/** Cuántas transacciones corren a la vez como máximo: no agota el pool de conexiones y recorta casi todo lo serializable. */
export const GRUPOS = 5

/**
 * Reparto voraz: la tarea más pesada primero, siempre al grupo con menos carga. Estable ante empates (mantiene el orden de
 * llegada), de modo que el mismo conjunto de tareas da siempre los mismos grupos.
 */
export function repartir<T>(tareas: readonly TareaConPeso<T>[], grupos = GRUPOS): TareaConPeso<T>[][] {
  const filas = Array.from({ length: Math.max(0, Math.min(grupos, tareas.length)) }, () => ({ carga: 0, tareas: [] as TareaConPeso<T>[] }))
  const ordenadas = tareas.map((t, i) => ({ t, i })).sort((a, b) => b.t.peso - a.t.peso || a.i - b.i)
  for (const { t } of ordenadas) {
    let destino = filas[0]!
    for (const f of filas) if (f.carga < destino.carga) destino = f
    destino.tareas.push(t)
    destino.carga += t.peso
  }
  return filas.map((f) => f.tareas)
}
