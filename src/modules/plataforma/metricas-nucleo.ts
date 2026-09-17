/**
 * PLATAFORMA · MÉTRICAS DE USO POR CREDENCIAL (B-7) — NÚCLEO PURO.
 *
 * Lo que decide QUÉ se cuenta y CÓMO se resume, sin Prisma ni red, para poder
 * probarlo caso por caso. La parte que habla con la base vive en `metricas.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS REGLAS QUE NO SE PUEDEN AFLOJAR
 *
 *  · El endpoint se NORMALIZA antes de guardarse: `/customers/cus_abc` pasa a
 *    `/customers/{id}`. Sin esto, la tabla tendría una fila por cada cliente
 *    consultado —cardinalidad sin techo— y, peor, un id de cliente acabaría en
 *    una tabla de telemetría. Las dos cosas se arreglan en el mismo sitio.
 *
 *  · El resultado es el desenlace en el borde de autenticación, no el cuerpo de
 *    la respuesta. Una petición que no se puede atribuir a una credencial
 *    concreta (token inválido, límite) no llega a contarse: no se puede medir el
 *    uso de una credencial que no se identificó.
 */

/** Prefijo común de todas las rutas de la API pública. Se recorta al normalizar. */
export const PREFIJO_RUTA = '/api/platform/v1'

/** Tope de longitud del endpoint guardado. Una ruta rarísima no infla la tabla. */
export const MAX_ENDPOINT = 120

/**
 * Desenlace de una petición, visto desde la autenticación.
 *
 *  · OK    — autenticada y con el scope que la ruta pedía.
 *  · SCOPE — credencial válida pero sin el permiso: la señal de una integración
 *            mal configurada, y la más útil de «tasa de error por credencial».
 */
export const RESULTADO = { OK: 'OK', SCOPE: 'SCOPE' } as const
export type Resultado = (typeof RESULTADO)[keyof typeof RESULTADO]

/** Qué resultados cuentan como error al calcular la tasa. */
export const RESULTADOS_ERROR: readonly string[] = [RESULTADO.SCOPE]

export function esError(resultado: string): boolean {
  return RESULTADOS_ERROR.includes(resultado)
}

/**
 * ¿Este segmento de la ruta es un IDENTIFICADOR y no un nombre de recurso?
 *
 * Los nombres de recurso son palabras en minúscula con guiones y cortas
 * (`customers`, `vehicle-types`, `resolve`). Cualquier otra cosa —un cuid, un
 * uuid, un `cus_123`, algo con dígitos o largo— es un id, y se reemplaza. La
 * regla es «lo que NO parece un nombre de recurso» para que un id nuevo no se
 * cuele por no haberlo previsto: el defecto seguro es tratarlo como id.
 */
export function pareceId(segmento: string): boolean {
  return !/^[a-z][a-z-]{0,17}$/.test(segmento)
}

/**
 * Ruta sin el prefijo y con los ids sustituidos por `{id}`.
 *
 * Ejemplos: `/api/platform/v1/customers` → `/customers`;
 * `/api/platform/v1/customers/cus_abc` → `/customers/{id}`.
 */
export function normalizarEndpoint(pathname: string): string {
  let p = (pathname || '').split('?')[0]
  if (p.startsWith(PREFIJO_RUTA)) p = p.slice(PREFIJO_RUTA.length)
  const segmentos = p
    .split('/')
    .filter(Boolean)
    .map((s) => (pareceId(s) ? '{id}' : s))
  const ruta = '/' + segmentos.join('/')
  return ruta.slice(0, MAX_ENDPOINT)
}

/** Medianoche UTC del día de una fecha — la clave temporal del agregado. */
export function inicioDelDiaUTC(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()))
}

/**
 * El primer día de una ventana de `dias` que termina hoy, a medianoche UTC.
 * `dias = 1` es solo hoy; `dias = 30`, los últimos treinta días incluido hoy.
 */
export function inicioDeVentana(dias: number, ahora: Date): Date {
  const hoy = inicioDelDiaUTC(ahora)
  const n = Math.max(1, Math.floor(dias))
  return new Date(hoy.getTime() - (n - 1) * 86_400_000)
}

// ── Resumen de uso ───────────────────────────────────────────────────────────

/** Una fila cruda del agregado, tal como la lee la base. */
export interface FilaMetrica {
  dia: string
  endpoint: string
  metodo: string
  resultado: string
  peticiones: number
}

export interface UsoPorEndpoint {
  endpoint: string
  metodo: string
  peticiones: number
  errores: number
}

export interface UsoPorDia {
  dia: string
  peticiones: number
  errores: number
}

export interface ResumenUso {
  total: number
  errores: number
  /** Fracción 0..1. Cero cuando no hubo ninguna petición (no NaN). */
  tasaError: number
  porEndpoint: UsoPorEndpoint[]
  porDia: UsoPorDia[]
}

/**
 * Resume una lista de filas del agregado en los números que una pantalla enseña:
 * total, errores, tasa, y los cortes por endpoint (de más a menos usado) y por
 * día (en orden). Puro: recibe filas, devuelve un objeto, no toca nada.
 */
export function resumirUso(filas: readonly FilaMetrica[]): ResumenUso {
  let total = 0
  let errores = 0
  const porEndpoint = new Map<string, UsoPorEndpoint>()
  const porDia = new Map<string, UsoPorDia>()

  for (const f of filas) {
    const n = f.peticiones
    const err = esError(f.resultado) ? n : 0
    total += n
    errores += err

    const claveEp = `${f.metodo} ${f.endpoint}`
    const ep = porEndpoint.get(claveEp) ?? { endpoint: f.endpoint, metodo: f.metodo, peticiones: 0, errores: 0 }
    ep.peticiones += n
    ep.errores += err
    porEndpoint.set(claveEp, ep)

    const dia = porDia.get(f.dia) ?? { dia: f.dia, peticiones: 0, errores: 0 }
    dia.peticiones += n
    dia.errores += err
    porDia.set(f.dia, dia)
  }

  return {
    total,
    errores,
    tasaError: total === 0 ? 0 : errores / total,
    porEndpoint: [...porEndpoint.values()].sort((a, b) => b.peticiones - a.peticiones),
    porDia: [...porDia.values()].sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0)),
  }
}
