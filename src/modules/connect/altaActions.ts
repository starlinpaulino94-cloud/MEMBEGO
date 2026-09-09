'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { asegurarConexion } from '@/modules/connect/registro'
import { olvidarPaso, responderPaso, terminarAlta, validarAlta } from '@/modules/connect/alta'
import { proveedorDe } from '@/modules/connect/proveedores/indice'
import { completarAltaMeta } from '@/modules/connect/metaEmbedded'
import { leerRespuestaAlta, metaConfigurado, metaPaginasConfigurado } from '@/modules/connect/metaNucleo'
import { vistaDelAlta } from '@/modules/connect/alta'
import { completarLoginPaginas, elegirPaginas, paginasDisponibles } from '@/modules/connect/meta/paginas'

/**
 * ACCIONES DEL ASISTENTE DE ALTA (Connect · Fase 12).
 *
 * Todas empiezan por `requireSection('integraciones', 'app_conectar')`, y el
 * `companyId` sale de la sesión — NUNCA del formulario. Un `companyId` que
 * viaja por el navegador es una sugerencia, no una autorización.
 *
 * Ninguna acepta el paso «actual» desde el cliente: el paso se DEDUCE en el
 * servidor de lo que ya está cumplido. Lo que el formulario manda es la
 * respuesta a un paso concreto, y `responderPaso` comprueba que ese paso
 * exista en el guion antes de guardarla.
 */

export interface AltaState {
  error?: string
  success?: string
  /** Resultado detallado del paso de validación, si se acaba de ejecutar. */
  comprobaciones?: { clave: string; titulo: string; ok: boolean; detalle: string }[]
}

// ─── Facebook e Instagram (Meta · Fase 3) ────────────────────────────────────

/** Lo que la pantalla ve de una Página: id, nombre y si puede atender mensajes. Nunca tokens. */
export interface PaginaParaElegir {
  id: string
  nombre: string
  puedeMensajes: boolean
  elegida: boolean
}

/** El código del diálogo de Login for Business → token sellado. */
export async function altaMetaPaginasAction(
  _prev: AltaState,
  formData: FormData
): Promise<AltaState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }
  if (!metaPaginasConfigurado()) return { error: 'La conexión con Facebook no está disponible aquí.' }

  const code = String(formData.get('code') ?? '').trim()
  if (!code) return { error: 'Meta no devolvió la autorización. Vuelve a intentarlo.' }

  const vista = await vistaDelAlta(user.metadata.companyId, 'facebook')
  if (!vista) return { error: 'No encontramos la conexión.' }

  const res = await completarLoginPaginas({
    companyId: user.metadata.companyId,
    conexionId: vista.conexionId,
    code,
  })
  if (!res.ok) return { error: res.detalle }
  revalidatePath('/admin/integraciones/facebook/conectar')
  return { success: res.nombreUsuario ? `Conectado como ${res.nombreUsuario}.` : 'Autorización guardada.' }
}

export async function paginasDisponiblesAction(
  slug: string
): Promise<{ ok: true; paginas: PaginaParaElegir[] } | { ok: false; error: string }> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { ok: false, error: 'No autorizado.' }
  if (slug !== 'facebook') return { ok: false, error: 'Esta integración no elige Páginas.' }
  const vista = await vistaDelAlta(user.metadata.companyId, slug)
  if (!vista) return { ok: false, error: 'No encontramos la conexión.' }
  const res = await paginasDisponibles({ companyId: user.metadata.companyId, conexionId: vista.conexionId })
  if (!res.ok) return { ok: false, error: res.detalle }
  return {
    ok: true,
    paginas: res.paginas.map((p) => ({ id: p.id, nombre: p.nombre, puedeMensajes: p.puedeMensajes, elegida: p.elegida })),
  }
}

export async function elegirPaginasAction(_prev: AltaState, formData: FormData): Promise<AltaState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }
  const slug = String(formData.get('slug') ?? '')
  if (slug !== 'facebook') return { error: 'Esta integración no elige Páginas.' }
  const ids = formData
    .getAll('paginaId')
    .map((v) => String(v).trim())
    .filter((v) => /^\d{1,32}$/.test(v))
  if (ids.length === 0) return { error: 'Elige al menos una Página.' }

  const vista = await vistaDelAlta(user.metadata.companyId, slug)
  if (!vista) return { error: 'No encontramos la conexión.' }

  const res = await elegirPaginas({ companyId: user.metadata.companyId, conexionId: vista.conexionId, paginaIds: ids })
  if (!res.ok) return { error: res.detalle }

  // El paso queda contestado con lo que Meta confirmó, no con lo que llegó del formulario.
  await responderPaso({ companyId: user.metadata.companyId, slug, pasoId: 'paginas', valor: ids })
  revalidatePath(`/admin/integraciones/${slug}/conectar`)
  const partes = [`${res.paginas} ${res.paginas === 1 ? 'Página conectada' : 'Páginas conectadas'}`]
  if (res.instagram > 0) partes.push(`${res.instagram} de Instagram`)
  return { success: `${partes.join(' y ')}.${res.avisos.length ? ` ${res.avisos.join(' ')}` : ''}` }
}

/** Empieza (o reanuda) el alta: garantiza que exista la fila de conexión. */
export async function comenzarAltaAction(slug: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { ok: false, error: 'No autorizado.' }

  const def = proveedorDe(slug)
  if (!def || def.clase !== 'NATIVA') {
    return { ok: false, error: 'Esa integración todavía no se puede conectar.' }
  }

  const id = await asegurarConexion({
    companyId: user.metadata.companyId,
    conectorSlug: slug,
    creadoPor: user.metadata.dbUserId ?? undefined,
  })
  if (!id) return { ok: false, error: 'No se pudo preparar la conexión.' }

  revalidatePath(`/admin/integraciones/${slug}/conectar`)
  return { ok: true }
}

export async function responderPasoAction(
  _prev: AltaState,
  formData: FormData
): Promise<AltaState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const slug = String(formData.get('slug') ?? '')
  const pasoId = String(formData.get('pasoId') ?? '')
  if (!slug || !pasoId) return { error: 'Falta información del paso.' }

  // El valor llega como texto (una elección) o como un objeto de opciones. Se
  // arma aquí y no en el cliente: lo que el navegador manda son campos, no la
  // forma final de lo que se guarda.
  const valorSimple = formData.get('valor')
  const valor =
    valorSimple !== null
      ? String(valorSimple)
      : Object.fromEntries(
          [...formData.entries()]
            .filter(([k]) => k.startsWith('opcion.'))
            .map(([k, v]) => [k.slice('opcion.'.length), v === 'on' ? true : String(v)])
        )

  if (typeof valor === 'string' && !valor.trim()) return { error: 'Elige una opción.' }

  const res = await responderPaso({
    companyId: user.metadata.companyId,
    slug,
    pasoId,
    valor,
  })
  if (!res.ok) return { error: 'No se pudo guardar. Vuelve a intentarlo.' }

  revalidatePath(`/admin/integraciones/${slug}/conectar`)
  return { success: 'Guardado.' }
}

/**
 * VOLVER a un paso anterior. No mueve ningún cursor —no hay— sino que olvida
 * la respuesta de aquel paso, y el asistente recalcula que ahora toca ese.
 */
export async function retrocederAction(
  _prev: AltaState,
  formData: FormData
): Promise<AltaState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const slug = String(formData.get('slug') ?? '')
  const pasoId = String(formData.get('pasoId') ?? '')
  if (!slug || !pasoId) return { error: 'Falta información del paso.' }

  const res = await olvidarPaso({ companyId: user.metadata.companyId, slug, pasoId })
  if (!res.ok) return { error: 'No se puede volver a ese paso.' }

  revalidatePath(`/admin/integraciones/${slug}/conectar`)
  return {}
}

export async function validarAltaAction(
  _prev: AltaState,
  formData: FormData
): Promise<AltaState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const slug = String(formData.get('slug') ?? '')
  if (!slug) return { error: 'Falta la integración.' }

  const res = await validarAlta({ companyId: user.metadata.companyId, slug })
  revalidatePath(`/admin/integraciones/${slug}/conectar`)

  if (res.ok) return { success: 'Todo correcto.', comprobaciones: res.comprobaciones }
  return {
    error: res.detalle ?? 'Hay algo que arreglar antes de terminar.',
    comprobaciones: res.comprobaciones,
  }
}

export async function terminarAltaAction(
  _prev: AltaState,
  formData: FormData
): Promise<AltaState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  const slug = String(formData.get('slug') ?? '')
  if (!slug) return { error: 'Falta la integración.' }

  const res = await terminarAlta({ companyId: user.metadata.companyId, slug })
  if (!res.ok) {
    return {
      error:
        res.motivo === 'incompleta'
          ? 'Todavía falta algún paso por completar.'
          : 'No encontramos el alta.',
    }
  }

  revalidatePath('/admin/integraciones')
  revalidatePath(`/admin/integraciones/${slug}`)
  return { success: '¡Listo! La integración quedó conectada.' }
}

/**
 * EL ALTA INCRUSTADA DE META · la acción que corre contra reloj.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE LLAMA EN CUANTO LLEGA EL CÓDIGO, NO AL PULSAR «SIGUIENTE»
 *
 * El código que devuelve el diálogo de Meta vive TREINTA SEGUNDOS. Si esta
 * acción esperara a que la persona confirmara algo, la mitad de las altas
 * fallarían por caducidad — y el mensaje de error no diría nada útil.
 *
 * Lo que llega del navegador viene de una VENTANA AJENA (la de Meta), así que
 * no se da por bueno: `leerRespuestaAlta` comprueba la forma, y los
 * identificadores tienen que ser numéricos antes de acabar dentro de una URL
 * de la Graph API.
 *
 * La empresa sale de la sesión, como en todas las demás.
 */
export async function altaMetaAction(
  _prev: AltaState,
  formData: FormData
): Promise<AltaState> {
  const user = await requireSection('integraciones', 'app_conectar')
  if (!user?.metadata.companyId) return { error: 'No autorizado.' }

  // Si la plataforma no tiene el alta incrustada configurada, esta acción no
  // existe para nadie — aunque alguien la llame a mano.
  if (!metaConfigurado()) return { error: 'El alta con Meta no está disponible aquí.' }

  const lectura = leerRespuestaAlta({
    code: formData.get('code'),
    wabaId: formData.get('wabaId'),
    phoneNumberId: formData.get('phoneNumberId'),
  })
  if (!lectura.ok) {
    return {
      error:
        lectura.motivo === 'incompleta'
          ? 'Meta no devolvió todos los datos. Vuelve a intentarlo.'
          : 'La respuesta de Meta no se entendió. Vuelve a intentarlo.',
    }
  }

  const vista = await vistaDelAlta(user.metadata.companyId, 'whatsapp')
  if (!vista) return { error: 'No encontramos la conexión.' }

  const res = await completarAltaMeta({
    companyId: user.metadata.companyId,
    conexionId: vista.conexionId,
    respuesta: lectura.datos,
  })

  if (!res.ok) {
    // El mensaje ya viene redactado para una persona; el detalle técnico
    // —fase, estado HTTP, código de Meta, traza y clase de error— quedó en la
    // bitácora. Aquí NO se filtra nada de eso.
    return { error: res.detalle }
  }

  revalidatePath('/admin/integraciones/whatsapp/conectar')
  return {
    success: res.numeroVisible
      ? `WhatsApp conectado con el número ${res.numeroVisible}.`
      : 'WhatsApp conectado.',
  }
}
