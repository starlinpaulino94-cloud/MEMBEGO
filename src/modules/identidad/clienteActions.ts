'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { TIPOS_CONSENTIMIENTO_IDENTIDAD } from '@/modules/identidad/identidadConsentimientosCore'
import type { OrigenWebDeVerificacion } from '@/modules/identidad/sincronizacion'
import {
  cambiarConsentimientoDePersona,
  iniciarVerificacionDePersona,
  pedirBorradoDePersona,
  reportarProblemaDePersona,
  type ContextoDePeticion,
  type QuienEs,
} from '@/modules/identidad/identidadPuerta'

/**
 * LAS ACCIONES WEB DE LA VERIFICACIÓN DE IDENTIDAD (Fase 3).
 *
 * Solo traducen: saben quién es la persona (la SESIÓN: nunca el formulario) y leen el
 * formulario. Todo lo demás —el límite de uso, los consentimientos, las reglas para
 * empezar, el borrado— vive en `identidadPuerta.ts`, que comparten con la API de la app
 * móvil para que las dos superficies respondan igual.
 *
 * Ninguna acción de aquí puede marcar a nadie como verificado: «iniciar» solo crea la
 * sesión con el proveedor y devuelve la dirección a la que mandar a la persona.
 */

/** La pantalla de la persona vive en dos sitios (cliente y portal del proveedor): se refrescan los dos. */
function revalidarPantalla() {
  revalidatePath('/cliente/identidad')
  revalidatePath('/admin/supply/identidad')
}

export interface IdentidadActionState {
  error?: string
  success?: boolean
  /** Solo al iniciar: a dónde hay que mandar a la persona (lleva un token de la sesión; no se registra). */
  url?: string
}

/**
 * La persona de la SESIÓN: un cliente, o —desde la Fase 5— quien trabaja en el portal de un proveedor (la persona que acepta
 * su contrato y a quien Membego puede pedirle la verificación antes de pagarle). Cualquier otro rol, fuera. El sitio al que
 * vuelve tras verificarse sale del ROL, nunca de lo que mande el formulario.
 */
async function exigirPersona(): Promise<{ quien: QuienEs; ctx: ContextoDePeticion; origenWeb: OrigenWebDeVerificacion } | null> {
  const user = await getUser()
  if (!user || !user.metadata.dbUserId) return null
  const esCliente = user.metadata.role === 'CLIENTE'
  if (!esCliente && !(await proveedorDeLaSesion())) return null
  const meta = await getRequestMeta()
  return {
    origenWeb: esCliente ? 'cliente' : 'proveedor',
    quien: { userId: user.metadata.dbUserId, supabaseId: user.supabaseId },
    ctx: { canal: 'web', ip: meta.ipAddress?.split(',')[0]?.trim() ?? null, userAgent: meta.userAgent },
  }
}

/**
 * Empieza (o retoma) la verificación. Del formulario salen las casillas marcadas
 * (`acepta:<tipo>`) y, de cada una, la versión del texto que la persona vio
 * (`version:<tipo>`): si no es la vigente, el servidor lo rechaza.
 */
export async function iniciarVerificacionAction(_prev: IdentidadActionState, formData: FormData): Promise<IdentidadActionState> {
  const p = await exigirPersona()
  if (!p) return { error: 'No autorizado.' }
  const aceptados: Record<string, string> = {}
  for (const tipo of TIPOS_CONSENTIMIENTO_IDENTIDAD) {
    if (formData.get(`acepta:${tipo}`) === 'on') aceptados[tipo] = String(formData.get(`version:${tipo}`) ?? '')
  }
  const r = await iniciarVerificacionDePersona(p.quien, { aceptados, canalDeCaptura: 'web', origenWeb: p.origenWeb }, p.ctx)
  revalidarPantalla()
  if (!r.ok) return { error: r.error }
  return { success: true, url: r.url }
}

/** Da o retira el permiso de que los negocios vean que la persona está verificada. */
export async function cambiarDivulgacionAction(_prev: IdentidadActionState, formData: FormData): Promise<IdentidadActionState> {
  const p = await exigirPersona()
  if (!p) return { error: 'No autorizado.' }
  const accion = formData.get('accion') === 'aceptar' ? 'aceptar' : 'retirar'
  const r = await cambiarConsentimientoDePersona(
    p.quien,
    { tipo: 'IDENTIDAD_DIVULGACION_EMPRESAS', accion, version: String(formData.get('version') ?? '') },
    p.ctx
  )
  if (!r.ok) return { error: r.error }
  revalidarPantalla()
  return { success: true }
}

/** La persona cuenta un problema con su verificación. */
export async function reportarProblemaAction(_prev: IdentidadActionState, formData: FormData): Promise<IdentidadActionState> {
  const p = await exigirPersona()
  if (!p) return { error: 'No autorizado.' }
  const r = await reportarProblemaDePersona(p.quien, {
    tipo: String(formData.get('tipo') ?? ''),
    mensaje: String(formData.get('mensaje') ?? ''),
    intentoId: String(formData.get('intentoId') ?? '') || null,
  })
  if (!r.ok) return { error: r.error }
  revalidarPantalla()
  return { success: true }
}

/** La persona pide que se borren sus datos de verificación. Irreversible. */
export async function borrarDatosDeIdentidadAction(_prev: IdentidadActionState, _formData: FormData): Promise<IdentidadActionState> {
  const p = await exigirPersona()
  if (!p) return { error: 'No autorizado.' }
  const r = await pedirBorradoDePersona(p.quien)
  if (!r.ok) return { error: r.error }
  revalidarPantalla()
  revalidatePath('/cliente/ajustes')
  return { success: true }
}
