'use server'

/**
 * COMPROBANTES DE PAGO — subida y lectura seguras
 * (auditoría de producción · C-01, el hallazgo más grave del informe).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL, EXACTAMENTE
 *
 * El bucket `comprobantes` era PÚBLICO por diseño documentado, y la ruta del
 * archivo la componía el navegador:
 *
 *     const path = `comprobantes/${membershipId}-${Date.now()}.${ext}`
 *     await supabase.storage.from('comprobantes').upload(path, file, { upsert: true })
 *     const { data } = supabase.storage.from('comprobantes').getPublicUrl(path)
 *
 * Tres agujeros a la vez:
 *
 *  1. LECTURA SIN AUTORIZACIÓN. Bucket público = cualquiera con la URL ve el
 *     comprobante bancario de una persona: su nombre, su banco, su número de
 *     cuenta y cuánto pagó. Y la URL se guardaba tal cual en la base y viajaba
 *     por la aplicación.
 *  2. RUTA ELEGIDA POR EL CLIENTE. `membershipId` es un identificador que la
 *     propia aplicación expone. Con él y una ventana de tiempo se puede
 *     construir la ruta de otro.
 *  3. `upsert: true` SOBRE ESA RUTA. Un usuario autenticado podía escribir en
 *     la ruta de OTRO y sobrescribir su comprobante. No es solo fuga: es
 *     destrucción de la prueba de un pago que sí se hizo.
 *
 * CÓMO QUEDA
 *
 *  · El bucket pasa a PRIVADO (migración `2026-07-comprobantes-privado.sql`).
 *  · La ruta la genera el SERVIDOR, con 16 bytes aleatorios que el cliente no
 *    puede predecir ni elegir.
 *  · El cliente sube con una URL firmada de un solo uso para ESA ruta concreta
 *    (`createSignedUploadUrl`), sin `upsert`. No hay forma de escribir en la
 *    ruta de otro porque el token no vale para otra ruta.
 *  · La lectura pasa por `urlComprobante`, que comprueba QUIÉN pregunta antes
 *    de firmar una URL de cinco minutos.
 *
 * POR QUÉ URL FIRMADA DE SUBIDA Y NO SUBIR EL ARCHIVO A LA SERVER ACTION: las
 * server actions tienen un límite de cuerpo (1 MB por defecto) y un
 * comprobante puede pesar 5. Subir el archivo al servidor para reenviarlo a
 * Storage duplicaría el tráfico y el tiempo de la función sin ganar nada: el
 * control que importa —quién puede escribir y en qué ruta— ya lo da el token.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { FULL_ADMIN_ROLES } from '@/types'
import { BUCKET_COMPROBANTES, type TipoComprobante } from '@/modules/storage/tipos'


const EXTENSIONES = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf'])

export interface SubidaFirmada {
  /** Ruta definitiva dentro del bucket. Es la que se guarda en la base. */
  path: string
  /** Token de un solo uso para `uploadToSignedUrl`. */
  token: string
}

export interface ResultadoSubida {
  error?: string
  subida?: SubidaFirmada
}

/**
 * Prefijo obligatorio de la ruta de una entidad.
 *
 * Es lo que permite comprobar, al guardar, que la ruta que envía el navegador
 * corresponde de verdad a la entidad que dice. Sin esto, alguien podría pedir
 * una URL de subida para SU membresía (legítimo) y luego declarar ese archivo
 * como comprobante de otra cosa.
 */
function prefijoDe(tipo: TipoComprobante, id: string): string {
  return `${tipo}/${id}/`
}

/** ¿Esta ruta pertenece a esta entidad? Comprobación de forma, barata. */
export async function rutaValida(
  tipo: TipoComprobante,
  id: string,
  path: string
): Promise<boolean> {
  if (!path || path.includes('..') || path.startsWith('/')) return false
  return path.startsWith(prefijoDe(tipo, id))
}

/**
 * ¿Esta persona puede adjuntar un comprobante a esta entidad?
 *
 * Se comprueba contra la base, no contra lo que diga el formulario: el
 * identificador viaja por el navegador y es manipulable.
 */
async function puedeSubir(
  tipo: TipoComprobante,
  id: string,
  supabaseId: string
): Promise<boolean> {
  try {
    if (tipo === 'membresia') {
      const m = await prisma.membership.findUnique({
        where: { id },
        select: { cliente: { select: { supabaseId: true } } },
      })
      return m?.cliente?.supabaseId === supabaseId
    }
    if (tipo === 'compra') {
      const c = await prisma.productoCompra.findUnique({
        where: { id },
        select: { cliente: { select: { supabaseId: true } } },
      })
      return c?.cliente?.supabaseId === supabaseId
    }
    // Soporte: el ticket todavía no existe cuando se adjunta el archivo (el
    // adjunto se sube antes de crear el ticket). El identificador es el propio
    // supabaseId de quien reporta, así que la ruta ya queda atada a la persona.
    return id === supabaseId
  } catch {
    return false
  }
}

/**
 * Pide permiso para subir un comprobante y devuelve la ruta y el token.
 *
 * La extensión se valida contra una lista blanca ANTES de firmar: la
 * validación del navegador (tipo MIME y tamaño) es comodidad para el usuario,
 * no una defensa — el navegador es del atacante. El límite de tamaño y los
 * tipos permitidos los impone además el propio bucket en la migración.
 */
export async function pedirSubidaComprobante(
  tipo: TipoComprobante,
  id: string,
  extension: string
): Promise<ResultadoSubida> {
  const user = await getUser()
  if (!user) return { error: 'Inicia sesión para adjuntar el comprobante.' }

  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!EXTENSIONES.has(ext)) {
    return { error: 'Solo se aceptan imágenes JPG, PNG, WEBP o archivos PDF.' }
  }
  if (!id) return { error: 'Falta la referencia del pago.' }

  const idEfectivo = tipo === 'soporte' ? user.supabaseId : id
  if (!(await puedeSubir(tipo, idEfectivo, user.supabaseId))) {
    return { error: 'No puedes adjuntar un comprobante a este pago.' }
  }

  // 16 bytes aleatorios: la ruta no se puede adivinar ni desde dentro. El
  // nombre original del archivo se descarta a propósito (llega del navegador
  // y puede contener cualquier cosa).
  const path = `${prefijoDe(tipo, idEfectivo)}${randomBytes(16).toString('hex')}.${ext}`

  try {
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET_COMPROBANTES)
      .createSignedUploadUrl(path)
    if (error || !data) {
      console.error('[comprobantes] createSignedUploadUrl:', error)
      return { error: 'No se pudo preparar la subida. Intenta de nuevo.' }
    }
    return { subida: { path: data.path, token: data.token } }
  } catch (e) {
    console.error('[comprobantes] error inesperado:', e)
    return { error: 'No se pudo preparar la subida. Intenta de nuevo.' }
  }
}

/**
 * Convierte una URL PÚBLICA antigua en la ruta del objeto.
 *
 * Los comprobantes subidos antes de este cambio se guardaron como URL completa
 * (`https://<proyecto>.supabase.co/storage/v1/object/public/comprobantes/...`).
 * Al cerrar el bucket esas URL dejan de funcionar, pero los archivos siguen
 * ahí: extrayendo la ruta se pueden seguir firmando. Sin esto, todo el
 * historial de pagos ya validados se quedaría sin comprobante visible.
 */
function rutaDesdeValor(valor: string): string {
  if (!valor.startsWith('http')) return valor
  const marca = `/object/public/${BUCKET_COMPROBANTES}/`
  const i = valor.indexOf(marca)
  if (i === -1) return valor
  return decodeURIComponent(valor.slice(i + marca.length).split('?')[0])
}

/** Minutos que vive una URL firmada de lectura. Corta a propósito. */
const VIGENCIA_LECTURA_S = 300

/**
 * URL temporal para VER un comprobante, previa comprobación de permiso.
 *
 * Puede verlo su dueño y el administrador de la empresa donde se hizo el pago
 * (que es quien tiene que validarlo). Nadie más — ni siquiera con la ruta.
 */
export async function urlComprobante(
  tipo: TipoComprobante,
  id: string,
  valorGuardado: string | null | undefined
): Promise<string | null> {
  if (!valorGuardado) return null

  const user = await getUser()
  if (!user) return null

  const esDueno = await puedeSubir(tipo, id, user.supabaseId)
  const esAdmin =
    FULL_ADMIN_ROLES.includes(user.metadata.role) &&
    (await esDeSuEmpresa(tipo, id, user.metadata.companyId, user.metadata.role))
  if (!esDueno && !esAdmin) return null

  try {
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET_COMPROBANTES)
      .createSignedUrl(rutaDesdeValor(valorGuardado), VIGENCIA_LECTURA_S)
    if (error || !data) return null
    return data.signedUrl
  } catch {
    return null
  }
}

/**
 * URL temporal para ver el ADJUNTO de un ticket de soporte.
 *
 * Va aparte de `urlComprobante` porque la pregunta de permiso es distinta: el
 * adjunto se sube antes de que el ticket exista (por eso su ruta se ata a la
 * persona, no al ticket), pero se LEE desde el ticket ya creado. Quien puede
 * verlo es quien abrió el ticket y el administrador de la empresa que lo
 * atiende.
 */
export async function urlAdjuntoTicket(
  ticketId: string,
  valorGuardado: string | null | undefined
): Promise<string | null> {
  if (!valorGuardado) return null

  const user = await getUser()
  if (!user) return null

  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { companyId: true, cliente: { select: { supabaseId: true } } },
    })
    if (!ticket) return null

    const esDueno = ticket.cliente?.supabaseId === user.supabaseId
    const esAdmin =
      FULL_ADMIN_ROLES.includes(user.metadata.role) &&
      (user.metadata.role === 'SUPERADMIN' ||
        ticket.companyId === user.metadata.companyId)
    if (!esDueno && !esAdmin) return null

    const { data, error } = await createAdminClient()
      .storage.from(BUCKET_COMPROBANTES)
      .createSignedUrl(rutaDesdeValor(valorGuardado), VIGENCIA_LECTURA_S)
    if (error || !data) return null
    return data.signedUrl
  } catch {
    return null
  }
}

/** ¿El pago pertenece a la empresa que este administrador tiene abierta? */
async function esDeSuEmpresa(
  tipo: TipoComprobante,
  id: string,
  companyId: string | null | undefined,
  role: string
): Promise<boolean> {
  if (role === 'SUPERADMIN') return true
  if (!companyId) return false
  try {
    if (tipo === 'membresia') {
      return (
        (await prisma.membership.count({ where: { id, companyId } })) > 0
      )
    }
    if (tipo === 'compra') {
      return (
        (await prisma.productoCompra.count({ where: { id, companyId } })) > 0
      )
    }
    return false
  } catch {
    return false
  }
}
