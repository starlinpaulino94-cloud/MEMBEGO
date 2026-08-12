import type { Cerrojo } from './tarea-reconciliar'

/**
 * CERROJO POR ARRENDAMIENTO, contra la base propia del satélite.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO NO ES, Y POR QUÉ
 *
 * No es `pg_try_advisory_lock`. Ese fue el primer intento y está mal aquí: los
 * advisory locks son de la SESIÓN de PostgreSQL y Prisma habla por un pool, así
 * que `intentar()` puede tomarlo en una conexión y `soltar()` ejecutarse en
 * otra. El unlock no haría nada, la conexión volvería al pool con el cerrojo
 * puesto y la tarea quedaría muerta para siempre — anunciando «otra pasada en
 * curso», que parece que está trabajando.
 *
 * Tampoco es un cerrojo en memoria: un satélite puede correr en varias
 * instancias y esas se solapan igual mientras el cerrojo aparenta funcionar.
 *
 * Es una FILA con vencimiento. Sobrevive al pool, la ven todas las instancias, y
 * si el proceso se muere a mitad de pasada el arrendamiento vence solo.
 */

/** Lo que hace falta de la base. Dos operaciones, las dos atómicas. */
export interface TablaCerrojos {
  /**
   * Toma el cerrojo si está libre o vencido. DEBE ser una sola sentencia
   * condicional (`UPDATE ... WHERE expiraEn < ahora`): leer y luego escribir
   * deja dos procesos entrando a la vez por la ventana de en medio, que es
   * exactamente lo que un cerrojo existe para cerrar.
   */
  tomar(nombre: string, quien: string, expiraEn: Date): Promise<boolean>
  /** Suelta SOLO si `quien` sigue siendo el dueño. */
  soltar(nombre: string, quien: string): Promise<void>
}

export interface OpcionesCerrojo {
  nombre?: string
  /**
   * Cuánto dura el arrendamiento. Mayor que lo que tarda una pasada —si no, se
   * lo lleva otro mientras la primera sigue trabajando— y menor que lo que se
   * está dispuesto a estar sin reconciliar si un proceso muere.
   */
  duracionMs?: number
  quien?: string
  ahora?: () => Date
}

export function cerrojoArrendado(
  tabla: TablaCerrojos,
  opciones: OpcionesCerrojo = {}
): Cerrojo {
  const nombre = opciones.nombre ?? 'reconciliacion'
  const duracion = opciones.duracionMs ?? 10 * 60 * 1000
  // Identifica a ESTE proceso. Con un valor fijo, dos instancias se soltarían
  // el cerrojo la una a la otra creyendo que es suyo.
  const quien =
    opciones.quien ?? `${process.pid}-${Math.random().toString(36).slice(2, 10)}`
  const ahora = opciones.ahora ?? (() => new Date())

  return {
    async intentar() {
      return tabla.tomar(nombre, quien, new Date(ahora().getTime() + duracion))
    },
    async soltar() {
      await tabla.soltar(nombre, quien)
    },
  }
}
