/**
 * Onboarding v2 · DOMINIO DEL VEHÍCULO (Fase 1 · puro, sin Prisma).
 *
 * La identidad futura del vehículo es `pais + placa normalizada`: es lo que
 * permitirá el unique en BD, la detección de duplicados y el reclamo de un
 * vehículo registrado por otra cuenta. TODA captura de placa —asistente de
 * registro, mostrador, importaciones— debe pasar por aquí, para que "A 123-456",
 * "a123456" y "A123456" sean el MISMO vehículo y no tres.
 *
 * REGLA DE COMPATIBILIDAD (grandfathering): estas validaciones aplican a
 * CAPTURAS NUEVAS. Los vehículos ya guardados sin placa —y los clientes sin
 * vehículo— siguen siendo válidos tal como están: ninguna función de este
 * módulo debe usarse para re-validar datos históricos ni para bloquear el uso
 * de una membresía ya comprada.
 *
 * `scripts/auditar-placas.mjs` duplica `normalizarPlaca` a propósito (debe
 * poder correr contra una BD vieja sin depender de este código); si la regla
 * cambia aquí, actualizar el script.
 */

/** País por defecto de la plataforma (República Dominicana). */
export const PAIS_PLACA_DEFECTO = 'DO'

/** Antigüedad máxima razonable de un vehículo en circulación. */
const ANIO_MINIMO = 1950
/** Margen para modelos del año próximo (concesionarios venden por adelantado). */
const MARGEN_ANIO_NUEVO = 1

export interface ValidacionPlaca {
  ok: boolean
  /** Placa canónica (mayúsculas, solo A-Z0-9) — solo cuando ok. */
  normalizada?: string
  /** Mensaje apto para mostrar al cliente — solo cuando !ok. */
  error?: string
}

/**
 * Placa canónica: mayúsculas y solo [A-Z0-9]. Espacios, guiones y puntos son
 * decoración de cómo la gente escribe, no parte de la identidad.
 */
export function normalizarPlaca(placa: string | null | undefined): string {
  return (placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Valida el FORMATO de una placa para captura nueva. Deliberadamente
 * permisiva: entre placas viejas, de motor, provisionales y de otros países,
 * un formato estricto rechaza placas reales y bloquea registros legítimos. El
 * formato fino por país puede endurecerse aquí sin tocar a los llamadores.
 *
 * La UNICIDAD (¿ya existe esta placa?) no se decide aquí: eso es del backend
 * contra la BD, con su constraint. Aquí solo se decide si el texto es una
 * placa plausible.
 */
export function validarPlaca(
  placa: string | null | undefined,
  _pais: string = PAIS_PLACA_DEFECTO
): ValidacionPlaca {
  const normalizada = normalizarPlaca(placa)
  if (!normalizada) {
    return { ok: false, error: 'Escribe la placa del vehículo.' }
  }
  if (normalizada.length < 4) {
    return { ok: false, error: 'La placa es demasiado corta. Revísala.' }
  }
  if (normalizada.length > 10) {
    return { ok: false, error: 'La placa es demasiado larga. Revísala.' }
  }
  if (!/\d/.test(normalizada)) {
    return { ok: false, error: 'Una placa incluye números. Revísala.' }
  }
  return { ok: true, normalizada }
}

export interface ValidacionAnio {
  ok: boolean
  anio?: number
  error?: string
}

/**
 * Año del vehículo: numérico, entero, entre 1950 y el año actual + 1 (los
 * modelos del año próximo se venden por adelantado).
 */
export function validarAnio(
  anioRaw: string | number | null | undefined,
  ahora: Date = new Date()
): ValidacionAnio {
  const texto = String(anioRaw ?? '').trim()
  if (!texto) return { ok: false, error: 'Indica el año del vehículo.' }
  const anio = Number(texto)
  if (!Number.isInteger(anio)) {
    return { ok: false, error: 'El año debe ser un número, por ejemplo 2022.' }
  }
  const maximo = ahora.getFullYear() + MARGEN_ANIO_NUEVO
  if (anio < ANIO_MINIMO || anio > maximo) {
    return { ok: false, error: `El año debe estar entre ${ANIO_MINIMO} y ${maximo}.` }
  }
  return { ok: true, anio }
}
