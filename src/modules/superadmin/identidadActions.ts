'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { DISPARADORES_REVALIDACION, type DisparadorRevalidacion } from '@/modules/identidad/identidadCore'
import { ErrorDeIdentidad, cambiarInterruptorDeIdentidad, revocarVerificacion, solicitarRevalidacion, type ActorDeIdentidad } from '@/modules/identidad/identidad'
import { atenderIncidenciaComoStaff, cambiarReglaComoStaff, reabrirVerificacionComoStaff, resolverRevisionComoStaff } from '@/modules/identidad/staff'
import { suprimirIdentidadDePersona } from '@/modules/identidad/supresion'

/**
 * LAS ACCIONES DEL EQUIPO sobre la verificación de identidad (Fase 4). Solo SUPERADMIN: cada acción empieza por
 * `requireSuperadmin()` y el servicio lo vuelve a comprobar (`exigirGestionDeIdentidad`), así que un formulario que
 * llegue por otro camino tampoco pasa. Todas piden un motivo (o una respuesta) escrito por la persona del equipo y todas
 * dejan asiento con su nombre.
 *
 * Aquí no hay ninguna acción para APROBAR a alguien: un caso en revisión se aprueba en la consola del proveedor, y de ahí
 * vuelve por el aviso. «Verificada» solo lo escribe `aplicarDecision`.
 */

export interface EstadoAccionIdentidad {
  error?: string
  success?: string
}

async function requireSuperadmin(): Promise<{ actor: ActorDeIdentidad; ip: string | null; userAgent: string | null } | null> {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN' || !user.metadata.dbUserId) return null
  const meta = await getRequestMeta().catch(() => ({ ipAddress: null, userAgent: null }))
  return { actor: { userId: user.metadata.dbUserId, rol: user.metadata.role }, ip: meta.ipAddress?.split(',')[0]?.trim() ?? null, userAgent: meta.userAgent }
}

const texto = (fd: FormData, clave: string, max: number) => String(fd.get(clave) ?? '').trim().slice(0, max)

/** Un fallo del servicio se le dice a la persona del equipo tal cual (son mensajes en español); cualquier otro, uno genérico. */
function comoError(e: unknown): EstadoAccionIdentidad {
  if (e instanceof ErrorDeIdentidad) return { error: e.message }
  console.error('[superadmin/identidad]', e)
  return { error: 'No se pudo completar la acción. Revisa el registro del servidor.' }
}

const RUTA = '/superadmin/identidad'

/** Enciende o apaga la verificación de la plataforma. El motivo es obligatorio en los DOS sentidos. */
export async function cambiarInterruptorAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  const encender = formData.get('encender') === 'si'
  try {
    await cambiarInterruptorDeIdentidad(sesion.actor, { encendido: encender, motivo: texto(formData, 'motivo', 300) })
    revalidatePath(RUTA)
    return { success: encender ? 'Verificación de identidad encendida.' : 'Verificación de identidad apagada.' }
  } catch (e) {
    return comoError(e)
  }
}

/** Enciende, apaga o cambia el alcance de una regla de verificación por función. Con motivo, siempre. */
export async function cambiarReglaAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  const activar = formData.get('activar') === 'si'
  try {
    await cambiarReglaComoStaff(sesion.actor, {
      operacion: texto(formData, 'operacion', 60),
      activa: activar,
      alcance: texto(formData, 'alcance', 30),
      motivo: texto(formData, 'motivo', 300),
    })
    revalidatePath(RUTA)
    return { success: activar ? 'Regla guardada y encendida.' : 'Regla apagada.' }
  } catch (e) {
    return comoError(e)
  }
}

/** Le abre un intento nuevo a quien quedó bloqueado por rechazos (lo que promete «contacta a soporte»). Con motivo; la persona debe pasar por el proveedor. */
export async function reabrirVerificacionAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  try {
    const r = await reabrirVerificacionComoStaff(sesion.actor, texto(formData, 'userId', 100), texto(formData, 'motivo', 200))
    revalidatePath(RUTA)
    if (r.ok) return { success: 'Se reabrió la verificación y se le avisó a la persona. Tiene que hacerla ella.' }
    const porque: Record<string, string> = {
      ya_verificada: 'Esa persona ya tiene una verificación vigente.',
      intento_abierto: 'Esa persona ya tiene un intento abierto: lo retoma desde su pantalla.',
      falta_consentimiento: 'Esa persona no tiene dados sus permisos: tiene que aceptarlos ella desde su pantalla antes de verificarse.',
      no_habilitada: 'La verificación está apagada: enciéndela antes de reabrir a nadie.',
      persona_no_encontrada: 'Esa persona no existe.',
      espera: 'Esa persona está en la espera obligatoria tras un rechazo: puede volver a intentarlo en unos minutos sin ayuda.',
    }
    return { error: porque[r.error] ?? 'No se pudo reabrir la verificación.' }
  } catch (e) {
    return comoError(e)
  }
}

/** Resuelve un caso en revisión: rechazarlo o pedir que la persona repita. Nunca aprobarlo. */
export async function resolverRevisionAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  const decision = formData.get('decision')
  if (decision !== 'rechazar' && decision !== 'pedir_repeticion') return { error: 'Elige qué hacer con el caso.' }
  try {
    const r = await resolverRevisionComoStaff(sesion.actor, texto(formData, 'intentoId', 100), decision, texto(formData, 'motivo', 200))
    if (!r.ok) {
      return { error: r.error === 'no_esta_en_revision' ? 'Este caso ya no está en revisión: alguien lo resolvió o el proveedor lo decidió.' : r.error === 'no_existe' ? 'El caso no existe.' : 'Decisión no válida.' }
    }
    revalidatePath(RUTA)
    return { success: r.resultado === 'rechazada' ? 'Caso rechazado. La persona recibió el aviso.' : 'Se le pidió a la persona que repita la verificación.' }
  } catch (e) {
    return comoError(e)
  }
}

/** Toma o resuelve una incidencia. Al resolver, la respuesta le llega a la persona. */
export async function atenderIncidenciaAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  const accion = formData.get('accion')
  if (accion !== 'tomar' && accion !== 'resolver') return { error: 'Acción no válida.' }
  try {
    const r = await atenderIncidenciaComoStaff(sesion.actor, texto(formData, 'incidenciaId', 100), accion, texto(formData, 'respuesta', 500))
    if (!r.ok) {
      return { error: r.error === 'respuesta_invalida' ? 'Escribe la respuesta que verá la persona.' : r.error === 'ya_resuelta' ? 'Esta incidencia ya está resuelta.' : 'La incidencia no existe.' }
    }
    revalidatePath(RUTA)
    return { success: accion === 'tomar' ? 'Incidencia en proceso.' : r.cambio ? 'Incidencia resuelta. La persona recibió tu respuesta.' : 'Esa incidencia ya estaba resuelta.' }
  } catch (e) {
    return comoError(e)
  }
}

/** Retira la verificación de una persona (fraude confirmado, error de registro…). */
export async function revocarVerificacionAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  try {
    const r = await revocarVerificacion(sesion.actor, texto(formData, 'userId', 100), texto(formData, 'motivo', 120))
    revalidatePath(RUTA)
    return r.revocada ? { success: 'Verificación retirada.' } : { error: 'No había una verificación que retirar.' }
  } catch (e) {
    return comoError(e)
  }
}

/** Le pide a una persona verificada que se verifique de nuevo. Su resultado deja de verse en las fichas mientras tanto. */
export async function pedirRevalidacionAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  const disparador = String(formData.get('disparador') ?? '')
  if (!(DISPARADORES_REVALIDACION as readonly string[]).includes(disparador)) return { error: 'Elige por qué se pide.' }
  try {
    const r = await solicitarRevalidacion(texto(formData, 'userId', 100), disparador as DisparadorRevalidacion, sesion.actor)
    revalidatePath(RUTA)
    return r.solicitada ? { success: 'Se le pidió revalidar. Su resultado deja de verse en las fichas.' } : { error: 'Esa persona no tiene una verificación vigente que revalidar.' }
  } catch (e) {
    return comoError(e)
  }
}

/** Atiende una solicitud de borrado (derecho de supresión): primero el proveedor y, si lo confirma, Membego. */
export async function suprimirIdentidadAction(_prev: EstadoAccionIdentidad, formData: FormData): Promise<EstadoAccionIdentidad> {
  const sesion = await requireSuperadmin()
  if (!sesion) return { error: 'No autorizado.' }
  if (formData.get('confirmo') !== 'on') return { error: 'Confirma que entiendes que es definitivo.' }
  try {
    const r = await suprimirIdentidadDePersona(sesion.actor, texto(formData, 'userId', 100), texto(formData, 'motivo', 120))
    revalidatePath(RUTA)
    return { success: `Datos borrados: ${r.sesionesBorradas} sesión(es) en el proveedor y ${r.intentosAnonimizados} intento(s) anonimizado(s).` }
  } catch (e) {
    return comoError(e)
  }
}
