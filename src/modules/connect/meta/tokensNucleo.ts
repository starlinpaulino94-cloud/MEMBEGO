/**
 * TOKENS DE META · reglas puras (Fase 1). Sin red: lo que se puede decidir
 * mirando una respuesta de `debug_token` se decide aquí y se prueba con
 * respuestas de ejemplo.
 */

export interface InspeccionToken {
  valido: boolean
  appId: string | null
  /** Null = no caduca (tokens de negocio y de Página de larga duración). */
  caducaAt: Date | null
  /** Cuándo caduca el ACCESO A DATOS (90 días en Facebook Login), aunque el token viva. */
  accesoDatosCaducaAt: Date | null
  permisos: string[]
  /** Por permiso, sobre qué cuentas/activos concretos se concedió. */
  concesiones: { permiso: string; ids: string[] }[]
}

function fecha(v: unknown): Date | null {
  // Meta manda segundos UNIX; 0 significa «no caduca».
  return typeof v === 'number' && v > 0 ? new Date(v * 1000) : null
}

/** Lee `data` de `GET /debug_token`. Lo que no venga, no se inventa. */
export function leerInspeccion(json: unknown): InspeccionToken {
  const data =
    json && typeof json === 'object' && 'data' in json && (json as { data?: unknown }).data
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const granular = Array.isArray(d.granular_scopes) ? d.granular_scopes : []
  return {
    valido: d.is_valid === true,
    appId: typeof d.app_id === 'string' ? d.app_id : null,
    caducaAt: fecha(d.expires_at),
    accesoDatosCaducaAt: fecha(d.data_access_expires_at),
    permisos: Array.isArray(d.scopes) ? d.scopes.filter((s): s is string => typeof s === 'string') : [],
    concesiones: granular
      .filter((g): g is { scope: string; target_ids?: unknown } =>
        Boolean(g) && typeof g === 'object' && typeof (g as { scope?: unknown }).scope === 'string'
      )
      .map((g) => ({
        permiso: g.scope,
        ids: Array.isArray(g.target_ids) ? g.target_ids.filter((x): x is string => typeof x === 'string') : [],
      })),
  }
}

/** Margen antes de la caducidad a partir del cual se pide reconectar. */
export const MARGEN_REAUTORIZAR_MS = 7 * 24 * 60 * 60 * 1000

/**
 * ¿Hay que pedir a la empresa que vuelva a autorizar? Sí cuando el token no
 * vale, cuando caduca en menos de una semana, o cuando el acceso a datos
 * caduca en menos de una semana — Facebook Login no ofrece refresco de
 * servidor: la única salida es volver a pasar por el diálogo.
 */
export function pideReautorizar(i: InspeccionToken, ahora = Date.now()): boolean {
  if (!i.valido) return true
  const limite = ahora + MARGEN_REAUTORIZAR_MS
  if (i.caducaAt && i.caducaAt.getTime() <= limite) return true
  if (i.accesoDatosCaducaAt && i.accesoDatosCaducaAt.getTime() <= limite) return true
  return false
}

/** ¿Concedió TODOS los permisos que se le pidieron? */
export function faltanPermisos(i: InspeccionToken, pedidos: readonly string[]): string[] {
  return pedidos.filter((p) => !i.permisos.includes(p))
}
