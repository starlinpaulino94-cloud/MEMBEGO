/**
 * ¿La llave de servicio de Supabase es de verdad una llave de SERVICIO?
 *
 * Lógica pura (sin I/O, sin `server-only`): la usan `createAdminClient`, el diagnóstico de administración y las pruebas.
 *
 * POR QUÉ EXISTE. Con `SUPABASE_SERVICE_ROLE_KEY` apuntando a una llave que NO es `service_role` (la `anon` pegada en el
 * sitio equivocado, una llave de otro proyecto), todo lo que usa la API de administración de usuarios responde
 * `403 not_admin — this token needs to have one of the following roles: supabase_admin, service_role`: crear cuentas,
 * invitaciones, restablecer contraseñas desde el panel, borrar cuentas, cambiar roles y reparar el `app_metadata` de una
 * sesión. Y falla SIN romper la aplicación: cada llamada lleva su `.catch`, así que el síntoma es una lista de cosas que
 * «no se guardan» y una línea suelta en un log que nadie lee. Pasó en producción (rechazos desde el 11-10-2026).
 *
 * Una llave de servicio en formato JWT lleva su rol en el cuerpo, que se puede leer sin verificar nada (no es un secreto
 * ni se comprueba la firma: solo se mira qué dice). El formato nuevo (`sb_secret_…`) no es un JWT y no se puede
 * inspeccionar, pero su prefijo ya dice si es de servidor o la pública.
 *
 * NUNCA devuelve ni registra la llave: solo su formato, su rol y el motivo.
 */

export type DiagnosticoLlaveServicio =
  | { readonly ok: true; readonly formato: 'jwt' | 'sb_secret'; readonly rol: string | null; readonly proyecto: string | null }
  | {
      readonly ok: false
      readonly motivo: 'ausente' | 'rol_incorrecto' | 'llave_publica' | 'formato_desconocido' | 'proyecto_distinto'
      readonly detalle: string
      readonly rol: string | null
      readonly proyecto: string | null
    }

function cuerpoDeJwt(llave: string): Record<string, unknown> | null {
  const partes = llave.split('.')
  // Las tres partes de un JWT son base64url puro: comillas, espacios o saltos de línea pegados con la llave (el error más
  // común al copiarla a un panel) la dejan inservible para Supabase aunque el cuerpo aún se pueda leer.
  if (partes.length !== 3 || !partes.every((parte) => /^[A-Za-z0-9_-]+$/.test(parte))) return null
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as unknown
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** El identificador del proyecto que sale de la URL (`https://<ref>.supabase.co`), si es una URL estándar. */
function proyectoDeUrl(url: string | undefined | null): string | null {
  const coincidencia = /^https:\/\/([a-z0-9]{10,})\.supabase\.(?:co|in)(?:\/|$)/i.exec((url ?? '').trim())
  return coincidencia ? coincidencia[1].toLowerCase() : null
}

export function diagnosticarLlaveServicio(
  llave: string | undefined | null,
  urlDelProyecto?: string | null
): DiagnosticoLlaveServicio {
  // SIN recortar: `createAdminClient` le pasa a Supabase la variable tal cual, así que un espacio o un salto de línea pegados
  // con la llave (lo más común al copiarla a un panel) la dejan inservible aunque «parezca» válida.
  const valor = llave ?? ''
  if (!valor.trim()) {
    return { ok: false, motivo: 'ausente', detalle: 'SUPABASE_SERVICE_ROLE_KEY no está definida.', rol: null, proyecto: null }
  }
  const proyectoUrl = proyectoDeUrl(urlDelProyecto)
  if (valor !== valor.trim()) {
    return {
      ok: false,
      motivo: 'formato_desconocido',
      detalle: 'SUPABASE_SERVICE_ROLE_KEY tiene espacios o saltos de línea al principio o al final. Pégala sin ellos.',
      rol: null,
      proyecto: proyectoUrl,
    }
  }

  if (valor.startsWith('sb_publishable_')) {
    return {
      ok: false,
      motivo: 'llave_publica',
      detalle: 'SUPABASE_SERVICE_ROLE_KEY tiene la llave PUBLICABLE (sb_publishable_…). Hace falta la secreta (sb_secret_…) o la service_role.',
      rol: 'anon',
      proyecto: proyectoUrl,
    }
  }
  if (/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(valor)) return { ok: true, formato: 'sb_secret', rol: null, proyecto: proyectoUrl }

  const cuerpo = cuerpoDeJwt(valor)
  if (!cuerpo) {
    return {
      ok: false,
      motivo: 'formato_desconocido',
      detalle: 'SUPABASE_SERVICE_ROLE_KEY no tiene forma de llave de Supabase (ni JWT ni sb_secret_…). ¿Se pegó con comillas, espacios o recortada?',
      rol: null,
      proyecto: proyectoUrl,
    }
  }
  const rol = typeof cuerpo.role === 'string' ? cuerpo.role : null
  const proyectoLlave = typeof cuerpo.ref === 'string' ? cuerpo.ref.toLowerCase() : null
  if (rol !== 'service_role') {
    return {
      ok: false,
      motivo: 'rol_incorrecto',
      detalle: `SUPABASE_SERVICE_ROLE_KEY es una llave con rol «${rol ?? 'desconocido'}», no «service_role». Con ella toda la API de administración de usuarios responde 403 not_admin.`,
      rol,
      proyecto: proyectoLlave,
    }
  }
  if (proyectoLlave && proyectoUrl && proyectoLlave !== proyectoUrl) {
    return {
      ok: false,
      motivo: 'proyecto_distinto',
      detalle: 'SUPABASE_SERVICE_ROLE_KEY es de OTRO proyecto de Supabase distinto al de NEXT_PUBLIC_SUPABASE_URL.',
      rol,
      proyecto: proyectoLlave,
    }
  }
  return { ok: true, formato: 'jwt', rol, proyecto: proyectoLlave ?? proyectoUrl }
}
