import type { DefinicionProveedor, PasoConexion } from '@/modules/connect/proveedores/tipos'

/**
 * EL ALTA GUIADA · núcleo puro (Connect · Fase 12).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA DECISIÓN QUE SOSTIENE TODO EL ASISTENTE
 *
 * El paso actual NO se guarda: SE DEDUCE de lo que ya está cumplido.
 *
 * Guardar un cursor («voy por el paso 2») parece lo natural y es una trampa.
 * El paso de autorización SE VA DEL NAVEGADOR: el usuario acaba en Google y
 * vuelve en una petición nueva, que puede ser otra pestaña, otro día u otro
 * dispositivo. Con un cursor guardado hay que acordarse de moverlo en cada
 * uno de esos caminos —y el que se olvide deja al usuario en un paso que ya
 * hizo, o peor, en uno que no puede hacer todavía.
 *
 * Deduciéndolo, el estado no puede desincronizarse: el primer paso cuyo
 * requisito no se cumple ES el paso actual, se llegue por donde se llegue.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * setupState NO ES CONFIGURACIÓN (regla A de la decisión 2)
 *
 * Aquí solo vive lo TEMPORAL del alta: qué se ha contestado hasta ahora y con
 * qué versión del guion se empezó. La configuración operativa —el calendario
 * elegido, las opciones de sincronización— se escribe en `config` al TERMINAR,
 * y entonces `setupState` se borra (regla B).
 *
 * Mezclarlos tendría una consecuencia concreta y fea: el día que alguien
 * escriba «borra el progreso del asistente», borraría también el calendario
 * elegido.
 */

/** Lo que se guarda mientras dura el alta. Nada de esto sobrevive al final. */
export interface EstadoAlta {
  /** Respuestas dadas hasta ahora, por id de paso. */
  datos: Record<string, unknown>
  /** Con qué `versionAlta` se empezó, para saber si el guion cambió por debajo. */
  version: number
  /** Cuándo empezó, en ISO. Lo que permite reconocer un alta abandonada. */
  iniciadoEn: string
}

export function altaVacia(version: number, ahora = new Date()): EstadoAlta {
  return { datos: {}, version, iniciadoEn: ahora.toISOString() }
}

/**
 * Lee un `setupState` que viene de la base (Json, sin garantías de forma).
 * Devuelve null ante cualquier cosa rara: un alta con un estado corrupto se
 * reinicia, que es preferible a arrastrar basura por el asistente.
 */
export function leerEstadoAlta(bruto: unknown): EstadoAlta | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const o = bruto as Record<string, unknown>
  if (typeof o.version !== 'number' || typeof o.iniciadoEn !== 'string') return null
  const datos = o.datos
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return null
  return { datos: datos as Record<string, unknown>, version: o.version, iniciadoEn: o.iniciadoEn }
}

/**
 * HECHOS del mundo que el asistente no puede deducir de sus propias respuestas.
 * Se los pasa quien llama, porque viven en la base o en el proveedor.
 */
export interface HechosAlta {
  /** ¿Hay credencial guardada? Es lo que dice si la autorización se completó. */
  autorizado: boolean
  /** ¿La última validación pasó? */
  validado: boolean
}

/**
 * ¿Está cumplido este paso? Un paso se da por hecho por lo que HAY, no por lo
 * que alguien apuntó que hizo.
 */
export function pasoCumplido(
  paso: PasoConexion,
  estado: EstadoAlta,
  hechos: HechosAlta
): boolean {
  // Un paso puede declarar que lo suyo se demuestra con un HECHO y no con una
  // respuesta guardada. Es lo que permite que el token de WhatsApp vaya
  // directo a la credencial sellada sin pasar por `setupState`.
  if (paso.cumpleCon === 'autorizado') return hechos.autorizado
  if (paso.cumpleCon === 'validado') return hechos.validado

  switch (paso.tipo) {
    // Informar no se «cumple»: se lee y se sigue. Cuenta como hecho en cuanto
    // el alta arranca, para no dejar al usuario atascado en una pantalla que
    // solo dice cosas.
    case 'INFORMATIVO':
      return estado.datos[paso.id] === true
    case 'AUTORIZACION':
      return hechos.autorizado
    case 'VALIDACION':
      return hechos.validado
    // ELECCION, FORMULARIO y COMPONENTE se cumplen contestándolos.
    default:
      return estado.datos[paso.id] !== undefined
  }
}

/**
 * EL PASO ACTUAL: el primero sin cumplir. Null = no queda ninguno, el alta
 * está lista para cerrarse.
 */
export function pasoActual(
  def: DefinicionProveedor,
  estado: EstadoAlta,
  hechos: HechosAlta
): PasoConexion | null {
  return def.pasos.find((p) => !pasoCumplido(p, estado, hechos)) ?? null
}

/** ¿Se contestó todo? */
export function altaCompleta(
  def: DefinicionProveedor,
  estado: EstadoAlta,
  hechos: HechosAlta
): boolean {
  return pasoActual(def, estado, hechos) === null
}

export interface Progreso {
  /** 1-based, para enseñar «Paso 2 de 4». */
  numero: number
  total: number
  /** 0..1 */
  fraccion: number
}

export function progreso(
  def: DefinicionProveedor,
  estado: EstadoAlta,
  hechos: HechosAlta
): Progreso {
  const total = def.pasos.length
  const actual = pasoActual(def, estado, hechos)
  const indice = actual ? def.pasos.findIndex((p) => p.id === actual.id) : total
  return {
    numero: Math.min(indice + 1, total),
    total,
    fraccion: total === 0 ? 1 : indice / total,
  }
}

/**
 * A QUÉ PASO SE PUEDE VOLVER.
 *
 * Solo hacia atrás, y NUNCA antes de la autorización: una vez que existe una
 * credencial guardada, «volver» a la pantalla de autorizar no desharía nada —
 * enseñaría un botón de conectar sobre una cuenta ya conectada. Deshacer eso
 * es desconectar, que es otra acción y tiene su propia confirmación.
 */
export function pasosVisitables(
  def: DefinicionProveedor,
  estado: EstadoAlta,
  hechos: HechosAlta
): PasoConexion[] {
  const actual = pasoActual(def, estado, hechos)
  const hasta = actual ? def.pasos.findIndex((p) => p.id === actual.id) : def.pasos.length
  const ultimaAutorizacion = def.pasos.reduce(
    (acc, p, i) => (p.tipo === 'AUTORIZACION' && hechos.autorizado ? i : acc),
    -1
  )
  return def.pasos.slice(ultimaAutorizacion + 1, hasta + 1)
}

/** Guarda la respuesta de un paso. Puro: devuelve un estado nuevo. */
export function conRespuesta(estado: EstadoAlta, pasoId: string, valor: unknown): EstadoAlta {
  return { ...estado, datos: { ...estado.datos, [pasoId]: valor } }
}

/**
 * ¿Este alta se quedó a medias hace mucho? Sirve para reconocerla como
 * abandonada SIN tocar la conexión: la fila sigue igual, solo se sabe leer.
 */
export const DIAS_ALTA_ABANDONADA = 7

export function altaAbandonada(estado: EstadoAlta, ahora = new Date()): boolean {
  const inicio = Date.parse(estado.iniciadoEn)
  if (Number.isNaN(inicio)) return false
  return ahora.getTime() - inicio > DIAS_ALTA_ABANDONADA * 24 * 60 * 60 * 1000
}

/**
 * ¿El guion cambió por debajo mientras esta empresa lo rellenaba? Si la
 * versión con la que empezó no es la de hoy, sus respuestas pueden no
 * corresponder a los pasos actuales y el alta se reinicia.
 */
export function guionCaducado(def: DefinicionProveedor, estado: EstadoAlta): boolean {
  return estado.version !== def.versionAlta
}
