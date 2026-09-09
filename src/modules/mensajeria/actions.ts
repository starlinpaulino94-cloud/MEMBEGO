'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/auth/guards'
import { cambiarEstadoConversacion } from '@/modules/mensajeria/bandeja'
import { explicarEnvio } from '@/modules/mensajeria/nucleo'
import { sincronizarPlantillas } from '@/modules/mensajeria/plantillas'
import {
  enviarPlantillaEnConversacion,
  enviarTextoEnConversacion,
  marcarConversacionLeida,
} from '@/modules/mensajeria/salientes'

/**
 * ACCIONES DE LA BANDEJA (Meta · Fase 5).
 *
 * Todas empiezan por `requireAdminUser()` —admin pleno, sin redirección— y
 * la empresa sale SIEMPRE de la sesión, nunca del formulario: una acción se
 * despacha por su id desde cualquier ruta, así que el formulario no es una
 * barrera. El id de conversación que llega se valida por forma y luego cada
 * consulta lo cruza con `companyId`; un id de otra empresa no encuentra nada.
 *
 * Enviar texto y enviar plantilla son dos acciones a propósito: la ventana
 * de 24 h decide cuál se ofrece, y el servidor la vuelve a comprobar.
 */

const RUTA = '/admin/crm/conversaciones'
const ID_VALIDO = /^[a-z0-9]{10,40}$/i
const MAX_TEXTO = 4096

export interface EstadoRedactor {
  error?: string
  success?: string
  /** Marca del último envío correcto: la pantalla la usa para vaciar el cuadro. */
  enviadoAt?: number
}

async function quien(): Promise<{ companyId: string; usuarioId: string } | null> {
  const user = await requireAdminUser()
  if (!user?.metadata.companyId) return null
  return { companyId: user.metadata.companyId, usuarioId: user.metadata.dbUserId }
}

function idDe(formData: FormData, campo = 'conversacionId'): string | null {
  const v = formData.get(campo)
  return typeof v === 'string' && ID_VALIDO.test(v) ? v : null
}

export async function enviarTextoAction(_prev: EstadoRedactor, formData: FormData): Promise<EstadoRedactor> {
  const yo = await quien()
  if (!yo) return { error: 'No autorizado.' }
  const conversacionId = idDe(formData)
  if (!conversacionId) return { error: 'Conversación no válida.' }
  const texto = String(formData.get('texto') ?? '').trim()
  if (!texto) return { error: 'Escribe algo antes de enviar.' }
  if (texto.length > MAX_TEXTO) return { error: `El mensaje no puede pasar de ${MAX_TEXTO} caracteres.` }

  const r = await enviarTextoEnConversacion({
    companyId: yo.companyId,
    conversacionId,
    texto,
    enviadoPorId: yo.usuarioId,
  })
  revalidatePath(RUTA)
  if (!r.ok) return { error: explicarEnvio(r.motivo, r.detalle) }
  return { success: 'Enviado.', enviadoAt: Date.now() }
}

export async function enviarPlantillaAction(_prev: EstadoRedactor, formData: FormData): Promise<EstadoRedactor> {
  const yo = await quien()
  if (!yo) return { error: 'No autorizado.' }
  const conversacionId = idDe(formData)
  const plantillaId = idDe(formData, 'plantillaId')
  if (!conversacionId || !plantillaId) return { error: 'Elige una plantilla.' }
  const parametros = formData
    .getAll('parametro')
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
  if (parametros.some((p) => !p)) return { error: 'Rellena todos los campos de la plantilla.' }

  const r = await enviarPlantillaEnConversacion({
    companyId: yo.companyId,
    conversacionId,
    plantillaId,
    parametros,
    enviadoPorId: yo.usuarioId,
  })
  revalidatePath(RUTA)
  if (!r.ok) return { error: explicarEnvio(r.motivo, r.detalle) }
  return { success: 'Plantilla enviada.', enviadoAt: Date.now() }
}

/** Al abrir un hilo con mensajes sin leer. Best-effort: no devuelve error. */
export async function marcarLeidaAction(conversacionId: string): Promise<void> {
  const yo = await quien()
  if (!yo || !ID_VALIDO.test(conversacionId)) return
  await marcarConversacionLeida({ companyId: yo.companyId, conversacionId }).catch(() => undefined)
  revalidatePath(RUTA)
}

export async function cambiarEstadoConversacionAction(
  conversacionId: string,
  estado: 'ABIERTA' | 'CERRADA'
): Promise<{ ok: boolean; error?: string }> {
  const yo = await quien()
  if (!yo) return { ok: false, error: 'No autorizado.' }
  if (!ID_VALIDO.test(conversacionId) || (estado !== 'ABIERTA' && estado !== 'CERRADA')) {
    return { ok: false, error: 'Conversación no válida.' }
  }
  const ok = await cambiarEstadoConversacion(yo.companyId, conversacionId, estado)
  revalidatePath(RUTA)
  return ok ? { ok: true } : { ok: false, error: 'Esta conversación ya no existe.' }
}

export async function sincronizarPlantillasAction(): Promise<{ ok: boolean; mensaje: string }> {
  const yo = await quien()
  if (!yo) return { ok: false, mensaje: 'No autorizado.' }
  const r = await sincronizarPlantillas(yo.companyId)
  revalidatePath(RUTA)
  if (r.ok) {
    return {
      ok: true,
      mensaje:
        r.aprobadas === 0
          ? `Meta devolvió ${r.total} plantillas, ninguna aprobada todavía.`
          : `${r.aprobadas} plantillas aprobadas de ${r.total}.`,
    }
  }
  const textos: Record<typeof r.motivo, string> = {
    sin_conexion: 'WhatsApp no está conectado.',
    sin_waba: 'Esta conexión de WhatsApp no conoce su cuenta de empresa: vuelve a conectarla con el registro guiado.',
    proveedor: r.detalle ? `Meta no respondió bien: ${r.detalle}.` : 'Meta no respondió bien.',
    activo: 'La cuenta de WhatsApp está reclamada por otro negocio.',
  }
  return { ok: false, mensaje: textos[r.motivo] }
}
