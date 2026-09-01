'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { crearClaveApi, revocarClaveApi } from '@/modules/connect/clavesApi'
import { cambiarEstadoSuscripcion, crearSuscripcion } from '@/modules/connect/webhooks'
import { MENSAJE_URL } from '@/modules/connect/webhooksNucleo'
import { SCOPES_POR_CAPABILITY } from '@membego/contracts'

/**
 * Acciones del panel de INTEGRACIONES de una empresa (Connect · Fase 4).
 *
 * Cada una empieza por `requireSection('integraciones', <función>)`, y ese
 * segundo argumento no es decorativo: es lo que hace que las cuatro funciones
 * listadas en `lib/auth/funciones.ts` sean interruptores REALES y no pintados.
 * La regla de honestidad del módulo de Permisos dice que solo se lista lo que
 * tiene guardia cableada; esto es el otro extremo de esa promesa.
 *
 * `requireSection` devuelve el usuario o null, y de él sale el `companyId`:
 * NUNCA se acepta uno del formulario. Un `companyId` que viaja por el
 * navegador es una sugerencia, no una autorización.
 */

export interface AccionState {
  error?: string
  success?: string
  /**
   * La clave recién creada, EN CLARO. Es la única vez que existe fuera del
   * hash, y por eso viaja de vuelta en el estado en vez de guardarse: si se
   * pierde, se rota.
   */
  claveNueva?: string
  /** El secreto de firma de un webhook recién creado. */
  secretoNuevo?: string
}

/** Scopes que una empresa puede conceder a una clave suya. */
const SCOPES_PERMITIDOS = [...new Set(Object.values(SCOPES_POR_CAPABILITY).flat())]
  .filter((s) => s.endsWith(':read'))
  .sort()

/**
 * Solo scopes de LECTURA, y no por prudencia genérica: los recursos de
 * escritura de la API v1 exigen la credencial de un satélite (necesitan saber
 * qué sistema respalda un canje). Ofrecer aquí `benefits:redeem` sería listar
 * un permiso que la guardia va a rechazar después — un interruptor pintado.
 */
export async function scopesDisponibles(): Promise<string[]> {
  return SCOPES_PERMITIDOS
}

export async function crearClaveAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'clave_crear')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  if (!nombre) return { error: 'Ponle un nombre para reconocerla después.' }

  const pedidos = formData.getAll('scopes').map(String)
  const scopes = pedidos.filter((s) => SCOPES_PERMITIDOS.includes(s))
  if (scopes.length === 0) return { error: 'Elige al menos un permiso.' }

  const res = await crearClaveApi({
    companyId: user.metadata.companyId,
    nombre,
    scopes,
    creadoPor: user.metadata.dbUserId ?? null,
  })
  if (!res.ok) {
    return {
      error:
        'Tu plan no incluye claves de API, o alcanzaste el máximo. Escríbenos para ampliarlo.',
    }
  }

  revalidatePath('/admin/integraciones')
  return {
    success: 'Clave creada. Cópiala ahora: no se puede volver a ver.',
    claveNueva: res.creada.clave,
  }
}

export async function revocarClaveAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'clave_revocar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Falta la clave.' }

  const res = await revocarClaveApi(user.metadata.companyId, id)
  if (!res.ok) return { error: 'Esa clave ya estaba revocada.' }

  revalidatePath('/admin/integraciones')
  return { success: 'Clave revocada. Deja de funcionar en la próxima llamada.' }
}

export async function crearWebhookAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_crear')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const nombre = String(formData.get('nombre') ?? '').trim()
  const url = String(formData.get('url') ?? '').trim()
  if (!nombre) return { error: 'Ponle un nombre para reconocerlo después.' }

  const res = await crearSuscripcion({
    companyId: user.metadata.companyId,
    nombre,
    url,
    // Sin eventos elegidos = todos. Ver `suscripcionQuiere`.
    eventos: formData.getAll('eventos').map(String).filter(Boolean),
    creadoPor: user.metadata.dbUserId ?? null,
  })

  if (!res.ok) {
    if (res.motivo === 'url_invalida') return { error: MENSAJE_URL[res.detalle] }
    return {
      error: 'Tu plan no incluye webhooks, o alcanzaste el máximo. Escríbenos para ampliarlo.',
    }
  }

  revalidatePath('/admin/integraciones')
  return {
    success: 'Webhook creado. Guarda el secreto para verificar nuestras firmas.',
    secretoNuevo: res.secreto,
  }
}

export async function cambiarEstadoWebhookAction(
  _prev: AccionState,
  formData: FormData
): Promise<AccionState> {
  const user = await requireSection('integraciones', 'webhook_estado')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  if (estado !== 'ACTIVE' && estado !== 'PAUSED') return { error: 'Estado no válido.' }

  const res = await cambiarEstadoSuscripcion(user.metadata.companyId, id, estado)
  if (!res.ok) return { error: 'No se pudo cambiar. Recarga la página.' }

  revalidatePath('/admin/integraciones')
  return {
    success:
      estado === 'ACTIVE'
        ? 'Webhook reactivado. Los próximos eventos se te entregarán.'
        : 'Webhook pausado. Dejamos de entregarte eventos hasta que lo reactives.',
  }
}
